/**
 * The Flock: one balance sheet for an address on Arc. Registry tokens and
 * native USDC come from one Multicall3 round trip; Morpho vault shares are
 * converted to assets with ERC-4626 `convertToAssets`; the Circle Gateway
 * unified balance comes from Circle's Gateway API when it answers.
 * Unpriced holdings stay null and make the total null: Lykia never shows a
 * total that silently leaves something out.
 */
import { fromBaseUnits, getProtocol, nativeUsdcToErc20, PROTOCOLS, TOKENS, tokenAddress, type Address, type ArcEnvironment } from "@lykia/core";
import type { FlockHolding, FlockSnapshot } from "@lykia/core/api/flock";
import { erc20Abi, parseAbi } from "viem";
import type { ArcChains } from "../chains/arc.js";
import type { Clock } from "../clock.js";
import type { FetchLike } from "../health/dependencies.js";
import type { Logger } from "../log.js";
import { usdValue, type PriceService } from "../arc/prices.js";
import { PRACTICE_LENDING_ABI } from "../engine/abis.js";
import { aavePositions, readAaveAccount, wadToRatio } from "../engine/venues/aave.js";
import { morphoPositions, projectMorphoHealth } from "../engine/venues/morphoBlue.js";
import { practiceVenues } from "../engine/venues/practice.js";

export const ERC4626_ABI = parseAbi([
  "function asset() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
]);

export const GATEWAY_API: Readonly<Record<ArcEnvironment, string>> = { mainnet: "https://gateway-api.circle.com", testnet: "https://gateway-api-testnet.circle.com" };
/** Circle Gateway domains for the unified balance query (Arc is 26). */
const GATEWAY_DOMAINS: readonly number[] = [0, 1, 2, 3, 6, 7, 10, 26];

export interface VaultInfo {
  readonly id: string;
  readonly address: Address;
  readonly asset: "USDC" | "EURC";
  /** The curator's registry entry when the vault is listed under one (routed through morpho-vaults). */
  readonly curator?: { readonly id: string; readonly name: string };
}

/** Registry entries that route through the Morpho vaults (`via: "morpho-vaults"`), per vault address. */
function curatorOf(environment: ArcEnvironment, address: Address): { id: string; name: string } | undefined {
  for (const p of PROTOCOLS) {
    if (p.via !== "morpho-vaults") continue;
    if (Object.values(p.deployments[environment]?.contracts ?? {}).some((a) => a.toLowerCase() === address.toLowerCase())) return { id: p.id, name: p.name };
  }
  return undefined;
}

/** Morpho V2 vaults from the registry, with the asset they hold (from the row key) and their curator entry. */
export function morphoVaults(environment: ArcEnvironment): VaultInfo[] {
  const row = getProtocol("morpho-vaults")?.deployments[environment];
  if (!row) return [];
  return Object.entries(row.contracts).map(([id, address]) => {
    const curator = curatorOf(environment, address);
    return { id, address, asset: /eurc/iu.test(id) ? "EURC" : "USDC", ...(curator ? { curator } : {}) };
  });
}

/** The venue a Morpho vault answers to: its curator's entry when listed, else morpho-vaults. */
export function vaultVenue(vault: VaultInfo): string {
  return vault.curator?.id ?? "morpho-vaults";
}

export class FlockService {
  constructor(private readonly deps: { readonly chains: ArcChains; readonly prices: PriceService; readonly clock: Clock; readonly fetch: FetchLike; readonly log: Logger }) {}

