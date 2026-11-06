/**
 * Agents over the API. A developer configures an agent: its tools, the step
 * kinds and venues it may touch, a Fence that must sit inside the project's
 * Fence, budgets (they become Fence caps), Pack sub-agents it may delegate
 * to, persona additions (sanitised like project prompts), memory on or off,
 * and whether it uses Lykia's server model or the deterministic reader.
 *
 * `run` turns a sentence into a plan under that Fence, optionally prepares
 * the first step's unsigned calls, and keeps the conversation as a thread.
 * Nothing signs here.
 */
import {
  budgetFence,
  DEFAULT_FENCE,
  fenceHash,
  isSubFence,
  narrowFence,
  projectFence,
  projectPromptBlock,
  sanitizePromptAdditions,
  subFenceViolations,
  tightenFence,
  type Address,
  type ArcEnvironment,
  type AgentApiBudget,
  type AgentApiView,
  type AgentApiTool,
  type Fence,
  type PackAgent,
  type StepKind,
} from "@lykia/core";
import type { AgentProposal } from "@lykia/core/api/agents";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { agentServices } from "../agents/index.js";
import { planActions, planSentence, type PlanOutcome } from "../agents/engine.js";
import type { LlmClient } from "../agents/llm.js";
import { runTurn, type Emit } from "../agents/orchestrator.js";
import { perceive } from "../agents/perception.js";
import { readSentence } from "../language/reader.js";
import { flags } from "../platform/admin.js";
import { randomHex } from "../platform/crypto.js";
import { typedCollection } from "../platform/typed.js";
import { securityPreflight } from "../security/index.js";
import { services } from "../services.js";
import { actsFor, assertActsFor, type FlowCaller } from "./access.js";
import { apiAgents, listOwned, RECORD_TTL_MS } from "./stores.js";
import { indexVerdict } from "./verdicts.js";
import { lockedOr } from "../platform/requestState.js";

export type StoredAgent = AgentApiView;

export interface AgentInput {
  readonly name: string;
  readonly owner: Address;
  readonly environment?: ArcEnvironment;
  readonly tools?: readonly AgentApiTool[];
  readonly kinds?: readonly StepKind[] | null;
  readonly venues?: readonly string[] | null;
  readonly fence?: Fence;
  readonly budget?: AgentApiBudget;
  readonly pack?: readonly string[];
  readonly persona?: string;
  readonly memory?: boolean;
  readonly autoPrepare?: boolean;
  /** "lykia": the server's model when it has one; "none": the deterministic reader only. */
  readonly llm?: { readonly provider: "lykia" | "none" };
  readonly status?: "active" | "paused";
}

/** The public view. */
export function agentView(agent: StoredAgent): AgentApiView {
  return agent;
}

/* ------------------------------------------------------------ configuration */

async function baseFence(_ctx: AppContext, caller: FlowCaller): Promise<Fence> {
  return caller.project ? tightenFence(projectFence(caller.project), caller.project) : DEFAULT_FENCE;
}

async function effectiveFence(ctx: AppContext, caller: FlowCaller, input: Pick<AgentInput, "fence" | "kinds" | "venues" | "budget">): Promise<Fence> {
  const parent = await baseFence(ctx, caller);
  let fence = input.fence ?? parent;
  if (input.fence) {
    const violations = subFenceViolations(parent, input.fence);
    if (violations.length > 0) throw new LykiaHttpError("FENCE_NOT_SUBSET", 400, "An agent's Fence must sit inside the project's Fence.", { violations: violations.slice(0, 20) });
  }
  fence = budgetFence(narrowFence(fence, input.kinds ?? null, input.venues ?? null), input.budget ?? {});
  if (!isSubFence(parent, fence)) throw new LykiaHttpError("FENCE_NOT_SUBSET", 400, "The agent's effective Fence is not inside the project's Fence.");
  return { ...fence, label: fence.label ?? "Agent" };
}

async function checkPack(ctx: AppContext, owner: Address, fence: Fence, ids: readonly string[]): Promise<void> {
  const pack = agentServices(ctx).pack;
  for (const id of ids) {
    const member = await pack.get(id).catch(() => null);
    if (!member || member.owner !== owner.toLowerCase()) throw new LykiaHttpError("INVALID_REQUEST", 400, `Pack agent ${id} does not belong to the agent's owner.`);
    if (!isSubFence(fence, member.fence)) throw new LykiaHttpError("FENCE_NOT_SUBSET", 400, `Pack agent ${member.name}'s Fence is not inside this agent's Fence.`);
  }
}

