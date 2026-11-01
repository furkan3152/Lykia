/**
 * Insights: what Lyko notices on the Flock, each with a one-tap proposal
 * when there is a sensible move. Deterministic: thresholds, not a model.
 * Every figure comes from the snapshot; unpriced holdings are flagged, not
 * counted as zero.
 */
import { assessToken, compareDecimal, fromBaseUnits, networkFor, PROTOCOLS, TOKENS, tokenAddress, type Address, type ArcEnvironment } from "@lykia/core";
import { encodeFunctionData, erc20Abi } from "viem";
import type { Insight, InsightsResponse } from "@lykia/core/api/agents";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { AppContext } from "../context.js";
import { services } from "../services.js";

export const IDLE_CASH_USD = 100;
export const HEALTH_WATCH = "1.5";
export const LOW_GAS_USDC = 0.05;

const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

export function insightsFrom(snap: FlockSnapshot): Insight[] {
  const out: Insight[] = [];
  const total = num(snap.totalUsd);
  const wallet = (symbol: string) => snap.holdings.find((h) => h.where === "wallet" && h.kind === "token" && h.symbol === symbol);
  const usdc = wallet("USDC");
  const usdcUsd = num(usdc?.usd);
  if (usdc && usdcUsd !== null && usdcUsd >= IDLE_CASH_USD) {
    out.push({
      id: "idle-usdc",
      kind: "idle-cash",
      severity: usdcUsd >= 1000 ? "act" : "watch",
      title: `${usdc.amount} USDC is sitting idle`,
      detail: "Stablecoins in the wallet earn nothing. A Morpho vault on Arc can hold part of it while the rest stays liquid for gas and payments.",
      proposal: snap.environment === "mainnet" ? "put half my USDC to work" : null,
      role: "yield-keeper",
    });
  }
  const eurc = wallet("EURC");
  const eurcUsd = num(eurc?.usd);
  if (eurc && eurcUsd !== null && total !== null && total > 0) {
    const share = eurcUsd / total;
    if (share >= 0.1) {
      out.push({ id: "fx-eur", kind: "fx-exposure", severity: share >= 0.6 ? "watch" : "info", title: `${Math.round(share * 100)}% of the Flock is in EUR`, detail: `EURC worth $${eurc.usd} moves with EUR/USD. The FX hedger can keep a target mix inside the Fence's FX band.`, proposal: share >= 0.6 ? "convert 25% of my EURC to USDC" : null, role: "fx-hedger" });
    }
  }
  if (total !== null && total > 0) {
    for (const h of snap.holdings) {
      const usd = num(h.usd);
      if (h.kind === "debt" || usd === null || h.symbol === "USDC" || h.symbol === "EURC") continue;
      if (usd / total >= 0.5) out.push({ id: `concentration-${h.symbol}`, kind: "concentration", severity: "watch", title: `${Math.round((usd / total) * 100)}% of the Flock is ${h.symbol}`, detail: `One volatile asset carries most of the value ($${h.usd} of $${snap.totalUsd}).`, proposal: null, role: "treasurer" });
    }
  }
  for (const h of snap.health) {
    if (h.healthFactor === null) out.push({ id: `health-${h.venue}`, kind: "health-factor", severity: "watch", title: `Health factor on ${h.venue} could not be read`, detail: "The sentinel cannot judge liquidation risk without it.", proposal: null, role: "sentinel" });
    else if (compareDecimal(h.healthFactor, HEALTH_WATCH) < 0) out.push({ id: `health-${h.venue}`, kind: "health-factor", severity: "act", title: `Health factor ${h.healthFactor} on ${h.venue}`, detail: `Below ${HEALTH_WATCH}: a price move could liquidate the position. Repaying part of the debt raises it.`, proposal: null, role: "sentinel" });
  }
  const unpriced = snap.holdings.filter((h) => h.usd === null && h.kind !== "debt");
  if (unpriced.length > 0) out.push({ id: "unpriced", kind: "unpriced", severity: "info", title: `${unpriced.length} holding(s) without a price`, detail: `${unpriced.map((h) => `${h.amount} ${h.symbol}`).join(", ")}: Lykia shows them as unpriced, never as zero, and the Fence denies capped moves on them.`, proposal: null, role: "researcher" });
  for (const h of snap.holdings) {
    const trust = assessToken({ environment: snap.environment, address: h.token, symbol: h.symbol });
    if (trust.status !== "verified" && h.kind === "token") out.push({ id: `scent-${h.token}`, kind: "scent-warning", severity: trust.status === "lookalike" ? "act" : "watch", title: `${h.symbol} is not a registry token`, detail: trust.warning, proposal: null, role: "sentinel" });
  }
  try {
    const gas = Number(fromBaseUnits(snap.native.usdc18, 18));
    if (gas < LOW_GAS_USDC && (total ?? 0) > 0) out.push({ id: "low-gas", kind: "low-gas", severity: "watch", title: `Gas is low: ${gas.toFixed(4)} USDC`, detail: "Arc pays gas in USDC. Keep a little native USDC so plans can execute.", proposal: null, role: "treasurer" });
  } catch {
    /* malformed native balance: skip */
  }
  return out;
}

