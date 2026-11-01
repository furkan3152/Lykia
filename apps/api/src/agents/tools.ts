/**
 * The tools a Pack agent can call. Each tool names the capability it needs;
 * an agent only sees the tools its capabilities allow, and `plan_intent`
 * always plans under the calling agent's own Fence, so a specialist cannot
 * propose what its Fence forbids. No tool signs, sends, or edits a Fence.
 *
 * Every tool result goes back to the model wrapped as untrusted data:
 * token names, memos and card text are written by strangers.
 */
import { getProtocol, KNOWLEDGE_ROWS, protocolsFor, tokensFor, venueBrief, venueKnowledge, type Address, type ArcEnvironment, type Fence, type PackCapability, type PackRole, type PlanAction } from "@lykia/core";
import type { AgentProposal } from "@lykia/core/api/agents";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { services } from "../services.js";
import { planSentence } from "./engine.js";
import { knowledgePaths } from "../engine/search.js";
import { readSentence } from "../language/reader.js";
import type { LlmTool } from "./llm.js";

export interface ActingAgent {
  readonly name: string;
  readonly role: PackRole;
  readonly fence: Fence;
  readonly capabilities: readonly PackCapability[];
  /** Pack agent id when the specialist is a stored agent. */
  readonly id?: string;
}

export interface ToolContext {
  readonly ctx: AppContext;
  readonly environment: ArcEnvironment;
  readonly owner: Address | null;
  readonly agent: ActingAgent;
  readonly proposals: AgentProposal[];
  /** The actions behind each proposal, for merging specialists' plans into one intent. */
  readonly planned?: { readonly actions: readonly PlanAction[]; readonly proposal: AgentProposal }[];
}

export interface ToolOutcome {
  readonly ok: boolean;
  readonly summary: string;
  readonly content: string;
}

interface ToolSpec<T> {
  readonly name: string;
  readonly description: string;
  readonly capability: PackCapability;
  readonly schema: z.ZodType<T>;
  readonly json: Record<string, unknown>;
  run(input: T, tc: ToolContext): Promise<{ summary: string; data: unknown }>;
}

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/u);
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

function spec<T>(s: ToolSpec<T>): ToolSpec<unknown> {
  return s as unknown as ToolSpec<unknown>;
}

const needOwner = (tc: ToolContext): Address => {
  if (!tc.owner) throw new Error("No owner wallet is connected.");
  return tc.owner;
};

