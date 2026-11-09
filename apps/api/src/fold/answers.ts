/**
 * Structured answers for Lyko on watch's follow-up chips ("Explain my
 * yield", "Am I safe if EURC drops 5%?", "What runs this week?", "Tidy my
 * approvals"). Each one is computed here from live reads, returned as an
 * artifact (label, value, note per line) and written to the owner's shared
 * thread, so Ask Lyko sees the same conversation.
 */
import { ownerFence } from "../personal/fence.js";
import { applyFoldShocks, describeShock, isSampleOwner, NO_SHOCK, TRAIL_FEE_WINDOW_DAYS, type Address, type ArcEnvironment, type FoldShocks, type PositionsResponse, type ShockHolding } from "@lykia/core";
import type { BlockSource } from "@lykia/core/api/answer";
import type { FoldAnswerResponse, FoldExplainArtifact, FoldQuestion, FoldWhatIfResponse } from "@lykia/core/api/fold";
import type { AppContext } from "../context.js";
import { appendMessages, openThread } from "../agents/memory.js";
import { staleApprovals } from "../agents/insights.js";
import { blockOf, isoOf } from "../agents/cards.js";
import { healthFromPositions } from "./insights.js";
import { instructionsFor } from "./instructions.js";
import { foldPositions } from "./sample.js";
import { trailsFor } from "./trails.js";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const QUESTIONS: Readonly<Record<FoldQuestion, string>> = {
  yield: "Explain my yield",
  whatif: "Am I safe if EURC drops 5%?",
  week: "What runs this week?",
  approvals: "Tidy my approvals",
};

async function minHealth(ctx: AppContext, owner: Address): Promise<number> {
  return Number((await ownerFence(ctx, owner)).lending?.minHealthFactor ?? "1.2");
}

/** The position map as shock inputs: every position that counts toward net worth, under its own label. */
function shockHoldings(map: PositionsResponse): ShockHolding[] {
  return map.venues.flatMap((v) =>
    v.positions
      .filter((p) => p.counts === "net")
      .map((p) => {
        const value = p.valueUsd === null ? null : Number(p.valueUsd);
        const kind: ShockHolding["kind"] = value !== null && value < 0 ? "debt" : p.venue === "wallet" ? "token" : p.venueKind === "vault" ? "vault" : p.venueKind === "lending" || p.venueKind === "market" ? "supply" : "token";
        // An LP or a vault is exposed to every asset it holds: its symbol lists them, so EURC inside a pool moves with EURC.
        const symbol = [p.symbol, ...p.assets.map((a) => a.symbol)].filter(Boolean).join("/");
        return { symbol, where: p.venue, kind, usd: p.valueUsd, label: p.venue === "wallet" ? `${p.label} · ${p.venueName}` : p.label };
      }),
  );
}

export async function whatIfFor(ctx: AppContext, environment: ArcEnvironment, owner: Address, shocks: FoldShocks): Promise<FoldWhatIfResponse> {
  // The same position map the Fold bar and the Flock tab show, so "worth now" equals their net worth.
  const [map, floor] = await Promise.all([foldPositions(ctx, environment, owner, { personal: false }), minHealth(ctx, owner)]);
  const health = healthFromPositions(map).map((h) => ({ venue: h.venue, healthFactor: h.healthFactor }));
  const result = applyFoldShocks(shockHoldings(map), health, shocks);
  return { owner: owner.toLowerCase() as Address, environment, shocks, result, sentence: describeShock(result, shocks, floor), from: { source: isSampleOwner(owner) ? "sample" : "Arc chain and venue APIs", readAt: isoOf(map.at), block: blockOf(map.block) } };
}

