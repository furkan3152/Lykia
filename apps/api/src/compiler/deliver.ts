/**
 * What the chat does with a compiled program: turn it into a proposal the
 * owner signs (the plan for now), save or link its drafts, and build the
 * view the Ask page renders.
 *
 * Drafts follow the ownerVerified rule: automations and alerts are saved
 * only when the request proved control of the owner's address (a SIWE
 * session, or a secret key acting for it); otherwise nothing is saved and
 * the owner gets a link to the prefilled form. Orders become order cards in
 * the chat, checked against the Fence and the beta cap now and signed by the
 * owner in their wallet; budgets are Fence changes the owner signs.
 */
import { leashDraftBlock } from "../agents/create.js";
import type { Address, ArcEnvironment, Fence } from "@lykia/core";
import type { AgentProposal, AnswerBlock, ChatDraftLink, ChatProgramView } from "@lykia/core/api/agents";
import { ordersService } from "../orders/service.js";
import { orderVerdict, quoteOf } from "../orders/verdict.js";
import type { AppContext } from "../context.js";
import { alertsService } from "../alerts/service.js";
import { planActions } from "../agents/engine.js";
import { createAutomation } from "../devflows/automations.js";
import type { CompileResult } from "./service.js";

export interface DeliverContext {
  readonly ctx: AppContext;
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  readonly fence: Fence;
  /** Proven control of `owner` (with who saves for it); null = links only. */
  readonly verified: { readonly developer: string; readonly via: "session" | "secret"; readonly projectId?: string } | null;
  readonly agent: { readonly name: string; readonly role: AgentProposal["attribution"][number]["role"] };
  readonly proposedByAgent: boolean;
}

export interface Delivered {
  readonly proposal: AgentProposal | null;
  readonly drafts: readonly ChatDraftLink[];
  readonly view: ChatProgramView;
  readonly planError: string | null;
  /** One signable order card per LykiaOrders order the program drafts (sample owners get none: nothing can be signed). */
  readonly blocks: readonly AnswerBlock[];
}

const SAMPLE = "0x000000000000000000000000000000000000dead";

/** The program's orders as order cards: drafted for the owner and judged by the Fence and the beta cap now. */
async function orderCards(d: DeliverContext, result: CompileResult): Promise<AnswerBlock[]> {
  if (d.owner.toLowerCase() === SAMPLE) return [];
  const out: AnswerBlock[] = [];
  for (const s of result.scheduled) {
    if (s.kind !== "order" || out.length >= 3) continue;
    const o = s.order;
    try {
      const draft = await ordersService(d.ctx).draft({ ...o, owner: d.owner, environment: d.environment });
      const verdict = await orderVerdict(d.ctx, { environment: d.environment, owner: d.owner, sell: o.sell, buy: o.buy, perExecution: o.amount, fence: d.fence, quote: quoteOf(draft, o.triggerPrice) });
      out.push({
        kind: "order",
        summary: draft.summary.slice(0, 240),
        environment: d.environment,
        decision: verdict.decision,
        reasons: verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message.slice(0, 300)).slice(0, 6),
        perExecution: { fee: draft.perExecution.fee, swapped: draft.perExecution.swapped, minOut: draft.perExecution.minOut, symbolIn: draft.perExecution.symbolIn, symbolOut: draft.perExecution.symbolOut },
        approval: draft.approval ? draft.approval.label.slice(0, 200) : null,
        executions: draft.order.executions,
        input: { kind: o.kind, sell: o.sell, buy: o.buy, amount: o.amount, ...(o.executions !== undefined ? { executions: o.executions } : {}), ...(o.intervalSeconds !== undefined ? { intervalSeconds: o.intervalSeconds } : {}), ...(o.triggerPrice !== undefined ? { triggerPrice: o.triggerPrice } : {}), ...(o.triggerAbove !== undefined ? { triggerAbove: o.triggerAbove } : {}) },
      });
    } catch {
      /* not deployed here, or no price: the program view still lists it */
    }
  }
  return out;
}

/** Plans the program's actions for now as one intent (dry run for the sample owner), with the program digest pinned. */
async function proposalOf(d: DeliverContext, result: CompileResult): Promise<{ proposal: AgentProposal | null; error: string | null }> {
  if (!result.now || result.status === "refused") return { proposal: null, error: null };
  const best = result.now.search?.best as { actions?: readonly unknown[] } | null | undefined;
  const actions = (best?.actions as typeof result.now.actions | undefined) ?? result.now.actions;
  const outcome = await planActions(d.ctx, actions, result.program.text.slice(0, 500), { environment: d.environment, owner: d.owner, fence: d.fence, proposedByAgent: d.proposedByAgent, program: result.programHash as `sha256:${string}` });
  if (outcome.kind !== "planned") return { proposal: null, error: outcome.kind === "refused" ? outcome.message : outcome.reply };
  const { intent } = outcome.result;
  return {
    proposal: {
      intentId: outcome.result.stored ? intent.id : null,
      title: result.program.goals.slice(0, 3).join(" · ") || "Compiled plan",
      steps: intent.steps.map((s) => s.summary),
      decision: intent.verdict.decision,
      reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message),
      warnings: intent.warnings,
      attribution: [{ agent: d.agent.name, role: d.agent.role, part: "compiled program" }],
      rationale: result.now.parts.map((p) => p.rationale).join(" "),
    },
    error: null,
  };
}

