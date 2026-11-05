/**
 * Proposals: every draft Lyko makes for the owner outside a chat turn (a
 * one-tap insight draft, an automation that fired, a Fence edit, a holding
 * action) lands here with an id, an audit entry and a lifecycle:
 *
 *   proposed  -> approved (the owner signed or accepted it)  -> done
 *   proposed | approved -> stopped
 *
 * Plans go through the same planner as everything else, under the owner's
 * Fence, with Lykia's fee and the beta cap. Nothing is signed here. The feed
 * keeps every transition for 30 days; acting on an insight marks it handled
 * until its condition changes.
 */
import { deriveIntentStatus, type Address, type ArcEnvironment, type Fence, type UnsignedTransaction } from "@lykia/core";
import type { FoldFeedEntry, FoldProposal, FoldProposalSource, FoldProposalStatus } from "@lykia/core/api/fold";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { planSentence } from "../agents/engine.js";
import { randomHex } from "../platform/crypto.js";
import { typedCollection } from "../platform/typed.js";
import { auditSafe, ownerChain } from "../security/audit.js";
import { services } from "../services.js";

const PROPOSAL_TTL_MS = 30 * 86_400_000;
const HANDLED_TTL_MS = 7 * 86_400_000;
const MAX_OPEN_PROPOSALS = 50;

const proposals = (ctx: AppContext) => typedCollection<FoldProposal>(ctx, "fold_proposals");
const feed = (ctx: AppContext) => typedCollection<FoldFeedEntry>(ctx, "fold_feed");
const handled = (ctx: AppContext) => typedCollection<{ readonly fingerprint: string; readonly at: string }>(ctx, "fold_handled");

const key = (owner: string) => owner.toLowerCase();

/** Allowed moves between statuses. `done` and `stopped` are final. */
const TRANSITIONS: Readonly<Record<FoldProposalStatus, readonly FoldProposalStatus[]>> = {
  proposed: ["approved", "stopped"],
  approved: ["done", "stopped"],
  done: [],
  stopped: [],
};

export function canMove(from: FoldProposalStatus, to: FoldProposalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface CreateProposalInput {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly source: { readonly kind: FoldProposalSource; readonly ref: string | null };
  readonly title: string;
  readonly sentence?: string | null;
  readonly transactions?: readonly UnsignedTransaction[];
  readonly fencePatch?: Readonly<Record<string, unknown>>;
  readonly fence: Fence;
  /** The insight's fingerprint (its title), so it reads as handled until it changes. */
  readonly insightFingerprint?: string;
  /** Already planned elsewhere (an automation run): stored as is, not planned again. */
  readonly planned?: { readonly intentId: string | null; readonly decision: FoldProposal["decision"]; readonly reasons: readonly string[]; readonly steps: readonly string[] };
}

async function writeFeed(ctx: AppContext, p: FoldProposal, note: string | null): Promise<void> {
  const at = new Date(ctx.clock.now()).toISOString();
  const entry: FoldFeedEntry = { id: `${key(p.owner)}:${at}:${randomHex(3)}`, at, proposalId: p.id, status: p.status, title: p.title, note };
  await feed(ctx).put(entry.id, entry, { ttlMs: PROPOSAL_TTL_MS });
  await auditSafe(ctx, ownerChain(p.owner), { kind: "proposal", actor: key(p.owner), subject: p.id, data: { status: p.status, title: p.title.slice(0, 120), source: p.source.kind, intentId: p.intentId, ...(note ? { note: note.slice(0, 160) } : {}) } });
}

export async function createProposal(ctx: AppContext, input: CreateProposalInput): Promise<FoldProposal> {
  const owner = key(input.owner) as Address;
  const open = (await listProposals(ctx, owner, { reconcile: false })).filter((p) => p.status === "proposed" || p.status === "approved");
  if (open.length >= MAX_OPEN_PROPOSALS) throw new LykiaHttpError("CONFLICT", 409, `At most ${MAX_OPEN_PROPOSALS} open proposals; sign or stop some first.`);
  let planned = input.planned ?? null;
  const sentence = input.sentence?.trim() || null;
  if (!planned && sentence) {
    const outcome = await planSentence(ctx, sentence, { environment: input.environment, owner, fence: input.fence, proposedByAgent: true });
    if (outcome.kind === "planned") {
      const intent = outcome.result.intent;
      planned = {
        intentId: outcome.result.stored ? intent.id : null,
        decision: intent.verdict.decision,
        reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message),
        steps: intent.steps.map((s) => s.summary),
      };
    } else planned = { intentId: null, decision: outcome.kind === "refused" ? "deny" : "unknown", reasons: outcome.kind === "refused" ? [outcome.message] : outcome.questions, steps: [] };
  }
  const now = new Date(ctx.clock.now()).toISOString();
  const refused = planned?.decision === "deny";
  const proposal: FoldProposal = {
    id: `${owner}:prp_${randomHex(6)}`,
    owner,
    environment: input.environment,
    source: input.source,
    title: input.title.slice(0, 160),
    sentence,
    ...(input.transactions && input.transactions.length > 0 ? { transactions: input.transactions } : {}),
    ...(input.fencePatch ? { fencePatch: input.fencePatch } : {}),
    intentId: planned?.intentId ?? null,
    decision: planned?.decision ?? (input.transactions || input.fencePatch ? "confirm" : "unknown"),
    reasons: planned?.reasons ?? [],
    steps: planned?.steps ?? (input.transactions ?? []).map((t) => t.label ?? "Sign one transaction"),
    status: refused ? "stopped" : "proposed",
    outcome: refused ? `Refused by the Fence: ${(planned?.reasons ?? []).join(" ") || "a rule said no."}` : null,
    createdAt: now,
    updatedAt: now,
    history: [{ status: "proposed", at: now, note: null }, ...(refused ? [{ status: "stopped" as const, at: now, note: "Refused by the Fence." }] : [])],
  };
  await proposals(ctx).put(proposal.id, proposal, { ttlMs: PROPOSAL_TTL_MS });
  await writeFeed(ctx, proposal, refused ? "Refused by the Fence." : null);
  if (input.source.kind === "insight" && input.source.ref) await markHandled(ctx, owner, input.source.ref, input.insightFingerprint ?? input.title);
  return proposal;
}