export async function createAgent(ctx: AppContext, caller: FlowCaller, input: AgentInput): Promise<AgentApiView> {
  const fence = await effectiveFence(ctx, caller, input);
  const owner = input.owner.toLowerCase() as Address;
  // An agent acts for its owner: the developer's own address, or an owner who consented to the caller's project.
  await assertActsFor(ctx, caller, owner);
  await checkPack(ctx, owner, fence, input.pack ?? []);
  const persona = sanitizePromptAdditions(input.persona).text;
  const now = new Date(ctx.clock.now()).toISOString();
  const agent: StoredAgent = {
    schema: "lykia.agent/v1",
    id: `agt_${randomHex(6)}`,
    developer: caller.developer,
    projectId: caller.project?.id ?? null,
    name: input.name,
    owner,
    environment: input.environment ?? lockedOr(caller.project?.network ?? ctx.config.mode),
    tools: input.tools ?? ["plan", "flock", "prices", "venues", "scent"],
    kinds: input.kinds ?? null,
    venues: input.venues ?? null,
    fence,
    fenceHash: fenceHash(fence),
    budget: input.budget ?? {},
    pack: input.pack ?? [],
    persona,
    memory: input.memory ?? true,
    autoPrepare: input.autoPrepare ?? false,
    llm: { provider: input.llm?.provider ?? "lykia" },
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
  };
  await apiAgents(ctx).put(agent.id, agent, { ttlMs: RECORD_TTL_MS });
  return agentView(agent);
}

export async function loadAgent(ctx: AppContext, caller: FlowCaller, id: string): Promise<StoredAgent> {
  const doc = /^agt_[a-z0-9]{12}$/u.test(id) ? (await apiAgents(ctx).get(id))?.value : null;
  if (!doc || doc.developer !== caller.developer) throw new LykiaHttpError("NOT_FOUND", 404, "No such agent.");
  return doc;
}

export async function updateAgent(ctx: AppContext, caller: FlowCaller, id: string, patch: Partial<AgentInput>): Promise<AgentApiView> {
  const current = await loadAgent(ctx, caller, id);
  const merged = { fence: patch.fence ?? undefined, kinds: patch.kinds === undefined ? current.kinds : patch.kinds, venues: patch.venues === undefined ? current.venues : patch.venues, budget: patch.budget ?? current.budget };
  const fence = patch.fence || patch.kinds !== undefined || patch.venues !== undefined || patch.budget ? await effectiveFence(ctx, caller, merged) : current.fence;
  const pack = patch.pack ?? current.pack;
  await checkPack(ctx, current.owner, fence, pack);
  const next: StoredAgent = {
    ...current,
    name: patch.name ?? current.name,
    tools: patch.tools ?? current.tools,
    kinds: merged.kinds,
    venues: merged.venues,
    fence,
    fenceHash: fenceHash(fence),
    budget: merged.budget,
    pack,
    persona: patch.persona !== undefined ? sanitizePromptAdditions(patch.persona).text : current.persona,
    memory: patch.memory ?? current.memory,
    autoPrepare: patch.autoPrepare ?? current.autoPrepare,
    llm: patch.llm ? { provider: patch.llm.provider } : current.llm,
    status: patch.status ?? current.status,
    updatedAt: new Date(ctx.clock.now()).toISOString(),
  };
  await apiAgents(ctx).put(id, next, { ttlMs: RECORD_TTL_MS });
  return agentView(next);
}

export async function listAgents(ctx: AppContext, caller: FlowCaller): Promise<AgentApiView[]> {
  return (await listOwned(apiAgents(ctx), caller.developer)).map(agentView);
}

export async function deleteAgent(ctx: AppContext, caller: FlowCaller, id: string): Promise<{ deleted: true }> {
  await loadAgent(ctx, caller, id);
  await apiAgents(ctx).delete(id);
  return { deleted: true };
}

/* ------------------------------------------------------------ threads */

export interface AgentThread {
  readonly id: string;
  readonly agentId: string;
  readonly title: string;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly text: string; readonly at: string; readonly intentIds?: readonly string[] }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

const threads = (ctx: AppContext) => typedCollection<AgentThread>(ctx, "business_agent_threads");
const THREAD_TTL_MS = 90 * 86_400_000;

