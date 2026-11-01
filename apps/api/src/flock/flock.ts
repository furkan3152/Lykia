/**
 * The Flock: one balance sheet for an address on Arc. Registry tokens and
 * native USDC come from one Multicall3 round trip; Morpho vault shares are
 * converted to assets with ERC-4626 `convertToAssets`; the Circle Gateway
 * unified balance comes from Circle's Gateway API when it answers.
 * Unpriced holdings stay null and make the total null: Lykia never shows a
 * total that silently leaves something out.
 */
import { fromBaseUnits, getProtocol, nativeUsdcToErc20, TOKENS, tokenAddress, type Address, type ArcEnvironment } from "@lykia/core";
import type { FlockHolding, FlockSnapshot } from "@lykia/core/api/flock";
import { erc20Abi, parseAbi } from "viem";
import type { ArcChains } from "../chains/arc.js";
import type { Clock } from "../clock.js";
import type { FetchLike } from "../health/dependencies.js";
import type { Logger } from "../log.js";
import { usdValue, type PriceService } from "../arc/prices.js";

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
export const GATEWAY_DOMAINS: readonly number[] = [0, 1, 2, 3, 6, 7, 10, 26];

export interface VaultInfo {
  readonly id: string;
  readonly address: Address;
  readonly asset: "USDC" | "EURC";
}

/** Morpho V2 vaults from the registry, with the asset they hold (from the row key). */
export function morphoVaults(environment: ArcEnvironment): VaultInfo[] {
  const row = getProtocol("morpho-vaults")?.deployments[environment];
  if (!row) return [];
  return Object.entries(row.contracts).map(([id, address]) => ({ id, address, asset: /eurc/iu.test(id) ? "EURC" : "USDC" }));
}

export class FlockService {
  constructor(private readonly deps: { readonly chains: ArcChains; readonly prices: PriceService; readonly clock: Clock; readonly fetch: FetchLike; readonly log: Logger }) {}

  async snapshot(environment: ArcEnvironment, address: Address): Promise<FlockSnapshot> {
    const notes: string[] = [];
    const tokens = TOKENS.map((t) => ({ token: t, address: tokenAddress(t, environment) as Address }));
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
      health: [],
      native: { usdc18: nativeRaw.toString() },
      prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, { usd: v.usd, source: v.source }])),
      notes,
    };
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