/** Contracts of every venue Lykia approves tokens to (registry rows with the approve verb). */
export function knownSpenders(environment: ArcEnvironment): { readonly spender: Address; readonly venue: string; readonly name: string }[] {
  const tokens = new Set(TOKENS.map((t) => tokenAddress(t, environment)?.toLowerCase()).filter(Boolean));
  const out = new Map<string, { spender: Address; venue: string; name: string }>();
  for (const p of PROTOCOLS) {
    if (!p.verbs.includes("approve")) continue;
    for (const [name, address] of Object.entries(p.deployments[environment]?.contracts ?? {})) {
      if (tokens.has(address.toLowerCase()) || name.toLowerCase().startsWith("pool")) continue;
      if (!out.has(address.toLowerCase())) out.set(address.toLowerCase(), { spender: address, venue: p.name, name });
    }
  }
  return [...out.values()];
}

/**
 * Lykia approves exact amounts that the same transaction spends, so any
 * allowance left from the owner to a venue contract is stale: a standing
 * door an exploit at that venue could walk through. One multicall reads
 * every (token, spender) pair; each leftover gets a ready-to-sign revoke.
 */
export async function staleApprovals(ctx: AppContext, environment: ArcEnvironment, owner: Address): Promise<Insight[]> {
  const spenders = knownSpenders(environment);
  const tokens = TOKENS.map((t) => ({ token: t, address: tokenAddress(t, environment) })).filter((t): t is { token: (typeof TOKENS)[number]; address: Address } => t.address !== null);
  const pairs = tokens.flatMap((t) => spenders.map((s) => ({ ...t, ...s })));
  if (pairs.length === 0) return [];
  let results: readonly { status: string; result?: unknown }[];
  try {
    results = await ctx.chains.client(environment).multicall({ contracts: pairs.map((p) => ({ address: p.address, abi: erc20Abi, functionName: "allowance", args: [owner, p.spender] }) as const), allowFailure: true });
  } catch {
    return [];
  }
  const chainId = networkFor(environment).chainId;
  const out: Insight[] = [];
  pairs.forEach((p, i) => {
    const r = results[i];
    if (!r || r.status !== "success" || typeof r.result !== "bigint" || r.result === 0n) return;
    const unlimited = r.result >= 2n ** 255n;
    const amount = unlimited ? "unlimited" : `${fromBaseUnits(r.result, p.token.decimals)} ${p.token.symbol}`;
    out.push({
      id: `stale-approval-${p.token.symbol}-${p.spender.toLowerCase()}`,
      kind: "stale-approval",
      severity: unlimited ? "act" : "watch",
      title: `${p.token.symbol} still approved to ${p.venue}`,
      detail: `${amount} can still be pulled by ${p.venue} (${p.name}, ${p.spender}). Lykia's own steps never leave allowances behind; revoking closes the door.`,
      proposal: null,
      role: "sentinel",
      transactions: [{ chainId, from: owner, to: p.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [p.spender, 0n] }), value: "0", label: `Revoke ${p.token.symbol} allowance from ${p.venue}` }],
    });
  });
  return out;
}

export async function insightsFor(ctx: AppContext, environment: ArcEnvironment, owner: Address): Promise<InsightsResponse> {
  const [snap, stale] = await Promise.all([services(ctx).flock.snapshot(environment, owner), staleApprovals(ctx, environment, owner)]);
  return { owner, environment, at: new Date(ctx.clock.now()).toISOString(), insights: [...insightsFrom(snap), ...stale] };
}