  async snapshot(environment: ArcEnvironment, address: Address): Promise<FlockSnapshot> {
    const notes: string[] = [];
    const tokens = TOKENS.map((t) => ({ token: t, address: tokenAddress(t, environment) })).filter((t): t is { token: (typeof TOKENS)[number]; address: Address } => t.address !== null);
    const vaults = morphoVaults(environment);
    const balances = await this.deps.chains.getBalances(environment, address, ["native", ...tokens.map((t) => t.address), ...vaults.map((v) => v.address)]);
    const [native, ...rest] = balances.balances;
    const tokenBalances = rest.slice(0, tokens.length);
    const vaultBalances = rest.slice(tokens.length);
    const client = this.deps.chains.client(environment);

    const holdings: Omit<FlockHolding, "usd">[] = [];
    tokens.forEach((t, i) => {
      const raw = tokenBalances[i]?.balance;
      if (raw === null || raw === undefined) {
        notes.push(`${t.token.symbol} balance could not be read.`);
        return;
      }
      if (raw > 0n) holdings.push({ symbol: t.token.symbol, token: t.address, amount: fromBaseUnits(raw, t.token.decimals), where: "wallet", kind: "token" });
    });

    const held = vaults.map((v, i) => ({ vault: v, shares: vaultBalances[i]?.balance ?? null })).filter((v) => v.shares !== null && v.shares > 0n);
    if (held.length > 0) {
      const assets = await client.multicall({
        contracts: held.map((h) => ({ address: h.vault.address, abi: ERC4626_ABI, functionName: "convertToAssets", args: [h.shares as bigint] }) as const),
        allowFailure: true,
      });
      held.forEach((h, i) => {
        const result = assets[i];
        const token = TOKENS.find((t) => t.symbol === h.vault.asset);
        if (!token || result?.status !== "success") {
          notes.push(`Vault ${h.vault.id} could not be valued.`);
          return;
        }
        holdings.push({ symbol: h.vault.asset, token: h.vault.address, amount: fromBaseUnits(result.result as bigint, token.decimals), where: "morpho-vaults", kind: "vault" });
      });
    }

    const health: { venue: string; healthFactor: string | null }[] = [];
    await this.lendingPositions(environment, address, holdings, health, notes);

    const gateway = await this.gatewayBalance(environment, address);
    if (gateway.note) notes.push(gateway.note);
    if (gateway.unifiedUsdc !== null && gateway.unifiedUsdc !== "0") {
      holdings.push({ symbol: "USDC", token: tokenAddress(TOKENS[0]!, environment) as Address, amount: gateway.unifiedUsdc, where: "gateway", kind: "token" });
    }

    const prices = await this.deps.prices.prices(holdings.map((h) => h.symbol).concat("EURC"));
    const priced: FlockHolding[] = holdings.map((h) => ({ ...h, usd: usdValue(h.amount, prices[h.symbol]?.usd ?? null) }));
    let total: bigint | null = 0n;
    for (const h of priced) {
      if (h.usd === null) {
        total = null;
        break;
      }
      const [w = "0", f = ""] = h.usd.split(".");
      const micros = BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6) || "0");
      total += h.kind === "debt" ? -micros : micros;
    }
    // The native balance is the same USDC as the ERC-20 face; it is reported, not added.
    const nativeRaw = native?.balance ?? 0n;
    if (nativeRaw > 0n && tokenBalances[0]?.balance !== null && tokenBalances[0]?.balance !== undefined) {
      const face = nativeUsdcToErc20(nativeRaw, "floor");
      if (face !== tokenBalances[0].balance) notes.push("Native and ERC-20 USDC faces differ by dust below 1e-6 USDC.");
    }
    return {
      address,
      environment,
      at: new Date(this.deps.clock.now()).toISOString(),
      block: balances.blockNumber?.toString() ?? null,
      totalUsd: total === null ? null : fromBaseUnits(total, 6),
      holdings: priced,
      gateway,
      health,
      native: { usdc18: nativeRaw.toString() },
      prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, { usd: v.usd, source: v.source }])),
      notes,
    };
  }

  /** Aave V4 supplies and debts, Morpho Blue collateral and debt, Lykia practice lending; health factors per venue. */
  private async lendingPositions(environment: ArcEnvironment, address: Address, holdings: Omit<FlockHolding, "usd">[], health: { venue: string; healthFactor: string | null }[], notes: string[]): Promise<void> {
    const tokenOf = (symbol: string) => TOKENS.find((t) => t.symbol === symbol);
    try {
      const positions = await aavePositions(this.deps.chains, environment, address);
      for (const p of positions) {
        const t = tokenOf(p.reserve.symbol);
        if (!t) continue;
        if (p.supplied > 0n) holdings.push({ symbol: t.symbol, token: tokenAddress(t, environment) as Address, amount: fromBaseUnits(p.supplied, t.decimals), where: "aave-v4", kind: "supply" });
        if (p.debt > 0n) holdings.push({ symbol: t.symbol, token: tokenAddress(t, environment) as Address, amount: fromBaseUnits(p.debt, t.decimals), where: "aave-v4", kind: "debt" });
      }
      for (const spoke of new Set(positions.filter((p) => p.debt > 0n).map((p) => p.spoke))) {
        const account = await readAaveAccount(this.deps.chains, environment, spoke.address, address);
        health.push({ venue: "aave-v4", healthFactor: account ? wadToRatio(account.healthFactorWad) : null });
      }
    } catch {
      if (environment === "mainnet") notes.push("Aave V4 positions could not be read.");
    }
    try {
      for (const { market, position } of await morphoPositions(this.deps.chains, environment, address)) {
        const coll = tokenOf(market.collateral);
        const loan = tokenOf(market.loan);
        if (coll && position.collateral > 0n) holdings.push({ symbol: coll.symbol, token: tokenAddress(coll, environment) as Address, amount: fromBaseUnits(position.collateral, coll.decimals), where: "morpho-blue", kind: "supply" });
        if (loan && position.borrowAssets > 0n) {
          holdings.push({ symbol: loan.symbol, token: tokenAddress(loan, environment) as Address, amount: fromBaseUnits(position.borrowAssets, loan.decimals), where: "morpho-blue", kind: "debt" });
          health.push({ venue: "morpho-blue", healthFactor: wadToRatio(projectMorphoHealth(market, position, 0n, 0n)) });
        }
      }
    } catch {
      if (environment === "mainnet") notes.push("Morpho Blue positions could not be read.");
    }
    const practice = await practiceVenues(environment);
    if (practice.lending) {
      try {
        const client = this.deps.chains.client(environment);
        const [collateral, debt, hf] = await Promise.all([
          client.readContract({ address: practice.lending, abi: PRACTICE_LENDING_ABI, functionName: "collateralOf", args: [address] }),
          client.readContract({ address: practice.lending, abi: PRACTICE_LENDING_ABI, functionName: "debtOf", args: [address] }),
          client.readContract({ address: practice.lending, abi: PRACTICE_LENDING_ABI, functionName: "healthFactor", args: [address] }),
        ]);
        const btc = tokenOf("cirBTC");
        const usdc = tokenOf("USDC");
        if (btc && collateral > 0n) holdings.push({ symbol: "cirBTC", token: tokenAddress(btc, environment) as Address, amount: fromBaseUnits(collateral, btc.decimals), where: "lykia-practice", kind: "supply" });
        if (usdc && debt > 0n) {
          holdings.push({ symbol: "USDC", token: tokenAddress(usdc, environment) as Address, amount: fromBaseUnits(debt, usdc.decimals), where: "lykia-practice", kind: "debt" });
          health.push({ venue: "lykia-practice", healthFactor: wadToRatio(hf) });
        }
      } catch {
        notes.push("Lykia practice lending could not be read.");
      }
    }
    for (const vault of [practice.vaultUsdc, practice.vaultEurc]) {
      if (!vault) continue;
      try {
        const client = this.deps.chains.client(environment);
        const shares = await client.readContract({ address: vault, abi: ERC4626_ABI, functionName: "balanceOf", args: [address] });
        if (shares === 0n) continue;
        const assets = await client.readContract({ address: vault, abi: ERC4626_ABI, functionName: "convertToAssets", args: [shares] });
        const t = tokenOf(vault === practice.vaultEurc ? "EURC" : "USDC");
        if (t) holdings.push({ symbol: t.symbol, token: vault, amount: fromBaseUnits(assets, t.decimals), where: "lykia-practice", kind: "vault" });
      } catch {
        notes.push("A Lykia practice vault could not be read.");
      }
    }
  }

  /** Circle Gateway unified USDC balance; null with a note when the API does not answer. */
  async gatewayBalance(environment: ArcEnvironment, address: Address): Promise<FlockSnapshot["gateway"]> {
    try {
      const response = await this.deps.fetch(`${GATEWAY_API[environment]}/v1/balances`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "USDC", sources: GATEWAY_DOMAINS.map((domain) => ({ domain, depositor: address })) }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) return { unifiedUsdc: null, note: `Circle Gateway API answered ${response.status}; unified balance unknown.` };
      const body = (await response.json()) as { balances?: Array<{ domain?: number; balance?: string }> };
      if (!Array.isArray(body.balances)) return { unifiedUsdc: null, note: "Circle Gateway API returned no balances." };
      let micros = 0n;
      for (const entry of body.balances) {
        if (typeof entry.balance !== "string" || !/^\d+(?:\.\d+)?$/u.test(entry.balance)) continue;
        const [w = "0", f = ""] = entry.balance.split(".");
        micros += BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6) || "0");
      }
      return { unifiedUsdc: fromBaseUnits(micros, 6) };
    } catch {
      return { unifiedUsdc: null, note: "Circle Gateway API unreachable; unified balance unknown." };
    }
  }

  /** ERC-20 balance in base units (planner helper). */
  async balanceOf(environment: ArcEnvironment, token: Address, owner: Address): Promise<bigint> {
    return this.deps.chains.client(environment).readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  }
}
