/**
 * Vault positions: Morpho Vaults V2 (ERC-4626) on mainnet and Lykia's
 * practice venues on testnet.
 *
 * Morpho: share balances of every registry vault in one Multicall3 batch,
 * then convertToAssets for the vaults held (the vault's own rounding). Name,
 * curator, net APY and TVL come from the Morpho API, the same rate source
 * the router ranks with; the risk class is Lykia's (riskFromTvl, the floor
 * the router applies). When the API does not answer, the APY is left out.
 */
import { intlTag } from "../i18n/format.js";
import { classifyPosition, riskFromTvl, TOKENS, tokenAddress, type Position } from "@lykia/core";
import { PRACTICE_LENDING_ABI } from "../engine/abis.js";
import { practiceVenues } from "../engine/venues/practice.js";
import { wadToRatio } from "../engine/venues/aave.js";
import { ERC4626_ABI, morphoVaults, vaultVenue } from "../flock/flock.js";
import { action, addressLink, asset, finish, fractionToPercent, sentenceAmount, valued, VenueUnavailable, type Reader } from "./context.js";

import { tx, phrase } from "@lykia/core";
const RISK_WORD = { low: phrase("Low"), medium: phrase("Medium"), high: phrase("High") } as const;

/**
 * One reader for Morpho Vault V2 shares, run per venue: a curator's venue
 * (galaxy-curation, keyrock, ...) reads that curator's vaults, morpho-vaults
 * reads the registry vaults no curator entry claims. Every vault is read by
 * exactly one venue, so nothing is counted twice.
 */
export const readMorphoVaults: Reader = async (r, venue) => {
  const all = morphoVaults(r.environment);
  if (all.length === 0) throw new VenueUnavailable("No Morpho vaults on this network.");
  const vaults = all.filter((v) => vaultVenue(v) === venue.id);
  if (vaults.length === 0) return { positions: [], block: null, method: "Every registry Morpho vault is listed under its curator's venue; their positions are read there.", source: "chain" };
  const client = r.ctx.chains.client(r.environment);
  const shares = await client.multicall({ contracts: vaults.map((v) => ({ address: v.address, abi: ERC4626_ABI, functionName: "balanceOf", args: [r.owner] }) as const), allowFailure: true });
  const failed = shares.filter((s) => s.status !== "success").length;
  if (failed === vaults.length) throw new VenueUnavailable("The Morpho vaults did not answer.");
  const held = vaults.map((v, i) => ({ vault: v, shares: shares[i]?.status === "success" ? (shares[i]!.result as bigint) : 0n })).filter((h) => h.shares > 0n);
  const block = (await client.getBlockNumber()).toString();
  const method = tx("balanceOf on the {length} registry vaults, then convertToAssets (ERC-4626); name, curator and APY from the Morpho API.", { length: vaults.length });
  if (held.length === 0) return { positions: [], block, method, source: "chain", ...(failed > 0 ? { coverage: tx("{failed} vault(s) did not answer this time.", { failed }) } : {}) };
  const [assets, rates] = await Promise.all([client.multicall({ contracts: held.map((h) => ({ address: h.vault.address, abi: ERC4626_ABI, functionName: "convertToAssets", args: [h.shares] }) as const), allowFailure: true }), r.rates()]);
  const prices = await r.prices(held.map((h) => h.vault.asset));
  const positions: Position[] = [];
  held.forEach((h, i) => {
    const token = TOKENS.find((t) => t.symbol === h.vault.asset);
    const res = assets[i];
    if (!token || res?.status !== "success") return;
    const v = valued(res.result as bigint, token.decimals, prices[token.symbol]?.usd ?? null);
    const rate = rates?.vaults.find((q) => q.address.toLowerCase() === h.vault.address.toLowerCase()) ?? null;
    const apy = fractionToPercent(rate?.apy);
    const tvl = rate?.tvlUsd ? Number(rate.tvlUsd) : null;
    const risk = riskFromTvl(tvl);
    const name = rate?.name || h.vault.id;
    const amount = Number(v.amount);
    positions.push(
      finish({
        id: `${venue.id}:${h.vault.address.toLowerCase()}`,
        venue: venue.id,
        venueName: venue.name,
        venueKind: "vault",
        label: name,
        assets: [asset(token.symbol, tokenAddress(token, r.environment), v.amount, v.valueUsd, "supplied")],
        amount: v.amount,
        symbol: token.symbol,
        valueUsd: v.valueUsd,
        counts: "net",
        state: classifyPosition({ kind: "vault", apyPercent: apy === null ? null : Number(apy) }),
        ...(apy !== null ? { apy: { percent: apy, kind: "vault" as const, source: "Morpho API (net of fees)" } } : {}),
        facts: [
          { label: tx("Curator"), value: rate?.curators && rate.curators.length > 0 ? rate.curators.join(", ") : (h.vault.curator?.name ?? tx("not listed")) },
          { label: tx("Vault"), value: tx("Morpho Vault V2 (ERC-4626)") },
          { label: tx("Lykia risk class"), value: tx("{value} (by vault size)", { value: RISK_WORD[risk] }) },
          { label: tx("Vault size"), value: tvl === null ? "unknown" : `$${Math.round(tvl).toLocaleString(intlTag())}` },
          { label: tx("Shares"), value: h.shares.toString() },
        ],
        actions: [action("withdraw", tx("Withdraw half"), tx("Withdraw {value} {symbol} from Morpho {id}", { value: sentenceAmount(amount / 2), symbol: token.symbol, id: h.vault.id })), ...(token.symbol === "USDC" ? [action("move-rate", tx("Move to a better rate"), tx("Withdraw {amount} USDC from my vault and put it to work at low risk", { amount: sentenceAmount(amount) }))] : [])],
        source: "chain",
        readAt: r.readAt,
        block,
        explorer: addressLink(r.environment, h.vault.address),
      }),
    );
  });
  return { positions, block, method, source: "chain", ...(failed > 0 ? { coverage: tx("{failed} vault(s) did not answer this time.", { failed }) } : {}) };
};