export async function listAgentThreads(ctx: AppContext, caller: FlowCaller, agentId: string): Promise<Omit<AgentThread, "messages">[]> {
  await loadAgent(ctx, caller, agentId);
  return (await threads(ctx).list({ prefix: `${agentId}:`, limit: 500 })).map(({ value: { messages: _m, ...rest } }) => rest).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAgentThread(ctx: AppContext, caller: FlowCaller, agentId: string, threadId: string): Promise<AgentThread> {
  await loadAgent(ctx, caller, agentId);
  const doc = threadId.startsWith(`${agentId}:`) ? (await threads(ctx).get(threadId))?.value : null;
  if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No such thread.");
  return doc;
}

/* ------------------------------------------------------------ run */

async function clientFor(ctx: AppContext, agent: StoredAgent): Promise<LlmClient | null> {
  if (!agent.tools.includes("plan")) return null;
  if (agent.llm.provider === "lykia" && (await flags(ctx))["agents.llm"]) return agentServices(ctx).llm();
  return null;
}

export interface RunInput {
  readonly message: string;
  readonly threadId?: string;
  readonly autoPrepare?: boolean;
  readonly dryRun?: boolean;
}

export interface RunResult {
  readonly agentId: string;
  readonly threadId: string;
  readonly mode: "llm" | "reader";
  readonly reply: string;
  readonly proposals: readonly AgentProposal[];
  readonly prepared: readonly { readonly intentId: string; readonly stepId: string; readonly transactions: unknown; readonly memo: string; readonly security: unknown }[];
  readonly notes: readonly string[];
  readonly fenceHash: string;
}

function proposalOf(outcome: PlanOutcome, agent: StoredAgent, message: string): AgentProposal | null {
  if (outcome.kind !== "planned") return null;
  const intent = outcome.result.intent;
  return { intentId: outcome.result.stored ? intent.id : null, title: message.slice(0, 120), steps: intent.steps.map((s) => s.summary), decision: intent.verdict.decision, reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message), warnings: intent.warnings, attribution: [{ agent: agent.name, role: "custom", part: message.slice(0, 120) }], rationale: "Planned by the reader under the agent's Fence." };
}

