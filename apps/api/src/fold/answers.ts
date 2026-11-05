/**
 * Structured answers for Lyko on watch's follow-up chips ("Explain my
 * yield", "Am I safe if EURC drops 5%?", "What runs this week?", "Tidy my
 * approvals"). Each one is computed here from live reads, returned as an
 * artifact (label, value, note per line) and written to the owner's shared
 * thread, so Ask Lyko sees the same conversation.
 */
import { applyFoldShocks, describeShock, fenceForProfile, formatUsdMicros, NO_SHOCK, riskTierOf, usdMicros, type Address, type ArcEnvironment, type FoldShocks } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { FoldAnswerResponse, FoldExplainArtifact, FoldQuestion, FoldWhatIfResponse } from "@lykia/core/api/fold";
import type { AppContext } from "../context.js";
import { appendMessages, openThread } from "../agents/memory.js";
import { staleApprovals } from "../agents/insights.js";
import { getProfile } from "../personal/profile.js";
import { services } from "../services.js";
import { instructionsFor } from "./instructions.js";
import { getPreferences } from "./preferences.js";
import { ownerIntents } from "./trails.js";
import { withTimeout } from "./util.js";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const QUESTIONS: Readonly<Record<FoldQuestion, string>> = {
  yield: "Explain my yield",
  whatif: "Am I safe if EURC drops 5%?",
  week: "What runs this week?",
  approvals: "Tidy my approvals",
};

async function minHealth(ctx: AppContext, owner: Address): Promise<number> {
  const [profile, prefs] = await Promise.all([getProfile(ctx, owner), getPreferences(ctx, owner)]);
  return Number(fenceForProfile({ ...profile, risk: riskTierOf(prefs.risk) }).lending?.minHealthFactor ?? "1.2");
}

function whatIf(snap: FlockSnapshot, shocks: FoldShocks, floor: number): { result: ReturnType<typeof applyFoldShocks>; sentence: string } {
  const result = applyFoldShocks(snap.holdings, snap.health, shocks);
  return { result, sentence: describeShock(result, shocks, floor) };
}

export async function whatIfFor(ctx: AppContext, environment: ArcEnvironment, owner: Address, shocks: FoldShocks): Promise<FoldWhatIfResponse> {
  const [snap, floor] = await Promise.all([services(ctx).flock.snapshot(environment, owner), minHealth(ctx, owner)]);
  const { result, sentence } = whatIf(snap, shocks, floor);
  return { owner: owner.toLowerCase() as Address, environment, shocks, result, sentence };
}

