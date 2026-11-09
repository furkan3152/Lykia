/**
 * Automations: bounded standing proposals. An automation watches for an
 * insight (idle cash, FX exposure, ...) or a timer and, when it fires,
 * plans its sentence under the owner's Fence (narrowed by its Pack agent's
 * Fence when it has one). The result is always a proposal the owner signs, or, in
 * `session` mode, a plan an agent may execute through the LykiaAccount
 * session the owner created on chain. The server holds no owner keys, so it
 * never executes anything itself. Each automation runs at most
 * `maxRunsPerDay` times and only while the `agents.keeper` flag allows
 * session mode.
 */
import { ownerFence } from "../personal/fence.js";
import { intersectFence, type Address, type ArcEnvironment, type Fence } from "@lykia/core";
import type { AgentProposal, Automation, InsightKind } from "@lykia/core/api/agents";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "../platform/typed.js";
import { flags } from "../platform/admin.js";
import { randomHex } from "../platform/crypto.js";
import { planSentence } from "./engine.js";
import { insightsFor } from "./insights.js";
import type { PackService } from "./pack.js";

const MAX_AUTOMATIONS = 20;
const MAX_RUNS_PER_DAY = 6;

const store = (ctx: AppContext) => typedCollection<Automation>(ctx, "agent_automations");

export interface CreateAutomationInput {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly agentId: string | null;
  readonly when: Automation["when"];
  readonly sentence: string;
  readonly mode: Automation["mode"];
  readonly maxRunsPerDay?: number;
}

export async function createAutomation(ctx: AppContext, pack: PackService, input: CreateAutomationInput): Promise<Automation> {
  const owner = input.owner.toLowerCase() as Address;
  const mine = (await store(ctx).list({ prefix: `${owner}:`, limit: 1000 })).filter((d) => d.value.enabled);
  if (mine.length >= MAX_AUTOMATIONS) throw new LykiaHttpError("CONFLICT", 409, `At most ${MAX_AUTOMATIONS} automations per owner.`);
  if (input.mode === "session") {
    if (!(await flags(ctx))["agents.keeper"]) throw new LykiaHttpError("FORBIDDEN", 403, "Session-mode automations are switched off on this server (flag agents.keeper).");
    if (!input.agentId) throw new LykiaHttpError("INVALID_REQUEST", 400, "Session mode needs a Pack agent with an on-chain session.");
    const agent = await pack.get(input.agentId);
    if (!agent.session) throw new LykiaHttpError("CONFLICT", 409, `${agent.name} has no LykiaAccount session yet. Create one first.`);
  }
  if (input.agentId) {
    const agent = await pack.get(input.agentId);
    if (agent.owner !== owner) throw new LykiaHttpError("FORBIDDEN", 403, "That agent belongs to another owner.");
  }
  const automation: Automation = {
    id: `${owner}:aut_${randomHex(6)}`,
    owner,
    environment: input.environment,
    agentId: input.agentId,
    when: input.when,
    sentence: input.sentence,
    mode: input.mode,
    maxRunsPerDay: Math.min(input.maxRunsPerDay ?? 1, MAX_RUNS_PER_DAY),
    enabled: true,
    createdAt: new Date(ctx.clock.now()).toISOString(),
  };
  await store(ctx).put(automation.id, automation);
  return automation;
}

export async function listAutomations(ctx: AppContext, owner: Address): Promise<Automation[]> {
  return (await store(ctx).list({ prefix: `${owner.toLowerCase()}:`, limit: 1000 })).map((d) => d.value);
}

export async function setAutomationEnabled(ctx: AppContext, owner: Address, id: string, enabled: boolean): Promise<Automation> {
  const doc = await store(ctx).get(id);
  if (!doc || doc.value.owner !== owner.toLowerCase()) throw new LykiaHttpError("NOT_FOUND", 404, "No such automation.");
  const next = { ...doc.value, enabled };
  await store(ctx).put(id, next);
  return next;
}