/** Lykia practice venues on testnet: the practice vaults and practice lending. */
export const readPractice: Reader = async (r, venue) => {
  const practice = await practiceVenues(r.environment);
  if (!practice.lending && !practice.vaultUsdc && !practice.vaultEurc) throw new VenueUnavailable(`The practice venues are ${practice.source}.`);
  const client = r.ctx.chains.client(r.environment);
  const block = (await client.getBlockNumber()).toString();
  const prices = await r.prices(["USDC", "EURC", "cirBTC"]);
  const positions: Position[] = [];
  const base = { venue: venue.id, venueName: venue.name, source: "chain" as const, readAt: r.readAt, block };
  for (const [vault, symbol] of [[practice.vaultUsdc, "USDC"], [practice.vaultEurc, "EURC"]] as const) {
    if (!vault) continue;
    const sh = await client.readContract({ address: vault, abi: ERC4626_ABI, functionName: "balanceOf", args: [r.owner] });
    if (sh === 0n) continue;
    const assets = await client.readContract({ address: vault, abi: ERC4626_ABI, functionName: "convertToAssets", args: [sh] });
    const t = TOKENS.find((x) => x.symbol === symbol)!;
    const v = valued(assets, t.decimals, prices[symbol]?.usd ?? null);
    positions.push(finish({ ...base, id: `lykia-practice:${vault.toLowerCase()}`, venueKind: "vault", label: tx("Practice vault {symbol}", { symbol }), assets: [asset(symbol, vault, v.amount, v.valueUsd, "supplied")], amount: v.amount, symbol, valueUsd: v.valueUsd, counts: "net", state: classifyPosition({ kind: "vault", apyPercent: null }), facts: [{ label: tx("Note"), value: tx("Testnet practice vault; yield is dripped by its owner.") }], actions: [action("withdraw", tx("Withdraw"), tx("Withdraw {amount} {symbol} from my practice vault", { amount: sentenceAmount(Number(v.amount)), symbol }))], explorer: addressLink(r.environment, vault) }));
  }
  if (practice.lending) {
    const [collateral, debt, hf] = await Promise.all([
      client.readContract({ address: practice.lending, abi: PRACTICE_LENDING_ABI, functionName: "collateralOf", args: [r.owner] }),
      client.readContract({ address: practice.lending, abi: PRACTICE_LENDING_ABI, functionName: "debtOf", args: [r.owner] }),
      client.readContract({ address: practice.lending, abi: PRACTICE_LENDING_ABI, functionName: "healthFactor", args: [r.owner] }),
    ]);
    const factor = debt > 0n ? wadToRatio(hf) : null;
    const health = { factor, liquidationAtPercent: null, ltvPercent: null, floor: String(r.healthFloor) };
    const btc = TOKENS.find((x) => x.symbol === "cirBTC")!;
    const usdc = TOKENS.find((x) => x.symbol === "USDC")!;
    if (collateral > 0n) {
      const v = valued(collateral, btc.decimals, prices.cirBTC?.usd ?? null);
      positions.push(finish({ ...base, id: `lykia-practice:lending:collateral`, venueKind: "market", label: tx("Practice lending · cirBTC collateral"), assets: [asset("cirBTC", tokenAddress(btc, r.environment), v.amount, v.valueUsd, "collateral")], amount: v.amount, symbol: "cirBTC", valueUsd: v.valueUsd, counts: "net", state: classifyPosition({ kind: "collateral", healthFactor: factor === null ? null : Number(factor), healthFloor: r.healthFloor }), ...(debt > 0n ? { health } : {}), collateral: true, actions: [], explorer: addressLink(r.environment, practice.lending) }));
    }
    if (debt > 0n) {
      const v = valued(-debt, usdc.decimals, "1");
      positions.push(finish({ ...base, id: `lykia-practice:lending:debt`, venueKind: "market", label: tx("Practice lending · USDC borrowed"), assets: [asset("USDC", tokenAddress(usdc, r.environment), v.amount, v.valueUsd, "borrowed")], amount: v.amount.replace(/^-/u, ""), symbol: "USDC", valueUsd: v.valueUsd, counts: "net", state: classifyPosition({ kind: "debt", healthFactor: factor === null ? null : Number(factor), healthFloor: r.healthFloor }), health, actions: [action("repay", tx("Repay a quarter"), tx("Repay {value} USDC on lykia-practice", { value: sentenceAmount(Number(v.amount.replace(/^-/u, "")) / 4) }))], explorer: addressLink(r.environment, practice.lending) }));
    }
  }
  return { positions, block, method: "Practice vault shares (convertToAssets) and practice lending collateral, debt and health factor.", source: "chain" };
};