export async function explain(ctx: AppContext, environment: ArcEnvironment, owner: Address, question: FoldQuestion, shocks: FoldShocks = { ...NO_SHOCK, EURC: -5 }): Promise<FoldExplainArtifact> {
  const at = new Date(ctx.clock.now()).toISOString();
  if (question === "whatif") {
    const w = await whatIfFor(ctx, environment, owner, shocks);
    return {
      kind: "whatif",
      title: "If prices move",
      summary: w.sentence,
      lines: [
        { label: "Flock now", value: usd(w.result.before), note: null },
        { label: "After the shock", value: usd(w.result.after), note: null },
        ...w.result.health.map((h) => ({ label: `Health on ${h.venue}`, value: h.after === null ? "unknown" : h.after.toFixed(2), note: h.before === null ? null : `now ${h.before.toFixed(2)}` })),
      ],
      sources: ["Flock snapshot", "Chainlink prices", "the shared shock model"],
      at,
    };
  }
  if (question === "week") {
    const now = ctx.clock.now();
    const all = await instructionsFor(ctx, owner);
    const week = all.filter((i) => i.status === "active" && i.nextRunAt && Date.parse(i.nextRunAt) - now <= 7 * 86_400_000);
    const onEvent = all.filter((i) => i.status === "active" && !i.nextRunAt).length;
    return {
      kind: "week",
      title: "This week in Herding",
      summary: week.length === 0 ? `Nothing is scheduled for the next seven days${onEvent > 0 ? `; ${onEvent} instruction(s) wait for a price or an event` : ""}.` : `${week.length} run(s) in the next seven days${onEvent > 0 ? `, and ${onEvent} waiting for a price or an event` : ""}.`,
      lines: week.map((i) => ({ label: i.name, value: i.nextRunLabel, note: i.nextVerdict ? `${i.nextVerdict.decision}: ${i.nextVerdict.reason}` : null })),
      sources: ["automations", "standing orders", "orders", "alerts"],
      at,
    };
  }
  if (question === "approvals") {
    const list = await staleApprovals(ctx, environment, owner);
    return {
      kind: "approvals",
      title: "Open approvals",
      summary: list.length === 0 ? "No allowances are left open to the venues Lykia knows. Nothing to tidy." : `${list.length} allowance(s) are open. Lyko drafted one revoke each; sign them from the insight or from Herding.`,
      lines: list.map((a) => ({ label: a.title, value: a.severity === "act" ? "unlimited" : "limited", note: a.detail.slice(0, 140) })),
      sources: ["ERC-20 allowance reads on Arc"],
      at,
    };
  }
  // yield
  const snap = await services(ctx).flock.snapshot(environment, owner);
  const rates = await withTimeout(services(ctx).yields.rates(environment).catch(() => null), 2_500);
  const earning = snap.holdings.filter((h) => (h.kind === "vault" || h.kind === "supply") && h.usd !== null);
  const idle = snap.holdings.filter((h) => h.where === "wallet" && h.kind === "token" && (h.symbol === "USDC" || h.symbol === "EURC")).reduce((a, h) => a + Number(h.usd ?? 0), 0);
  let yearly = 0;
  const lines: FoldExplainArtifact["lines"][number][] = [];
  for (const h of earning) {
    const v = rates?.vaults.find((x) => x.address.toLowerCase() === h.token.toLowerCase());
    const apy = v?.apy ? Number(v.apy) * 100 : null;
    if (apy !== null) yearly += (Number(h.usd) * apy) / 100;
    lines.push({ label: `${h.symbol} · ${h.where}`, value: usd(Number(h.usd)), note: apy === null ? "rate not available right now" : `${apy.toFixed(2)}% a year ≈ ${usd((Number(h.usd) * apy) / 100)}` });
  }
  const debt = snap.holdings.filter((h) => h.kind === "debt" && h.usd !== null);
  for (const h of debt) lines.push({ label: `Borrowed ${h.symbol} · ${h.where}`, value: `−${usd(Math.abs(Number(h.usd)))}`, note: "interest accrues against your yield" });
  lines.push({ label: "Resting in the wallet", value: usd(idle), note: "earns nothing; kept liquid for gas and payments" });
  const since = ctx.clock.now() - 30 * 86_400_000;
  let fees = 0n;
  for (const g of await ownerIntents(ctx, owner)) for (const s of g.steps) if (s.status === "settled" && s.fee?.usd && Date.parse(s.settledAt ?? g.createdAt) >= since) fees += usdMicros(s.fee.usd);
  lines.push({ label: "Lykia fees, last 30 days", value: `$${formatUsdMicros(fees)}`, note: "1% of the amount moved, paid on chain in the same transaction" });
  const total = Number(snap.totalUsd ?? 0);
  return {
    kind: "yield",
    title: "Where your yield comes from",
    summary: earning.length === 0 ? `Nothing earns yet: ${usd(idle)} rests in the wallet. Ask Lyko to put part of it to work.` : `${usd(earning.reduce((a, h) => a + Number(h.usd), 0))} earns${yearly > 0 ? ` about ${usd(yearly)} a year (${total > 0 ? ((yearly / total) * 100).toFixed(2) : "0"}% on the whole Flock)` : ""}; ${usd(idle)} rests in the wallet.`,
    lines,
    sources: ["Flock snapshot", rates ? "Morpho and Aave rate APIs" : "rates unavailable", "Trails (fees)"],
    at,
  };
}

/** Answers a chip and writes the exchange to the shared thread (origin: the Fold). */
export async function answer(ctx: AppContext, environment: ArcEnvironment, owner: Address, question: FoldQuestion, threadId: string | undefined, shocks?: FoldShocks): Promise<FoldAnswerResponse> {
  const text = question === "whatif" && shocks ? `Am I safe if ${(["EURC", "cirBTC"] as const).filter((k) => shocks[k] !== 0).map((k) => `${k} moves ${shocks[k]}%`).join(" and ") || "nothing moves"}?` : QUESTIONS[question];
  const artifact = await explain(ctx, environment, owner, question, shocks);
  const reply = artifact.summary;
  const thread = await openThread(ctx, owner, environment, threadId, text);
  await appendMessages(ctx, thread, [
    { role: "user", text, origin: "fold" },
    { role: "assistant", text: reply, origin: "fold" },
  ]);
  return { threadId: thread.id, question: text, reply, artifact };
}