export async function explain(ctx: AppContext, environment: ArcEnvironment, owner: Address, question: FoldQuestion, shocks: FoldShocks = { ...NO_SHOCK, EURC: -5 }): Promise<FoldExplainArtifact> {
  const at = new Date(ctx.clock.now()).toISOString();
  const records: BlockSource = { source: "Lykia records", readAt: at, block: null };
  if (question === "whatif") {
    const w = await whatIfFor(ctx, environment, owner, shocks);
    const from = w.from ?? records;
    return {
      kind: "whatif",
      title: "If prices move",
      summary: w.sentence,
      lines: [
        { label: "Flock now", value: usd(w.result.before), note: null, from },
        { label: "After the shock", value: usd(w.result.after), note: null, from },
        ...w.result.health.map((h) => ({ label: `Health on ${h.venue}`, value: h.after === null ? "unavailable" : h.after.toFixed(2), note: h.before === null ? null : `now ${h.before.toFixed(2)}`, from })),
        ...(w.result.unpriced > 0 ? [{ label: "Unpriced", value: `${w.result.unpriced} holding${w.result.unpriced === 1 ? "" : "s"}`, note: "left out of both totals, never counted as $0", from }] : []),
      ],
      sources: ["the position map", "Chainlink prices", "the shared shock model"],
      at,
      block: from.block,
    };
  }
  if (question === "week") {
    const now = ctx.clock.now();
    const all = await instructionsFor(ctx, owner);
    const week = all.filter((i) => i.status === "active" && i.nextRunAt && Date.parse(i.nextRunAt) - now <= 7 * 86_400_000);
    const onEvent = all.filter((i) => i.status === "active" && !i.nextRunAt && i.source !== "plan").length;
    return {
      kind: "week",
      title: "This week in Herding",
      summary: week.length === 0 ? `Nothing is scheduled for the next seven days${onEvent > 0 ? `; ${onEvent} instruction(s) wait for a price or an event` : ""}.` : `${week.length} run(s) in the next seven days${onEvent > 0 ? `, and ${onEvent} waiting for a price or an event` : ""}.`,
      lines: week.map((i) => ({ label: i.name, value: i.nextRunLabel, note: i.nextVerdict ? `${i.nextVerdict.decision}: ${i.nextVerdict.reason}` : null, from: records })),
      sources: ["automations", "standing orders", "orders", "watches"],
      at,
      block: null,
    };
  }
  if (question === "approvals") {
    const list = await staleApprovals(ctx, environment, owner);
    const from: BlockSource = { source: "ERC-20 allowance reads on Arc", readAt: at, block: null };
    return {
      kind: "approvals",
      title: "Open approvals",
      summary: list.length === 0 ? "No allowances are left open to the venues Lykia knows. Nothing to tidy." : `${list.length} allowance(s) are open. Lyko drafted one revoke each; sign them from the insight or from Herding.`,
      lines: list.map((a) => ({ label: a.title, value: a.severity === "act" ? "unlimited" : "limited", note: a.detail.slice(0, 140), from })),
      sources: ["ERC-20 allowance reads on Arc"],
      at,
      block: null,
    };
  }
  // yield: from the position map; every rate is the venue's own, every total is core's (summarizePositions).
  const map = await foldPositions(ctx, environment, owner, { personal: false });
  const sample = isSampleOwner(owner);
  const mapFrom: BlockSource = { source: sample ? "sample" : "Arc chain and venue APIs", readAt: isoOf(map.at), block: blockOf(map.block) };
  const all = map.venues.flatMap((v) => v.positions.filter((p) => p.counts === "net"));
  const earning = all.filter((p) => (p.state === "earning" || p.state === "at-risk") && p.valueUsd !== null && Number(p.valueUsd) > 0 && p.apy);
  const debts = all.filter((p) => p.valueUsd !== null && Number(p.valueUsd) < 0);
  const wallet = all.filter((p) => p.venue === "wallet");
  const unpricedWallet = wallet.filter((p) => p.valueUsd === null);
  const idle = wallet.reduce((a, p) => a + (p.valueUsd === null ? 0 : Number(p.valueUsd)), 0);
  const lines: FoldExplainArtifact["lines"][number][] = [];
  const from = (p: (typeof all)[number]): BlockSource => ({ source: sample ? "sample" : (p.apy?.source ?? p.source).slice(0, 80), readAt: isoOf(p.readAt), block: blockOf(p.block), venue: p.venueName.slice(0, 60) });
  for (const p of earning) lines.push({ label: p.label, value: usd(Number(p.valueUsd)), note: `${p.apy!.percent}% a year (${p.apy!.kind})`, from: from(p) });
  for (const p of debts) lines.push({ label: p.label, value: `−${usd(Math.abs(Number(p.valueUsd)))}`, note: p.apy ? `${p.apy.percent}% a year accrues against your yield` : "interest accrues against your yield", from: from(p) });
  lines.push({ label: "Resting in the wallet", value: usd(idle), note: unpricedWallet.length > 0 ? `plus ${unpricedWallet.length} unpriced holding${unpricedWallet.length === 1 ? "" : "s"} (no price, not counted as $0)` : "earns nothing; kept liquid for gas and payments", from: mapFrom });
  // The same figure as the Trails totals: one function over the same trail (core trailFeesUsd).
  const fees = sample ? "0.00" : (await trailsFor(ctx, owner)).totals.feesUsd;
  lines.push({ label: `Lykia fees, last ${TRAIL_FEE_WINDOW_DAYS} days`, value: `$${fees}`, note: "1% of the amount moved, paid on chain in the same transaction", from: records });
  const s = map.summary;
  const earningUsd = earning.reduce((a, p) => a + Number(p.valueUsd), 0);
  const blended = s.weightedApyPercent !== null ? `${s.weightedApyPercent}% blended` : "a blended rate that is unavailable";
  const yearly = s.yearlyYieldUsd !== null ? `${usd(Number(s.yearlyYieldUsd))} a year net of borrowing at today's rates` : "a yearly figure that is unavailable";
  return {
    kind: "yield",
    title: "Where your yield comes from",
    summary: earning.length === 0 ? `Nothing earns yet: ${usd(idle)} rests in the wallet. Ask Lyko to put part of it to work.` : `${usd(earningUsd)} earns ${blended}, ${yearly}; ${usd(idle)} rests in the wallet.`,
    lines,
    sources: [sample ? "sample" : "the position map", ...new Set(earning.map((p) => p.apy!.source)), "Trails (fees)"],
    at,
    block: mapFrom.block,
  };
}

/** Answers a chip and writes the exchange to the shared thread (origin: the Fold). */
export async function answer(ctx: AppContext, environment: ArcEnvironment, owner: Address, question: FoldQuestion, threadId: string | undefined, shocks?: FoldShocks): Promise<FoldAnswerResponse> {
  const text = question === "whatif" && shocks ? `Am I safe if ${(["EURC", "cirBTC"] as const).filter((k) => shocks[k] !== 0).map((k) => `${k} moves ${shocks[k]}%`).join(" and ") || "nothing moves"}?` : QUESTIONS[question];
  const artifact = await explain(ctx, environment, owner, question, shocks);
  const reply = artifact.summary;
  if (isSampleOwner(owner)) return { threadId: "sample", question: text, reply, artifact };
  const thread = await openThread(ctx, owner, environment, threadId, text);
  await appendMessages(ctx, thread, [
    { role: "user", text, origin: "fold" },
    { role: "assistant", text: reply, origin: "fold" },
  ]);
  return { threadId: thread.id, question: text, reply, artifact };
}