export async function runAgent(ctx: AppContext, caller: FlowCaller, id: string, input: RunInput): Promise<RunResult> {
  const agent = await loadAgent(ctx, caller, id);
  if (agent.status !== "active") throw new LykiaHttpError("CONFLICT", 409, "This agent is paused.");
  const day = new Date(ctx.clock.now()).toISOString().slice(0, 10);
  const runs = ctx.store.counters("business_agent_runs");
  const max = agent.budget.maxRunsPerDay;
  if (max !== undefined && (await runs.get(`${agent.id}:${day}`)) >= max) throw new LykiaHttpError("RATE_LIMITED", 429, `This agent's budget allows ${max} runs a day.`);
  await runs.increment(`${agent.id}:${day}`, 1, { ttlMs: 2 * 86_400_000 });

  const now = new Date(ctx.clock.now()).toISOString();
  let thread: AgentThread;
  if (input.threadId) thread = await getAgentThread(ctx, caller, agent.id, input.threadId);
  else thread = { id: `${agent.id}:thr_${randomHex(16)}`, agentId: agent.id, title: input.message.slice(0, 80), messages: [], createdAt: now, updatedAt: now };

  const fence: Fence = input.dryRun ? { ...agent.fence, mode: "dry-run" } : agent.fence;
  const notes: string[] = [];
  let reply: string;
  let proposals: AgentProposal[] = [];
  let mode: RunResult["mode"] = "reader";
  const client = await clientFor(ctx, agent);
  if (!agent.tools.includes("plan")) {
    reply = "This agent has no plan tool, so it cannot propose moves.";
  } else if (client) {
    mode = "llm";
    const packAgents: PackAgent[] = [];
    for (const pid of agent.pack) {
      const member = await agentServices(ctx).pack.get(pid).catch(() => null);
      if (member && member.status === "active") packAgents.push(member);
    }
    const events: { event: string; data: unknown }[] = [];
    const emit: Emit = (event, data) => events.push({ event, data });
    const seen = await perceive(ctx, { environment: agent.environment, owner: agent.owner, fence, pack: packAgents, emit, personal: await actsFor(ctx, caller, agent.owner) });
    const blocks = [agent.persona ? projectPromptBlock({ name: agent.name, prompt: agent.persona, brand: { assistant: { name: agent.name } } }) : "", caller.project ? projectPromptBlock(caller.project) : ""].filter(Boolean).join("\n\n");
    const result = await runTurn({ ctx, client, environment: agent.environment, owner: agent.owner, fence, pack: packAgents, history: thread.messages.map((m) => ({ role: m.role, text: m.text })), message: input.message, stateLine: seen.line, emit, ...(blocks ? { appContext: blocks } : {}) });
    reply = result.text;
    proposals = [...result.proposals];
  } else {
    const outcome = agent.memory
      ? await planSentence(ctx, input.message, { environment: agent.environment, owner: agent.owner, fence, proposedByAgent: true })
      : await (async (): Promise<PlanOutcome> => {
          const parsed = readSentence(input.message);
          if (parsed.clarify.length > 0 || parsed.actions.length === 0) return { kind: "clarify", questions: parsed.clarify.length > 0 ? parsed.clarify : [parsed.reply], reply: parsed.reply };
          return planActions(ctx, parsed.actions, input.message, { environment: agent.environment, owner: agent.owner, fence, proposedByAgent: true });
        })();
    if (outcome.kind === "planned") {
      const p = proposalOf(outcome, agent, input.message);
      if (p) proposals = [p];
      reply = `Proposed: ${outcome.result.intent.steps.map((s) => s.summary).join("; ")}. Fence: ${outcome.result.intent.verdict.decision}.`;
    } else reply = outcome.kind === "clarify" ? outcome.questions.join(" ") : outcome.message;
  }

  // Index verdicts for GET /v1/verdicts/:digest, then optionally prepare the first step (allow verdicts only).
  const prepared: RunResult["prepared"][number][] = [];
  for (const p of proposals) {
    if (!p.intentId) continue;
    const { doc } = await services(ctx).intents.load(p.intentId).catch(() => ({ doc: null }));
    if (!doc) continue;
    await indexVerdict(ctx, doc.graph.verdict.digest, p.intentId);
    const wants = input.autoPrepare ?? agent.autoPrepare;
    if (!wants) continue;
    if (doc.graph.verdict.decision !== "allow" || !doc.graph.verdict.signable) {
      notes.push(`${p.intentId}: not prepared automatically (Fence ${doc.graph.verdict.decision}); the owner confirms it first.`);
      continue;
    }
    const first = doc.graph.steps.find((s) => s.status === "ready");
    if (!first) continue;
    try {
      const out = await services(ctx).intents.prepare(p.intentId, first.id);
      const security = await securityPreflight(ctx, { intentId: p.intentId, stepId: first.id, prepared: out });
      prepared.push({ intentId: p.intentId, stepId: first.id, transactions: out.transactions, memo: out.memo, security });
    } catch (error) {
      notes.push(`${p.intentId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const at = new Date(ctx.clock.now()).toISOString();
  const nextThread: AgentThread = { ...thread, updatedAt: at, messages: [...thread.messages, { role: "user" as const, text: input.message.slice(0, 4000), at }, { role: "assistant" as const, text: (reply || "(no answer)").slice(0, 8000), at, intentIds: proposals.map((p) => p.intentId).filter((x): x is string => Boolean(x)) }].slice(-40) };
  await threads(ctx).put(nextThread.id, nextThread, { ttlMs: THREAD_TTL_MS });
  return { agentId: agent.id, threadId: nextThread.id, mode, reply, proposals, prepared, notes, fenceHash: agent.fenceHash };
}

/** An ERC-8004 registration for the agent: the card pins its effective Fence; the register call is unsigned. */
export async function agentTagDraft(ctx: AppContext, caller: FlowCaller, id: string, input: { readonly description?: string; readonly agentWallet?: Address; readonly publicBaseUrl?: string }): Promise<unknown> {
  const agent = await loadAgent(ctx, caller, id);
  return services(ctx).tags.draft({
    environment: agent.environment,
    owner: agent.owner,
    ...(input.agentWallet ? { agentWallet: input.agentWallet } : {}),
    name: agent.name,
    description: input.description ?? `${agent.name}: a Lykia agent that plans inside its Fence.`,
    fence: agent.fence,
    ...(input.publicBaseUrl ? { publicBaseUrl: input.publicBaseUrl } : {}),
  });
}