/** Saves automations and alerts for a verified owner, otherwise returns links to the prefilled forms. */
async function draftsOf(d: DeliverContext, result: CompileResult): Promise<Map<number, ChatDraftLink>> {
  const out = new Map<number, ChatDraftLink>();
  for (const [i, s] of result.scheduled.entries()) {
    if (!s.valid) continue;
    if (s.kind === "automation") {
      if (s.roundTrip === "mismatch") continue;
      if (d.verified) {
        try {
          await createAutomation(d.ctx, { developer: d.verified.developer, project: null, via: d.verified.via, consentProject: d.verified.projectId ?? null }, { owner: d.owner, name: s.draft.name, environment: d.environment, trigger: s.draft.trigger, action: s.draft.action, fence: d.fence });
          out.set(i, { kind: "automation", saved: true, label: s.draft.name, href: "/app/fold/herding?show=automations" });
          continue;
        } catch {
          /* fall back to the link */
        }
      }
      out.set(i, { kind: "automation", saved: false, label: s.draft.name, href: s.link });
    } else if (s.kind === "alert") {
      if (d.verified) {
        try {
          await alertsService(d.ctx).create({ owner: d.owner, environment: d.environment, ...s.draft });
          out.set(i, { kind: "alert", saved: true, label: s.summary, href: "/app/fold/herding?show=watches" });
          continue;
        } catch {
          /* fall back to the link */
        }
      }
      out.set(i, { kind: "alert", saved: false, label: s.summary, href: s.link });
    }
  }
  return out;
}

export function programView(result: CompileResult, overrides: Readonly<Record<string, string>> = {}, saved: ReadonlyMap<number, ChatDraftLink> = new Map(), intentId: string | null = null, nowVerdict?: { decision: "allow" | "confirm" | "deny" | "unknown"; reasons: readonly string[] }): ChatProgramView {
  const r = result.resolution;
  return {
    programHash: result.programHash,
    resolutionHash: result.resolutionHash,
    status: result.status,
    source: result.source,
    text: result.program.text,
    overrides,
    summary: result.why.summary,
    goals: result.program.goals,
    hypothetical: result.hypothetical,
    now: result.now ? { steps: result.now.parts.map((p) => ({ summary: p.summary, rationale: p.rationale })), decision: nowVerdict?.decision ?? result.now.verdict.decision, reasons: nowVerdict?.reasons ?? result.now.verdict.reasons, intentId: intentId ?? result.now.intentId } : null,
    scheduled: result.scheduled.map((s, i) => ({ kind: s.kind, summary: s.summary, rationale: s.rationale, href: saved.get(i)?.href ?? s.link, saved: saved.get(i)?.saved ?? false, decision: s.verdict.decision, reasons: s.verdict.reasons })),
    assumptions: result.why.assumptions,
    questions: result.questions.map((q) => q.text),
    refusals: r.refusals.map((x) => x.text),
    blockers: r.blockers.map((b) => b.text),
    kept: r.kept.map((k) => `${k.amount} ${k.token}: ${k.parts.map((p) => `${p.amount} ${p.label}`).join(", ")}`),
    fees: r.fees.lines.length > 0 ? `${r.fees.bps / 100}% Lykia fee: about ${r.fees.totalUsd !== null ? `$${r.fees.totalUsd}` : r.fees.lines.map((f) => `${f.amount} ${f.token}`).join(" + ")}` : null,
    tradeoffs: result.why.tradeoffs,
    rejected: result.why.rejected,
  };
}

/** The proposal, the saved or linked drafts and the view for one compiled program. */
export async function deliver(d: DeliverContext, result: CompileResult, overrides: Readonly<Record<string, string>> = {}): Promise<Delivered> {
  const { proposal, error } = await proposalOf(d, result);
  const saved = await draftsOf(d, result);
  const view = programView(result, overrides, saved, proposal?.intentId ?? null, proposal ? { decision: proposal.decision, reasons: proposal.reasons } : undefined);
  return { proposal, drafts: [...saved.values()], view, planError: error, blocks: [...(await orderCards(d, result)), ...leashCards(result)] };
}

/** A leash the program drafted: a card in Ask that opens the leash review sheet (Ask starts it; the Fold manages it). */
function leashCards(result: CompileResult): AnswerBlock[] {
  const out: AnswerBlock[] = [];
  for (const s of result.scheduled) {
    if (s.kind !== "leash" || out.length >= 2) continue;
    if (s.draft.template === "custom") continue;
    const drafted = leashDraftBlock({ name: s.draft.name, template: s.draft.template, perDayUsd: s.draft.perDayUsd, perStepUsd: s.draft.perStepUsd ?? null, days: s.draft.days, ...(s.draft.recipients ? { recipients: s.draft.recipients } : {}) });
    if (drafted.ok) out.push(drafted.block);
  }
  return out;
}
