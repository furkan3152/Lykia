/**
 * The generic side of the position framework: insights that work for every
 * kind from its detail blocks (risk near a threshold, something to claim,
 * something expiring, something idle). Pure: no I/O.
 *
 * Adding a kind: a reader returns `Position`s with `venueKind` set to the
 * kind and its detail as `blocks`; one line in POSITION_KINDS names it. The
 * Fold draws the blocks, these insights read them, and Lyko describes them.
 * See docs/adding-a-position-kind.md.
 */
import { fmtAmount, fmtUsd, positionKindInfo, untilText, type Position, type PositionBlock } from "./positions.js";

export type GenericInsightKind = "near-threshold" | "unclaimed" | "expiring" | "idle-position";

export interface GenericInsight {
  readonly id: string;
  readonly kind: GenericInsightKind;
  readonly severity: "act" | "watch" | "info";
  readonly title: string;
  readonly explain: string;
  readonly figures: readonly { readonly label: string; readonly value: string }[];
  readonly draft: { readonly label: string; readonly sentence: string } | null;
}

/** How close a gauge is to its threshold, as a share of the scale (0 = at it, negative = past it). */
export function gaugeRoom(g: Extract<PositionBlock, { type: "gauge" }>): number | null {
  if (!g.threshold) return null;
  const span = g.max - g.min || 1;
  return g.threshold.danger === "below" ? (g.value - g.threshold.at) / span : (g.threshold.at - g.value) / span;
}

/** Within this share of the scale from the threshold, a gauge is "near" it. */
export const NEAR_THRESHOLD_SHARE = 0.12;
/** A countdown inside this window is "expiring". */
export const EXPIRING_MS = 72 * 3_600_000;
/** Idle positions below this value are not worth a line. */
export const IDLE_MIN_USD = 50;

/**
 * Generic insights over any position with blocks or a claim: a gauge near
 * its threshold, something ready to claim, a countdown inside three days,
 * and value sitting idle outside the wallet. Kinds with dedicated insights
 * (health factors, LP ranges, orders, idle wallet USDC) are covered there;
 * this reads only what the generic framework carries.
 */
export function genericPositionInsights(positions: readonly Position[], now: number = Date.now()): GenericInsight[] {
  const out: GenericInsight[] = [];
  const tail = (id: string) => id.replace(/[^A-Za-z0-9]+/gu, "-").slice(-40);
  for (const p of positions) {
    const blocks = p.blocks ?? [];
    const kind = positionKindInfo(p.venueKind).label;
    for (const b of blocks) {
      if (b.type === "gauge" && b.threshold) {
        const room = gaugeRoom(b);
        if (room !== null && room <= NEAR_THRESHOLD_SHARE) {
          out.push({ id: `near-${tail(p.id)}-${b.label.toLowerCase().replace(/\W+/gu, "-")}`, kind: "near-threshold", severity: room <= 0 ? "act" : "watch", title: `${p.label}: ${b.label.toLowerCase()} is ${room <= 0 ? "past" : "close to"} ${b.threshold.label}`, explain: b.meaning ?? `${kind}: ${b.label} reads ${b.display}; ${b.threshold.label} is at ${b.threshold.at}.`, figures: [{ label: b.label, value: b.display }, { label: b.threshold.label, value: String(b.threshold.at) }], draft: p.actions[0] && p.actions[0].mode === "draft" ? { label: p.actions[0].label, sentence: p.actions[0].sentence } : null });
        }
      }
      if (b.type === "countdown" && b.ends === true) {
        const left = Date.parse(b.until) - now;
        if (Number.isFinite(left) && left > 0 && left <= EXPIRING_MS) out.push({ id: `expiring-${tail(p.id)}`, kind: "expiring", severity: "watch", title: `${p.label}: ${b.label.toLowerCase()} ${untilText(b.until, now)}`, explain: b.meaning ?? `${kind}: ${b.label.toLowerCase()} ${untilText(b.until, now)}.`, figures: [{ label: b.label, value: new Date(b.until).toUTCString().slice(5, 22) }], draft: null });
      }
    }
    if (p.claimable && Number(p.claimable.amount) > 0) {
      const value = p.claimable.valueUsd === null ? null : Number(p.claimable.valueUsd);
      out.push({ id: `claim-${tail(p.id)}`, kind: "unclaimed", severity: value !== null && value >= 1 ? "act" : "info", title: `${fmtAmount(p.claimable.amount, p.claimable.symbol)} is ready to claim on ${p.venueName}`, explain: `It stays there until you collect it.${value !== null ? ` Worth about ${fmtUsd(value, 2)} now.` : " It has no reliable price yet."}`, figures: [{ label: "Ready to claim", value: fmtAmount(p.claimable.amount, p.claimable.symbol) }, ...(value !== null ? [{ label: "Worth now", value: fmtUsd(value, 2) }] : [])], draft: p.actions.find((a) => a.kind === "collect-fees" && a.mode === "draft") ? { label: "Claim it", sentence: p.actions.find((a) => a.kind === "collect-fees")!.sentence } : null });
    }
    const v = p.valueUsd === null ? null : Number(p.valueUsd);
    if (p.state === "idle" && p.venueKind !== "wallet" && v !== null && v >= IDLE_MIN_USD && blocks.length > 0) {
      out.push({ id: `idle-${tail(p.id)}`, kind: "idle-position", severity: "info", title: `${p.label} is sitting idle`, explain: `${fmtUsd(v, 0)} earns nothing there right now.`, figures: [{ label: "Value", value: fmtUsd(v, 0) }], draft: null });
    }
  }
  return out;
}
