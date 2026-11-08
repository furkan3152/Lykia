/**
 * The hand-offs between Lyko on watch and Ask Lyko (core/agentInstructions).
 *
 *   plan   From an insight: the server's own draft (never the request's) is
 *          planned under the owner's Fence as a staged plan, filed as a Fold
 *          proposal (so the insight reads as handled) and written to the
 *          shared thread with "From Lyko on watch". Its status follows the
 *          plan: planned, signed, done, stopped.
 *   watch  From a chat request or "Watch this position": a condition Lyko on
 *          watch checks each time it reads the Fold. When it is met, the
 *          Fold shows an insight marked "From Ask Lyko".
 *
 * Owner-only: every write and read needs the owner's proof (modules/instructions.ts).
 */
import {
  checkWatch,
  instructionChip,
  moveInstruction,
  planStatusOf,
  readWatchRequest,
  routingIssue,
  watchForPlan,
  watchIssue,
  watchLabel,
  type Address,
  type AgentInstruction,
  type AgentInstructionKind,
  type AgentInstructionStatus,
  type AgentRole,
  type ArcEnvironment,
  type Fence,
  type PlanPayload,
  type WatchCondition,
  type WatchFacts,
  type WatchPayload,
} from "@lykia/core";
import type { AgentProposal } from "@lykia/core/api/agents";
import type { FoldInsight as FoldInsightView } from "@lykia/core/api/fold";

type FoldInsight = FoldInsightView;
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { randomHex } from "../platform/crypto.js";
import { typedCollection } from "../platform/typed.js";
import { services } from "../services.js";
import { appendMessages, openThread, threadSummaries } from "./memory.js";
import type { InsightInputs } from "../fold/insights.js";

const TTL_MS = 90 * 86_400_000;
const MAX_ACTIVE_WATCHES = 20;

const store = (ctx: AppContext) => typedCollection<AgentInstruction>(ctx, "agent_instructions");
const ownerKey = (owner: string) => owner.toLowerCase();
const nowIso = (ctx: AppContext) => new Date(ctx.clock.now()).toISOString();

export interface InstructionFilter {
  readonly to?: AgentRole;
  readonly kind?: AgentInstructionKind;
  readonly status?: AgentInstructionStatus;
  readonly environment?: ArcEnvironment;
}

async function put(ctx: AppContext, i: AgentInstruction): Promise<AgentInstruction> {
  await store(ctx).put(i.id, i, { ttlMs: TTL_MS });
  return i;
}

/** A plan instruction caught up with its plan (planned -> signed -> done, or stopped). */
async function reconcile(ctx: AppContext, i: AgentInstruction): Promise<AgentInstruction> {
  if (i.kind !== "plan" || (i.status !== "planned" && i.status !== "signed")) return i;
  const intentId = (i.payload as PlanPayload).intentId;
  if (!intentId) return i;
  const graph = await services(ctx).intents.get(intentId).then((r) => r.intent).catch(() => null);
  if (!graph) return i;
  const next = planStatusOf(graph);
  if (next === i.status || (next === "planned" && i.status === "signed")) return i;
  try {
    return await put(ctx, moveInstruction(i, next, nowIso(ctx)));
  } catch {
    return i;
  }
}

