/**
 * Insights: what Lyko notices on the Flock, each with a one-tap proposal
 * when there is a sensible move. Deterministic: thresholds, not a model.
 * Every figure comes from the snapshot; unpriced holdings are flagged, not
 * counted as zero.
 */
import { assessToken, compareDecimal, fromBaseUnits, type Address, type ArcEnvironment } from "@lykia/core";
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

export async function insightsFor(ctx: AppContext, environment: ArcEnvironment, owner: Address): Promise<InsightsResponse> {
  const snap = await services(ctx).flock.snapshot(environment, owner);
  return { owner, environment, at: new Date(ctx.clock.now()).toISOString(), insights: insightsFrom(snap) };
}