export interface AutomationRun {
  readonly automationId: string;
  readonly fired: boolean;
  readonly reason: string;
  readonly proposal: AgentProposal | null;
}

/** Evaluates one owner's automations now. Fired ones produce proposals (never executions). */
/**
 * The Fence an owner's automations plan under: the owner's profile and Fold preferences (the same Fence the Fold
 * and Ask Lyko use). An agent's own Fence is intersected with it, so an agent automation is never looser than its owner.
 */
export async function ownerFenceOf(ctx: AppContext, owner: Address): Promise<Fence> {
  return ownerFence(ctx, owner);
}

export async function runAutomations(ctx: AppContext, pack: PackService, owner: Address, environment: ArcEnvironment, onFired?: (a: Automation, p: AgentProposal) => void, ownerFence?: Fence): Promise<AutomationRun[]> {
  const all = (await listAutomations(ctx, owner)).filter((a) => a.enabled && a.environment === environment);
  if (all.length === 0) return [];
  const now = ctx.clock.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const runs = ctx.store.counters("automation_runs");
  let kinds: Set<InsightKind> | null = null;
  let fenceOfOwner: Fence | undefined;
  const out: AutomationRun[] = [];
  for (const a of all) {
    if ((await runs.get(`${a.id}:${day}`)) >= a.maxRunsPerDay) {
      out.push({ automationId: a.id, fired: false, reason: "Daily run limit reached.", proposal: null });
      continue;
    }
    let due: boolean;
    if ("insight" in a.when) {
      kinds ??= new Set((await insightsFor(ctx, environment, owner)).insights.map((i) => i.kind));
      due = kinds.has(a.when.insight);
    } else {
      due = !a.lastRunAt || now - Date.parse(a.lastRunAt) >= a.when.everyMinutes * 60_000;
    }
    if (!due) {
      out.push({ automationId: a.id, fired: false, reason: "Not due.", proposal: null });
      continue;
    }
    const agent = a.agentId ? await pack.get(a.agentId).catch(() => null) : null;
    if (a.agentId && (!agent || agent.status !== "active")) {
      out.push({ automationId: a.id, fired: false, reason: "Its agent is not active.", proposal: null });
      continue;
    }
    fenceOfOwner ??= ownerFence ?? (await ownerFenceOf(ctx, owner));
    const fence = agent ? intersectFence(fenceOfOwner, agent.fence, agent.name) : fenceOfOwner;
    const outcome = await planSentence(ctx, a.sentence, { environment, owner, fence, proposedByAgent: true, ...(agent?.signer ? { signer: "agent" as const, agent: { address: agent.signer, ...(agent.agentId ? { agentId: agent.agentId } : {}) } } : {}) });
    await runs.increment(`${a.id}:${day}`, 1, { ttlMs: 2 * 86_400_000 });
    await store(ctx).put(a.id, { ...a, lastRunAt: new Date(now).toISOString() });
    if (outcome.kind !== "planned") {
      out.push({ automationId: a.id, fired: false, reason: outcome.kind === "refused" ? outcome.message : outcome.reply, proposal: null });
      continue;
    }
    const intent = outcome.result.intent;
    const proposal: AgentProposal = {
      intentId: outcome.result.stored ? intent.id : null,
      title: a.sentence,
      steps: intent.steps.map((s) => s.summary),
      decision: intent.verdict.decision,
      reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message),
      warnings: intent.warnings,
      attribution: [{ agent: agent?.name ?? "Lyko", role: agent?.role ?? "orchestrator", part: a.sentence }],
      rationale: "insight" in a.when ? `Fired on the ${a.when.insight} insight.` : `Runs every ${a.when.everyMinutes} minutes.`,
    };
    onFired?.(a, proposal);
    out.push({ automationId: a.id, fired: true, reason: a.mode === "session" ? "Planned; the agent may execute it through its on-chain session." : "Planned; waiting for the owner's signature.", proposal });
  }
  return out;
}