export async function listInstructions(ctx: AppContext, owner: Address, filter: InstructionFilter = {}): Promise<AgentInstruction[]> {
  const rows = (await store(ctx).list({ prefix: `${ownerKey(owner)}:`, limit: 200 })).map((d) => d.value);
  const kept = rows.filter((i) => (!filter.to || i.to === filter.to) && (!filter.kind || i.kind === filter.kind) && (!filter.environment || i.environment === filter.environment) && i.status !== "removed");
  const fresh = await Promise.all(kept.map((i) => reconcile(ctx, i)));
  return fresh.filter((i) => !filter.status || i.status === filter.status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getInstruction(ctx: AppContext, owner: Address, id: string): Promise<AgentInstruction> {
  const doc = id.startsWith(`${ownerKey(owner)}:`) ? await store(ctx).get(id) : null;
  if (!doc || doc.value.status === "removed") throw new LykiaHttpError("NOT_FOUND", 404, "No such instruction for this owner.");
  return doc.value;
}

/** The shared thread a hand-off goes to: the one named, else the owner's latest, else a new one. */
async function sharedThread(ctx: AppContext, owner: Address, environment: ArcEnvironment, threadId: string | null | undefined, title: string) {
  const latest = threadId ?? (await threadSummaries(ctx, owner, 1).catch(() => []))[0]?.id;
  return openThread(ctx, owner, environment, latest ?? undefined, title);
}

function base(owner: Address, environment: ArcEnvironment, from: AgentRole, to: AgentRole, kind: AgentInstructionKind, at: string): Omit<AgentInstruction, "payload" | "status" | "threadId"> {
  return { id: `${ownerKey(owner)}:ins_${randomHex(8)}`, owner: ownerKey(owner) as Address, environment, from, to, kind, createdAt: at, updatedAt: at };
}

/** "Health factor now 1.31 · Your Fence floor 1.5": the insight's first figures, as the reason. */
function reasonOf(insight: FoldInsightView): string {
  return insight.figures.slice(0, 2).map((f) => `${f.label} ${f.value}`).join(" · ") || insight.title;
}

export interface PlanHandoff {
  readonly instruction: AgentInstruction;
  readonly proposal: AgentProposal;
  readonly threadId: string;
}

/**
 * Lyko on watch -> Ask Lyko: plan the insight's own draft as a staged plan,
 * file it as a Fold proposal and write it to the shared thread.
 */
export async function handInsightToAsk(ctx: AppContext, input: { readonly owner: Address; readonly environment: ArcEnvironment; readonly insightId: string; readonly fence: Fence; readonly threadId?: string | null }): Promise<PlanHandoff> {
  const { foldInsights } = await import("../fold/insights.js");
  const { createProposal } = await import("../fold/proposals.js");
  const found = (await foldInsights(ctx, input.environment, input.owner, true)).insights.find((i) => i.id === input.insightId);
  if (!found) throw new LykiaHttpError("CONFLICT", 409, "That insight no longer applies; the Fold has changed since it was shown.");
  const sentence = found.draft?.sentence ?? null;
  if (!sentence) throw new LykiaHttpError("CONFLICT", 409, "That insight has no move to plan; open it in Ask Lyko to talk it through.");
  const at = nowIso(ctx);
  const title = `${found.draft!.label}: ${found.title}`.slice(0, 160);
  const reason = reasonOf(found);
  const head = base(input.owner, input.environment, "watch", "ask", "plan", at);
  const filed = await createProposal(ctx, { owner: input.owner, environment: input.environment, fence: input.fence, source: { kind: "insight", ref: found.id }, title, sentence, insightFingerprint: found.title });
  const status: AgentInstructionStatus = filed.intentId && filed.decision !== "deny" ? "planned" : "refused";
  const thread = await sharedThread(ctx, input.owner, input.environment, input.threadId, title);
  const proposal: AgentProposal = {
    intentId: filed.intentId,
    title,
    steps: filed.steps,
    decision: filed.decision === "unknown" ? "confirm" : filed.decision,
    reasons: filed.reasons,
    warnings: [],
    attribution: [{ agent: "Lyko on watch", role: "sentinel", part: "noticed it" }, { agent: "Lyko", role: "orchestrator", part: "planned it" }],
    rationale: reason,
    from: { agent: "watch", instructionId: head.id },
  };
  const instruction: AgentInstruction = { ...head, payload: { kind: "plan", sentence, title, reason, insightId: found.id, intentId: filed.intentId }, status, threadId: thread.id };
  await put(ctx, instruction);
  const text = status === "planned"
    ? `From Lyko on watch: ${found.draft!.label.toLowerCase()}. Planned step by step; review and sign it here.`
    : `From Lyko on watch: ${found.draft!.label.toLowerCase()}. Your Fence refused the plan: ${filed.reasons.join(" ") || "a rule said no."}`;
  await appendMessages(ctx, thread, [{ role: "assistant", text, proposals: filed.intentId ? [proposal] : [], origin: "fold", instruction: { id: instruction.id, from: "watch", to: "ask", kind: "plan", label: title } }]);
  return { instruction, proposal, threadId: thread.id };
}

/**
 * Ask Lyko -> Lyko on watch: a watch task, from a condition or from a
 * settled plan ("Watch this position"). The same active condition is not
 * set twice.
 */
export async function createWatch(ctx: AppContext, input: { readonly owner: Address; readonly environment: ArcEnvironment; readonly condition?: WatchCondition; readonly intentId?: string; readonly threadId?: string | null; readonly floor?: string; readonly note?: boolean }): Promise<AgentInstruction> {
  let condition = input.condition ?? null;
  if (!condition && input.intentId) {
    const graph = await services(ctx).intents.get(input.intentId).then((r) => r.intent).catch(() => null);
    if (!graph || graph.owner.toLowerCase() !== ownerKey(input.owner)) throw new LykiaHttpError("NOT_FOUND", 404, "No such plan for this owner.");
    condition = watchForPlan(graph, input.floor);
    if (!condition) throw new LykiaHttpError("CONFLICT", 409, "Nothing in this plan has a health factor or a rate to watch.");
  }
  if (!condition) throw new LykiaHttpError("INVALID_REQUEST", 400, "Name the condition to watch, or the plan to watch.");
  const issue = watchIssue(condition);
  if (issue) throw new LykiaHttpError("INVALID_REQUEST", 400, issue);
  const label = watchLabel(condition);
  const active = await listInstructions(ctx, input.owner, { kind: "watch", environment: input.environment });
  const same = active.find((i) => (i.payload as WatchPayload).label === label && i.status !== "removed");
  if (same) return same;
  if (active.filter((i) => i.status === "active").length >= MAX_ACTIVE_WATCHES) throw new LykiaHttpError("CONFLICT", 409, `At most ${MAX_ACTIVE_WATCHES} active watch tasks; remove one first.`);
  const at = nowIso(ctx);
  const instruction: AgentInstruction = { ...base(input.owner, input.environment, "ask", "watch", "watch", at), payload: { kind: "watch", condition, label, intentId: input.intentId ?? null, fired: 0, lastFiredAt: null, observation: null }, status: "active", threadId: input.threadId ?? null };
  await put(ctx, instruction);
  if (input.note && input.threadId) {
    const thread = await openThread(ctx, input.owner, input.environment, input.threadId, label);
    await appendMessages(ctx, thread, [{ role: "assistant", text: `Ask Lyko handed this to Lyko on watch: ${label}. It shows in the Fold and is checked each time Lyko on watch reads it.`, origin: "ask", instruction: { id: instruction.id, from: "ask", to: "watch", kind: "watch", label } }]).catch(() => undefined);
  }
  return instruction;
}

/** Pause, resume or remove a watch task. */
export async function moveWatch(ctx: AppContext, owner: Address, id: string, action: "pause" | "resume" | "remove"): Promise<AgentInstruction> {
  const i = await getInstruction(ctx, owner, id);
  if (i.kind !== "watch") throw new LykiaHttpError("CONFLICT", 409, "Only watch tasks are paused or removed; a plan is stopped from its card.");
  const to: AgentInstructionStatus = action === "pause" ? "paused" : action === "resume" ? "active" : "removed";
  try {
    return await put(ctx, moveInstruction(i, to, nowIso(ctx)));
  } catch (error) {
    throw new LykiaHttpError("CONFLICT", 409, error instanceof Error ? error.message : "That move is not allowed.");
  }
}

/** Validates who hands what to whom before anything is stored. */
export function assertRouting(input: { readonly from: AgentRole; readonly to: AgentRole; readonly kind: AgentInstructionKind }): void {
  const issue = routingIssue(input);
  if (issue) throw new LykiaHttpError("INVALID_REQUEST", 400, issue);
}

/** The watch facts from what the Fold already read. */
export function watchFactsOf(inputs: Pick<InsightInputs, "snapshot" | "positions">, health: WatchFacts["health"]): WatchFacts {
  const all = (inputs.positions?.venues ?? []).flatMap((v) => v.positions);
  const wallet: Record<string, number> = {};
  for (const h of inputs.snapshot.holdings) if (h.where === "wallet" && h.kind === "token") wallet[h.symbol] = (wallet[h.symbol] ?? 0) + Number(h.amount);
  return {
    health,
    ranges: all.filter((p) => p.range).map((p) => ({ venue: p.venue, label: p.label, inRange: p.range!.inRange })),
    wallet,
    rates: all.filter((p) => p.apy && Number(p.valueUsd ?? 0) > 0).map((p) => ({ venue: p.venue, label: p.label, percent: Number(p.apy!.percent) })),
  };
}

/**
 * Checks the owner's active watch tasks against the Fold, records what each
 * saw, and returns an insight for each one whose condition is met. A watch
 * whose condition becomes met counts one firing; it fires again only after
 * it has been clear.
 */
export async function fireWatches(ctx: AppContext, owner: Address, environment: ArcEnvironment, facts: WatchFacts, drafts: readonly Omit<FoldInsight, "handled">[]): Promise<Omit<FoldInsight, "handled">[]> {
  const watches = (await listInstructions(ctx, owner, { kind: "watch", environment, status: "active" }).catch(() => [])).slice(0, MAX_ACTIVE_WATCHES);
  const out: Omit<FoldInsight, "handled">[] = [];
  for (const w of watches) {
    const p = w.payload as WatchPayload;
    const check = checkWatch(p.condition, facts);
    const wasMet = p.met === true;
    if (check.observation !== p.observation || check.met !== wasMet) {
      const at = nowIso(ctx);
      const next: WatchPayload = { ...p, observation: check.observation, met: check.met, ...(check.met && !wasMet ? { fired: p.fired + 1, lastFiredAt: at } : {}) };
      await put(ctx, { ...w, payload: next, updatedAt: at }).catch(() => undefined);
    }
    if (!check.met) continue;
    const related = p.condition.kind === "health-below" ? drafts.find((d) => d.kind === "health-factor" && d.draft) : p.condition.kind === "lp-out-of-range" ? drafts.find((d) => d.kind === "lp-out-of-range") : p.condition.kind === "idle-above" ? drafts.find((d) => d.kind === "idle-usdc" && d.draft) : drafts.find((d) => d.kind === "yield-change" && d.draft);
    out.push({
      id: `watch-${w.id.split(":ins_")[1] ?? w.id.slice(-16)}`,
      kind: "watch-task",
      severity: p.condition.kind === "health-below" ? "act" : "watch",
      title: check.observation,
      explain: `You asked Ask Lyko to watch this (${p.label.charAt(0).toLowerCase()}${p.label.slice(1)}), and it is met now.${related?.draft ? " Lyko on watch has a move ready below." : ""}`,
      figures: [{ label: "Watching", value: p.label }, { label: "Now", value: check.observation }, { label: "Set", value: w.createdAt.slice(0, 10) }],
      draft: related?.draft ?? null,
      origin: { agent: "ask", instructionId: w.id },
    });
  }
  return out;
}

/** "Sent to Ask Lyko · planned" on each insight that was handed over (the latest hand-off per insight). */
export async function sentMarks(ctx: AppContext, owner: Address, environment: ArcEnvironment): Promise<Map<string, NonNullable<FoldInsightView["sent"]>>> {
  const plans = await listInstructions(ctx, owner, { kind: "plan", environment }).catch(() => []);
  const marks = new Map<string, NonNullable<FoldInsightView["sent"]>>();
  for (const i of plans) {
    const p = i.payload as PlanPayload;
    if (!p.insightId || marks.has(p.insightId)) continue;
    marks.set(p.insightId, { instructionId: i.id, status: i.status, intentId: p.intentId ?? null, threadId: i.threadId });
  }
  return marks;
}

/** The chat side of a watch request: the reader's condition, or null when the sentence is not one. */
export function watchRequestOf(text: string, floor?: string) {
  return readWatchRequest(text, floor);
}

export { instructionChip };