export async function getProposal(ctx: AppContext, owner: Address, id: string): Promise<FoldProposal> {
  const doc = await proposals(ctx).get(id);
  if (!doc || !id.startsWith(`${key(owner)}:`)) throw new LykiaHttpError("NOT_FOUND", 404, "No such proposal for this owner.");
  return doc.value;
}

export async function moveProposal(ctx: AppContext, owner: Address, id: string, to: FoldProposalStatus, note: string | null = null): Promise<FoldProposal> {
  const current = await getProposal(ctx, owner, id);
  if (current.status === to) return current;
  if (!canMove(current.status, to)) throw new LykiaHttpError("CONFLICT", 409, `A ${current.status} proposal cannot become ${to}.`);
  if (to === "stopped" && current.intentId) await services(ctx).intents.stop(current.intentId).catch(() => undefined);
  const at = new Date(ctx.clock.now()).toISOString();
  const next: FoldProposal = { ...current, status: to, updatedAt: at, outcome: note ?? current.outcome, history: [...current.history, { status: to, at, note }] };
  await proposals(ctx).put(id, next, { ttlMs: PROPOSAL_TTL_MS });
  await writeFeed(ctx, next, note);
  return next;
}

/**
 * The owner's proposals, newest first. With `reconcile`, a proposal whose
 * intent settled becomes done, and one whose intent failed, stopped or was
 * denied becomes stopped, so the inbox never shows finished work as waiting.
 */
export async function listProposals(ctx: AppContext, owner: Address, options: { readonly reconcile?: boolean; readonly status?: FoldProposalStatus } = {}): Promise<FoldProposal[]> {
  let list = (await proposals(ctx).list({ prefix: `${key(owner)}:`, limit: 500 })).map((d) => d.value);
  if (options.reconcile !== false) {
    list = await Promise.all(
      list.map(async (p) => {
        if (!p.intentId || p.status === "done" || p.status === "stopped") return p;
        const intent = await services(ctx).intents.get(p.intentId).then((r) => r.intent).catch(() => null);
        if (!intent) return p;
        const status = deriveIntentStatus(intent);
        if (status === "settled") return moveTo(ctx, p, "done", "Every step settled on Arc.");
        if (status === "failed" || status === "stopped" || status === "denied") return moveTo(ctx, p, "stopped", `The plan ${status}.`);
        if (status === "running" && p.status === "proposed") return moveTo(ctx, p, "approved", "Signing started.");
        return p;
      }),
    );
  }
  if (options.status) list = list.filter((p) => p.status === options.status);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function moveTo(ctx: AppContext, p: FoldProposal, to: FoldProposalStatus, note: string): Promise<FoldProposal> {
  // Settling can skip "approved" (signed in one go): pass through it so the history reads right.
  if (p.status === "proposed" && to === "done") p = await moveTo(ctx, p, "approved", "Signed.");
  if (!canMove(p.status, to)) return p;
  return moveProposal(ctx, p.owner, p.id, to, note).catch(() => p);
}

export async function listFeed(ctx: AppContext, owner: Address, limit = 100): Promise<FoldFeedEntry[]> {
  return (await feed(ctx).list({ prefix: `${key(owner)}:`, limit: 1000 }))
    .map((d) => d.value)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

async function markHandled(ctx: AppContext, owner: Address, insightId: string, fingerprint: string): Promise<void> {
  await handled(ctx).put(`${key(owner)}:${insightId}`, { fingerprint, at: new Date(ctx.clock.now()).toISOString() }, { ttlMs: HANDLED_TTL_MS });
}

/** Insight ids the owner acted on, with the fingerprint they had then. */
export async function handledInsights(ctx: AppContext, owner: Address): Promise<Map<string, string>> {
  const prefix = `${key(owner)}:`;
  const docs = await handled(ctx).list({ prefix, limit: 500 }).catch(() => []);
  return new Map(docs.map((d) => [d.id.slice(prefix.length), d.value.fingerprint]));
}