export const AGENT_TOOLS: readonly ToolSpec<unknown>[] = [
  spec({
    name: "flock",
    description: "Read the owner's balance sheet on Arc: wallet tokens, Morpho vault positions, the Circle Gateway unified balance, USD values (null = unpriced).",
    capability: "read",
    schema: z.object({}).strict(),
    json: obj({}),
    async run(_input, tc) {
      const snap = await services(tc.ctx).flock.snapshot(tc.environment, needOwner(tc));
      return { summary: `Flock read: total ${snap.totalUsd === null ? "partly unpriced" : `$${snap.totalUsd}`}, ${snap.holdings.length} holdings`, data: snap };
    },
  }),
  spec({
    name: "scent",
    description: "Inspect a token by address on Arc: registry and look-alike checks, proxy and clone, privileged functions, owner, a simulated transfer. Returns a level (verified, no-red-flags, caution, danger, unknown) and the wolves found. Never 'safe'.",
    capability: "read",
    schema: z.object({ token: address }).strict(),
    json: obj({ token: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, ["token"]),
    async run(input: { token: string }, tc) {
      const report = await services(tc.ctx).scent.sniff(tc.environment, input.token as Address);
      return { summary: `Scent ${report.symbol ?? input.token}: ${report.level}`, data: report };
    },
  }),
  spec({
    name: "venues",
    description: "List the venues on Arc in Lykia's registry: id, category, whether Lykia can execute it on this environment.",
    capability: "read",
    schema: z.object({ category: z.string().max(32).optional() }).strict(),
    json: obj({ category: { type: "string", description: "Optional filter: lending, dex, vault, fx, bridge, circle, agent, oracle" } }),
    async run(input: { category?: string }, tc) {
      const rows = protocolsFor(tc.environment)
        .filter((p) => !input.category || p.category === input.category)
        .map((p) => ({ id: p.id, name: p.name, category: p.category, verbs: p.verbs, executable: EXECUTABLE_VENUES[tc.environment].has(p.id) }));
      return { summary: `${rows.length} venues`, data: rows };
    },
  }),
  spec({
    name: "knowledge",
    description:
      "Ask what Lykia knows about Arc venues before planning. topic 'venues' lists every venue (what it does, what it can convert into what, risk). topic 'venue' with venue=<id> gives one venue's functions, approvals, preconditions, failure modes, gas and risk facts. topic 'paths' with from/to (assets like USDC, EURC, cirBTC, WETH, or positions like USDC@morpho-vaults) lists the ways to get there. topic 'tokens' lists registry tokens with decimals and pegs.",
    capability: "read",
    schema: z.object({ topic: z.enum(["venues", "venue", "paths", "tokens"]), venue: z.string().max(48).optional(), from: z.string().max(40).optional(), to: z.string().max(40).optional() }).strict(),
    json: obj({ topic: { type: "string", enum: ["venues", "venue", "paths", "tokens"] }, venue: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, ["topic"]),
    async run(input: { topic: "venues" | "venue" | "paths" | "tokens"; venue?: string; from?: string; to?: string }, tc) {
      if (input.topic === "venues") return { summary: `${KNOWLEDGE_ROWS.length} venues described`, data: KNOWLEDGE_ROWS.map(venueBrief) };
      if (input.topic === "tokens") return { summary: "Registry tokens", data: tokensFor(tc.environment).map((t) => ({ symbol: t.symbol, decimals: t.decimals, peg: t.peg, issuer: t.issuer, tags: t.tags })) };
      if (input.topic === "paths") {
        if (!input.from || !input.to) throw new Error("paths needs from and to.");
        const paths = knowledgePaths(input.from, input.to, 3);
        return { summary: `${paths.length} paths from ${input.from} to ${input.to}`, data: paths };
      }
      const row = input.venue ? venueKnowledge(input.venue) : null;
      if (!row) throw new Error(`No knowledge row for ${input.venue ?? "(missing venue)"}.`);
      return {
        summary: `Knowledge: ${row.venue}`,
        data: { ...venueBrief(row), functions: row.functions.map((f) => ({ abi: f.abi, purpose: f.purpose, approvals: f.approvals, preconditions: f.preconditions, failures: f.failures, gas: f.gas, fee: f.feeModel, settlement: f.settlement })), risk: row.risk },
      };
    },
  }),
  spec({
    name: "search_routes",
    description:
      "Find the best route for a goal sentence (English or Turkish), e.g. 'earn the best yield on 1000 USDC with medium risk' or 'borrow 1000 USDC on my cirBTC and put it to work with health ≥ 1.8'. Compares direct routes, other venues, convert-then-earn and multi-hop conversions, scores them by net value after fees, gas, slippage and risk, checks the winner's calldata with one eth_call, and explains why. Plans nothing for signing; use plan_intent with the winning sentence or ask the owner.",
    capability: "read",
    schema: z.object({ sentence: z.string().min(3).max(400), appetite: z.enum(["low", "medium", "high"]).optional(), horizonDays: z.number().int().min(1).max(3650).optional() }).strict(),
    json: obj({ sentence: { type: "string", maxLength: 400 }, appetite: { type: "string", enum: ["low", "medium", "high"] }, horizonDays: { type: "integer", minimum: 1, maximum: 3650 } }, ["sentence"]),
    async run(input: { sentence: string; appetite?: "low" | "medium" | "high"; horizonDays?: number }, tc) {
      const owner = needOwner(tc);
      const parsed = readSentence(input.sentence);
      if (parsed.clarify.length > 0 || parsed.actions.length === 0) return { summary: "Needs a detail", data: { clarify: parsed.clarify.length > 0 ? parsed.clarify : [parsed.reply] } };
      const result = await services(tc.ctx).search.search({ environment: tc.environment, owner, actions: parsed.actions, fence: tc.agent.fence, proposedByAgent: true, spent: await services(tc.ctx).intents.spent(tc.environment, owner), source: input.sentence, ...(input.appetite ? { appetite: input.appetite } : {}), ...(input.horizonDays ? { horizonDays: input.horizonDays } : {}) });
      const brief = (r: NonNullable<typeof result.best>) => ({ label: r.label, steps: r.explanation.steps, net: r.score.totalUsd, why: r.explanation.why, couldFail: r.explanation.couldFail.slice(0, 4), fence: r.explanation.fence, checked: r.simulation ? (r.simulation.ok ? "simulation passed" : `simulation failed: ${r.simulation.reason}`) : "not simulated" });
      return {
        summary: result.best ? `Best route: ${result.best.label} (net ${result.best.score.totalUsd ?? "unpriced"} USD)` : "No route passed",
        data: { best: result.best ? brief(result.best) : null, alternatives: result.alternatives.slice(0, 3).map(brief), pruned: result.pruned.slice(0, 8), failedChecks: result.failedChecks, objective: result.objective },
      };
    },
  }),
  spec({
    name: "prices",
    description: "USD reference prices for Arc registry tokens (Chainlink feeds; fiat stablecoins at their peg; USYC at its NAV). Stale or missing prices come back as null.",
    capability: "read",
    schema: z.object({ symbols: z.array(z.string().min(2).max(10)).min(1).max(8) }).strict(),
    json: obj({ symbols: { type: "array", items: { type: "string", maxLength: 10 }, minItems: 1, maxItems: 8, description: "Registry symbols, e.g. USDC, EURC, cirBTC, WETH, USYC, JPYC" } }, ["symbols"]),
    async run(input: { symbols: string[] }, tc) {
      const prices = await services(tc.ctx).prices.prices(input.symbols);
      return { summary: `Prices for ${input.symbols.join(", ")}`, data: prices };
    },
  }),
  spec({
    name: "outrun",
    description: "Where the money is for a planned intent: waypoints, status, the Fold.",
    capability: "read",
    schema: z.object({ intentId: z.string().regex(/^out_[A-Za-z0-9_-]{6,32}$/u) }).strict(),
    json: obj({ intentId: { type: "string" } }, ["intentId"]),
    async run(input: { intentId: string }, tc) {
      const doc = await services(tc.ctx).intents.get(input.intentId);
      return { summary: `Outrun ${input.intentId}: ${doc.outrun.status}`, data: doc.outrun };
    },
  }),
  spec({
    name: "plan_intent",
    description:
      "Propose a plan from one plain sentence (English or Turkish), e.g. 'deposit 100 USDC into Morpho', 'convert 200 USDC to EURC', 'send 20 USDC to 0x… for invoice 12', 'bridge 50 USDC to base'. Several moves can be chained with 'then'. The plan is checked against your own Fence; the owner signs later. Returns the steps and the verdict.",
    capability: "propose",
    schema: z.object({ sentence: z.string().min(3).max(400), why: z.string().max(300).optional() }).strict(),
    json: obj({ sentence: { type: "string", maxLength: 400 }, why: { type: "string", maxLength: 300, description: "One line: why this plan serves the goal." } }, ["sentence"]),
    async run(input: { sentence: string; why?: string }, tc) {
      const owner = needOwner(tc);
      const outcome = await planSentence(tc.ctx, input.sentence, { environment: tc.environment, owner, fence: tc.agent.fence, proposedByAgent: true });
      if (outcome.kind === "clarify") return { summary: "Needs a detail", data: { clarify: outcome.questions } };
      if (outcome.kind === "refused") return { summary: `Refused: ${outcome.message}`, data: { refused: outcome.message } };
      const { intent } = outcome.result;
      const proposal: AgentProposal = {
        intentId: outcome.result.stored ? intent.id : null,
        title: input.sentence,
        steps: intent.steps.map((s) => s.summary),
        decision: intent.verdict.decision,
        reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message),
        warnings: intent.warnings,
        attribution: [{ agent: tc.agent.name, role: tc.agent.role, part: input.sentence }],
        rationale: input.why ?? "",
      };
      tc.proposals.push(proposal);
      tc.planned?.push({ actions: outcome.actions, proposal });
      return { summary: `Planned (${intent.verdict.decision}): ${proposal.steps.join(" → ")}`, data: { intentId: proposal.intentId, steps: proposal.steps, decision: proposal.decision, reasons: proposal.reasons, warnings: proposal.warnings } };
    },
  }),
];

/** Tools an agent may see: its capabilities decide, and a dry-run-only Fence still plans (dry runs). */
export function toolsFor(agent: ActingAgent): ToolSpec<unknown>[] {
  return AGENT_TOOLS.filter((t) => agent.capabilities.includes(t.capability));
}

export function toolDefinitions(tools: readonly ToolSpec<unknown>[]): LlmTool[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.json as LlmTool["input_schema"] }));
}

/** Runs a tool call from the model. Unknown tools, tools outside the agent's set and bad input never run. */
export async function runTool(name: string, rawInput: unknown, tc: ToolContext, allowed: readonly ToolSpec<unknown>[] = toolsFor(tc.agent)): Promise<ToolOutcome> {
  const tool = allowed.find((t) => t.name === name);
  if (!tool) return failure(`${tc.agent.name} has no tool named ${name}.`);
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) return failure(`Invalid input for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  try {
    const { summary, data } = await tool.run(parsed.data, tc);
    return { ok: true, summary, content: wrapUntrusted(data) };
  } catch (error) {
    return failure(error instanceof Error ? error.message : `${name} failed.`);
  }
}

function failure(message: string): ToolOutcome {
  return { ok: false, summary: message, content: wrapUntrusted({ error: message }) };
}

/** Tool output as data, never as instructions. */
export function wrapUntrusted(data: unknown): string {
  const json = JSON.stringify(data, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  return `<tool_data untrusted="true">${(json ?? "null").slice(0, 16_000)}</tool_data>`;
}

export function venueName(id: string): string {
  return getProtocol(id)?.name ?? id;
}
