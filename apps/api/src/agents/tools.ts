/**
 * The tools a Pack agent can call. Each tool names the capability it needs;
 * an agent only sees the tools its capabilities allow, and `plan_intent`
 * always plans under the calling agent's own Fence, so a specialist cannot
 * propose what its Fence forbids. No tool signs, sends, or edits a Fence.
 *
 * Every tool result goes back to the model wrapped as untrusted data:
 * token names, memos and card text are written by strangers.
 */
import { liveCapabilityMap } from "../capabilities/map.js";
import { isSampleOwner } from "@lykia/core";
import {
  ALERT_CHANNELS,
  ALERT_KINDS,
  ALERT_LIMITS,
  alertDraftLink,
  AUTOMATION_EVENTS,
  automationDraftLink,
  describeAlert,
  describeAutomationTrigger,
  findToken,
  fromBaseUnits,
  KNOWLEDGE_ROWS,
  ORDER_KINDS,
  PRICE_FEEDS,
  protocolsFor,
  tokensFor,
  validateActions,
  validateAutomationTrigger,
  venueBrief,
  venueKnowledge,
  WEEKDAYS,
  type Address,
  type AlertChannel,
  type AlertDraft,
  type AlertKind,
  type ArcEnvironment,
  type AutomationDraft,
  type AutomationTrigger,
  type Fence,
  type OrderKind,
  type PackCapability,
  type PackRole,
  type PlanAction,
} from "@lykia/core";
import type { AgentProposal, AnswerBlock, ChatDraftLink, ChatProgramView } from "@lykia/core/api/agents";
import { fenceCard, hiddenLine, materialPositions, positionsCard, positionsFacts, quotedRate, rateCard } from "./cards.js";
import { grounded, groundActions, intervalStated, recordToolData, searchBinds, timeStated, venueNamed, type Ground } from "./grounding.js";
import { orderVerdict, quoteOf } from "../orders/verdict.js";
import { readWithMemory } from "../personal/reader.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { services } from "../services.js";
import { planActions, preflightOf } from "./engine.js";
import { knowledgePaths } from "../engine/search.js";
import { ordersService } from "../orders/service.js";
import { alertInputIssue, alertsService } from "../alerts/service.js";
import { createAutomation } from "../devflows/automations.js";
import { readSentence } from "../language/reader.js";
import { compileIntent } from "../compiler/service.js";
import { deliver } from "../compiler/deliver.js";
import type { LlmTool } from "./llm.js";
import { foldPositions, foldSnapshot, type FixtureScope } from "../fold/sample.js";
import { foldInsights } from "../fold/insights.js";
import { createWatch, listInstructions } from "./instructions.js";
import { AUTOPILOT_BETA, WATCH_KINDS, type AutopilotTaskInput, type PlanPayload, type WatchCondition, type WatchPayload } from "@lykia/core";
import { agentDraft, autopilotDraft, autopilotTaskDraft, leashDraftBlock, yieldsCard } from "./create.js";

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
  /**
   * True only when the request proved control of `owner`: a SIWE session for
   * that address, or a secret key with the agents scope acting for it. Tools
   * that save state for the owner (alerts, automations) save only when this is
   * true; otherwise they return a draft and a link the owner opens signed in.
   */
  readonly ownerVerified: boolean;
  /** Who saves for the owner when verified: the owner's session, or the developer behind the secret key. */
  readonly actor?: { readonly developer: string; readonly via: "session" | "secret"; readonly projectId?: string };
  /** Alerts and automations set up this turn (saved, or a link to the prefilled form); the chat shows them as buttons. */
  readonly drafts?: ChatDraftLink[];
  /** Programs compiled this turn (compile_goal); the chat renders them as Now / Scheduled / Assumptions. */
  readonly programs?: ChatProgramView[];
  /** Cards built from tool results this turn (a Fence gate, a rate tile, a herded order); the chat draws them beside the answer. */
  readonly blocks?: AnswerBlock[];
  /** The actions behind each proposal, for merging specialists' plans into one intent. */
  readonly planned?: { readonly actions: readonly PlanAction[]; readonly proposal: AgentProposal }[];
  /** The shared thread this turn writes to; hand-offs to Lyko on watch are filed under it. */
  readonly threadId?: string;
  /**
   * What this turn may cite: the owner's own words (the message and the recent thread), and every number a tool
   * returned. Tools that take amounts, recipients or venues ground them here; a tool that needs the owner sets the
   * question and the turn ends with it.
   */
  readonly ground?: Ground;
  /** Lyko on watch (origin: the Fold): read-only tools, and each read lands as a sourced facts card. */
  readonly readOnly?: boolean;
  /** Reads made this turn, kept so a second tool or a card does not read Arc again for the same answer. */
  readonly reads?: Map<string, Promise<unknown>>;
}

/** The Fold's sample fixture is for Lyko on watch only: every other turn reads the chain, also for the sample address. */
export const fixtureScope = (tc: Pick<ToolContext, "readOnly">): FixtureScope => (tc.readOnly === true ? "fold" : "chain");

/** One read per turn: the same key returns the same result (a failed read is not kept). */
export function readOnce<T>(tc: Pick<ToolContext, "reads">, key: string, read: () => Promise<T>): Promise<T> {
  const reads = tc.reads;
  if (!reads) return read();
  const hit = reads.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const made = read();
  reads.set(key, made);
  made.catch(() => {
    if (reads.get(key) === made) reads.delete(key);
  });
  return made;
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
const FEE_BASIS = { input: "taken from the amount", "on-top": "paid on top of the amount", output: "taken from the borrowed amount" } as const;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

function spec<T>(s: ToolSpec<T>): ToolSpec<unknown> {
  return s as unknown as ToolSpec<unknown>;
}

const needOwner = (tc: ToolContext): Address => {
  if (!tc.owner) throw new Error("No owner wallet is connected.");
  return tc.owner;
};

/** The owner and actor a saving tool may write for, or null when the owner has not proven control. */
const verifiedOwner = (tc: ToolContext): { owner: Address; actor: NonNullable<ToolContext["actor"]> } | null => {
  if (!tc.ownerVerified || !tc.owner) return null;
  return { owner: tc.owner, actor: tc.actor ?? { developer: tc.owner.toLowerCase(), via: "session" } };
};

/** Ends the turn with one short question instead of a guess (grounding.ts). */
function askOwner(tc: ToolContext, question: string, options: readonly string[], why: string): { summary: string; data: unknown } {
  if (tc.ground) tc.ground.question = { question, options };
  return { summary: "Needs a detail", data: { asked: question, options, why, next: "The owner answers this question; do not guess the value." } };
}

/** A value the model wrote is acceptable when the owner stated it or a tool returned it this turn; without a ground (tests, scripts) it is not checked. */
const ok = (tc: ToolContext, value: string | number | undefined): boolean => value === undefined || !tc.ground || grounded(tc.ground, value);

const SIGN_IN_NOTE = "Nothing was saved: this chat has not proven control of the owner's address. The owner opens the link, signs in with the wallet (one message, no transaction), checks the prefilled form and saves it there.";
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const decimal = z.string().max(40).regex(DECIMAL);

const automationTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("price"), feed: z.enum(PRICE_FEEDS as unknown as [string, ...string[]]), op: z.enum(["above", "below"]), value: decimal }).strict(),
  z
    .object({
      type: z.literal("schedule"),
      every: z.enum(["day", "week", "month"]),
      weekday: z.enum(WEEKDAYS as unknown as [string, ...string[]]).optional(),
      day: z.number().int().min(1).max(28).optional(),
      at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
      timezone: z.string().min(1).max(64),
    })
    .strict(),
  z.object({ type: z.literal("balance"), token: z.string().min(2).max(10), op: z.enum(["above", "below"]), value: decimal }).strict(),
  z.object({ type: z.literal("event"), event: z.enum(AUTOMATION_EVENTS as unknown as [string, ...string[]]) }).strict(),
]);
const automationAction = z.discriminatedUnion("type", [z.object({ type: z.literal("plan"), sentence: z.string().min(3).max(400) }).strict(), z.object({ type: z.literal("notify"), channel: z.literal("webhook") }).strict()]);
type AutomationToolInput = { name: string; trigger: z.infer<typeof automationTrigger>; action: z.infer<typeof automationAction>; maxFiresPerDay?: number };

const AGENT_TOOLS: readonly ToolSpec<unknown>[] = [
  spec({
    name: "flock",
    description: "Read the owner's balance sheet on Arc: wallet tokens, Morpho vault positions, the Circle Gateway unified balance, USD values (null = unpriced).",
    capability: "read",
    schema: z.object({}).strict(),
    json: obj({}),
    async run(_input, tc) {
      const owner = needOwner(tc);
      const snap = await readOnce(tc, "snapshot", () => foldSnapshot(tc.ctx, tc.environment, owner, { fixture: fixtureScope(tc) }));
      return { summary: `Flock read: total ${snap.totalUsd === null ? "partly unpriced" : `$${snap.totalUsd}`}, ${snap.holdings.length} holdings`, data: snap };
    },
  }),
  spec({
    name: "positions",
    description: "Read where the owner's money is and what it is doing, in every venue Lykia supports on Arc: wallet tokens, Aave V4 supplies and borrows with health factors, Morpho vaults (named by curator: Galaxy, Keyrock, Steakhouse, Gauntlet, Bitwise) and Morpho Blue markets, Uniswap v3/v4, Aerodrome Slipstream, Archery, Unitflow V3 and SushiSwap V3 LP positions with range and fees, USYC, the Circle Gateway balance and, for the proven owner, CCTP and Relay transfers in flight, open orders, scheduled payments, leash budgets (what each bot may still spend, from the Arc wallet or a Gateway balance), step-by-step plans with steps still to sign, and watches. Any other kind (a new venue type) arrives with generic detail blocks: gauges with thresholds, ranges, timelines, facts, countdowns and PnL. Each position has a state (earning, idle, borrowing, at-risk, out-of-range, pending, escrowed, committed, watching), a value, an APY where known and one plain line of what it is doing. Venues that could not be read are named, never zeroed. Use it to answer 'where is my money and what is it doing?'. The positions card is shown with this read; do not call show_card for it.",
    capability: "read",
    schema: z.object({}).strict(),
    json: obj({}),
    async run(_input, tc) {
      const owner = needOwner(tc);
      const res = await readOnce(tc, "positions", () => foldPositions(tc.ctx, tc.environment, owner, { personal: tc.ownerVerified, fixture: fixtureScope(tc) }));
      // Dust and unpriced lines are folded into one count: they are not portfolio facts to recite.
      const material = materialPositions(res);
      const all = material.shown;
      const { positions: _count, unpriced: _unpriced, ...totals } = res.summary;
      if (tc.readOnly && !tc.blocks?.some((b) => b.kind === "facts")) tc.blocks?.push(positionsFacts(res, isSampleOwner(tc.owner) ? "The sample flock" : undefined, { sample: isSampleOwner(tc.owner) }));
      // In Ask the positions card rides on the read itself: the model does not spend a second round asking for it.
      if (!tc.readOnly && tc.agent.role === "orchestrator" && !tc.blocks?.some((b) => b.kind === "positions")) {
        const card = positionsCard(res);
        if (card) tc.blocks?.push(card);
      }
      return {
        summary: `${all.length} position(s)${material.hidden > 0 ? `, ${hiddenLine(material.hidden)}` : ""}; net ${res.summary.netUsd === null ? `$${res.summary.pricedNetUsd} priced` : `$${res.summary.netUsd}`}${res.summary.unavailable.length > 0 ? `; not read: ${res.summary.unavailable.join(", ")}` : ""}`,
        data: {
          summary: { ...totals, positionsShown: all.length, ...(material.hidden > 0 ? { hidden: hiddenLine(material.hidden), hiddenRule: "Say this one line at most; never count or describe the hidden lines." } : {}) },
          read: { at: res.at, block: res.block, note: "Cite figures with their source and this block or time; say unavailable for anything not here." },
          healthFloor: res.healthFloor,
          positions: all.map((p) => ({ venue: p.venue, kind: p.venueKind, label: p.label, state: p.state, amount: p.amount, symbol: p.symbol, valueUsd: p.valueUsd, doing: p.doing, apy: p.apy?.percent ?? null, health: p.health?.factor ?? null, inRange: p.range?.inRange ?? null, feesUsd: p.fees?.valueUsd ?? null, ...(p.claimable ? { claimable: p.claimable } : {}), ...(p.blocks ? { blocks: p.blocks } : {}), actions: p.actions.filter((a) => a.mode === "draft").map((a) => a.sentence) })),
          venues: res.venues.map((v) => ({ venue: v.venue, status: v.status, ...(v.reason ? { reason: v.reason } : {}), ...(v.coverage ? { coverage: v.coverage } : {}) })),
        },
      };
    },
  }),
  spec({
    name: "get_insights",
    description: "Read what Lyko on watch noticed on the owner's Fold: idle USDC above the liquidity floor, health factors near the Fence floor, EURC drift from the target mix, runway for scheduled payments, open approvals, red-flag tokens, low gas, today's cap headroom, orders near their trigger, agents near their budget, unsettled steps and better low-risk rates. Each has figures and, when there is a sensible move, a draft sentence the owner can plan. Use it before suggesting portfolio moves; the Fold shows the same list.",
    capability: "read",
    schema: z.object({}).strict(),
    json: obj({}),
    async run(_input, tc) {
      const owner = needOwner(tc);
      const view = await foldInsights(tc.ctx, tc.environment, owner, tc.ownerVerified);
      const open = view.insights.filter((i) => !i.handled);
      return { summary: `${open.length} insight(s) on the Fold`, data: open.map((i) => ({ id: i.id, kind: i.kind, severity: i.severity, title: i.title, explain: i.explain, figures: i.figures, draft: i.draft?.sentence ?? null })) };
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
    name: "capabilities",
    description: "Read Lyko's own capability map, built from code: every action (send, convert, swap, earn, withdraw, borrow, repay, bridge, Gateway) with the venues it routes through on this network, each bridge route (CCTP, Across, Relay, Gateway) with its destination chains and when it is picked, what each token can do and where USDC can be bridged, and the features with when to use them (Fence presets, Stress test, Leash, watches, step-by-step plans, Whistle, orders, alerts, recurring rules, payouts). Use it for 'what can you do', 'where can I bridge to', 'which protocols for ...', and to build the options of a clarifying question.",
    capability: "read",
    schema: z.object({ section: z.enum(["all", "actions", "bridges", "tokens", "features", "knowledge", "checks"]).optional() }).strict(),
    json: obj({ section: { type: "string", enum: ["all", "actions", "bridges", "tokens", "features", "knowledge", "checks"], description: "Optional: one part of the map. knowledge = limits, fees, plain meanings, what is off or not built, risks and what cannot be known." } }),
    async run(input: { section?: "all" | "actions" | "bridges" | "tokens" | "features" | "knowledge" | "checks" }, tc) {
      const map = await liveCapabilityMap(tc.ctx, tc.environment);
      const section = input.section ?? "all";
      // Coverage counts protocols; it is named so nobody reads it as a count of actions.
      const { coverage, ...rest } = map;
      const counts = { actions: map.actions.length, bridgeRoutes: map.bridges.length, features: map.features.length, protocolsLykiaRoutesThrough: coverage.routable, protocolsReachedThroughAnotherVenue: coverage.routableVia, protocolsMappedOnArc: coverage.mapped };
      const data = section === "all" ? { ...rest, counts } : { environment: map.environment, [section]: map[section], counts };
      return { summary: `Capability map: ${map.actions.length} actions, ${map.bridges.length} bridge routes, ${map.features.length} features`, data };
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
      "Find the best route for a goal sentence (write it in English), e.g. 'earn the best yield on 1000 USDC with medium risk' or 'borrow 1000 USDC on my cirBTC and put it to work with health ≥ 1.8'. Compares direct routes, other venues, convert-then-earn and multi-hop conversions, scores them by net value after fees, gas, slippage and risk, checks the winner's calldata with one eth_call, and explains why. Plans nothing for signing; use plan_intent with the winning sentence or ask the owner.",
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
    name: "fence",
    description: "Read the Fence you plan under: caps (per step, per intent, per day), allowed recipients, slippage and health limits, Scent requirement, when the owner must confirm, plus the mainnet beta cap and Lykia's protocol fee. Use it to answer questions about the owner's rules instead of guessing.",
    capability: "read",
    schema: z.object({}).strict(),
    json: obj({}),
    async run(_input, tc) {
      const { fee, beta } = tc.ctx.config;
      return {
        summary: `Fence ${tc.agent.fence.label ?? "custom"} (${tc.agent.fence.mode ?? "live"})`,
        data: { fence: tc.agent.fence, betaCap: tc.environment === "mainnet" ? beta : null, protocolFee: { bps: fee.bps, note: "Taken from the amount on swaps, conversions, deposits and bridges; paid on top of an exact send." } },
      };
    },
  }),
  spec({
    name: "draft_order",
    description:
      "Draft a conditional order on LykiaOrders: limit, stop-loss, take-profit (one execution at a trigger price) or dca, twap (several executions at an interval). Registry tokens only; triggers need a Chainlink pair (e.g. EURC/USD, BTC/USD via cirBTC). Returns the order summary, per-execution fee and minimum output, the allowance still needed and the Fence and beta verdict. Nothing is signed: the chat shows an order card the owner reviews and signs in their wallet.",
    capability: "propose",
    schema: z
      .object({
        kind: z.enum(ORDER_KINDS as unknown as [OrderKind, ...OrderKind[]]),
        sell: z.string().min(2).max(10),
        buy: z.string().min(2).max(10),
        amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u),
        executions: z.number().int().min(1).max(1000).optional(),
        intervalSeconds: z.number().int().min(60).max(30 * 86_400).optional(),
        triggerPrice: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u).optional(),
        triggerAbove: z.boolean().optional(),
      })
      .strict(),
    json: obj(
      {
        kind: { type: "string", enum: [...ORDER_KINDS] },
        sell: { type: "string", description: "Registry symbol the order spends, e.g. USDC" },
        buy: { type: "string", description: "Registry symbol the order buys, e.g. EURC" },
        amount: { type: "string", description: "Whole tokens per execution, e.g. \"0.25\"" },
        executions: { type: "integer", minimum: 1, maximum: 1000, description: "dca/twap: number of slices" },
        intervalSeconds: { type: "integer", minimum: 60, maximum: 2592000, description: "dca/twap: seconds between slices" },
        triggerPrice: { type: "string", description: "USD price of the non-USDC token that triggers the order, e.g. \"1.10\"" },
        triggerAbove: { type: "boolean", description: "true: fire at or above the trigger; false: at or below" },
      },
      ["kind", "sell", "buy", "amount"],
    ),
    async run(input: { kind: OrderKind; sell: string; buy: string; amount: string; executions?: number; intervalSeconds?: number; triggerPrice?: string; triggerAbove?: boolean }, tc) {
      const owner = needOwner(tc);
      // Every figure of the order comes from the owner (or a tool this turn): no invented size, trigger or schedule.
      if (!ok(tc, input.amount)) return askOwner(tc, `How much ${input.sell} should each execution of the ${input.kind} order sell?`, ["Let me type an amount"], `${input.amount} ${input.sell} was not stated.`);
      if (!ok(tc, input.triggerPrice)) return askOwner(tc, `At what ${input.sell === "USDC" ? input.buy : input.sell} price should the order trigger?`, ["Let me type a price"], `The trigger ${input.triggerPrice} was not stated.`);
      if (input.executions !== undefined && !ok(tc, input.executions)) return askOwner(tc, "How many slices should the order run?", ["4 slices", "6 slices", "10 slices"], `${input.executions} slices were not stated.`);
      if (input.intervalSeconds !== undefined && tc.ground && !intervalStated(tc.ground, input.intervalSeconds)) return askOwner(tc, "How often should a slice run?", ["Every hour", "Every 4 hours", "Every day"], "The interval was not stated.");
      const draft = await ordersService(tc.ctx).draft({ ...input, owner, environment: tc.environment });
      // The Fence and the mainnet beta cap judge one execution now (and again when the signed order is stored).
      const verdict = await orderVerdict(tc.ctx, { environment: tc.environment, owner, sell: input.sell, buy: input.buy, perExecution: input.amount, fence: tc.agent.fence, quote: quoteOf(draft, input.triggerPrice) });
      const reasons = verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message.slice(0, 300)).slice(0, 6);
      tc.blocks?.push({
        kind: "order",
        summary: draft.summary.slice(0, 240),
        environment: tc.environment,
        decision: verdict.decision,
        reasons,
        perExecution: { fee: draft.perExecution.fee, swapped: draft.perExecution.swapped, minOut: draft.perExecution.minOut, symbolIn: draft.perExecution.symbolIn, symbolOut: draft.perExecution.symbolOut },
        approval: draft.approval ? draft.approval.label.slice(0, 200) : null,
        executions: draft.order.executions,
        input: { kind: input.kind, sell: input.sell, buy: input.buy, amount: input.amount, ...(input.executions !== undefined ? { executions: input.executions } : {}), ...(input.intervalSeconds !== undefined ? { intervalSeconds: input.intervalSeconds } : {}), ...(input.triggerPrice !== undefined ? { triggerPrice: input.triggerPrice } : {}), ...(input.triggerAbove !== undefined ? { triggerAbove: input.triggerAbove } : {}) },
      });
      return {
        summary: `Order drafted (${verdict.decision}): ${draft.summary}`,
        data: { summary: draft.summary, hash: draft.hash, executions: draft.order.executions, intervalSeconds: draft.order.interval, perExecution: draft.perExecution, approvalNeeded: draft.approval ? draft.approval.label : null, notes: draft.notes, fence: { decision: verdict.decision, reasons }, next: verdict.decision === "deny" ? "The Fence refused it: say which rule and offer the nearest compliant order." : "The order card in this chat opens the review: the owner approves the allowance if needed and signs the order (EIP-712) in their wallet; funds stay in the wallet until a keeper executes it." },
      };
    },
  }),
  spec({
    name: "watch_position",
    description:
      "Hand a watch task to Lyko on watch (the Fold's portfolio assistant) when the owner asks you to watch something or tell them if it happens: health-below (threshold = health factor; venue aave-v4 or morpho-blue, optional), lp-out-of-range (venue optional), idle-above (token USDC or EURC, amount in whole tokens), apy-below (percent, venue optional). It shows in the Fold with a From Ask Lyko chip, can be paused or removed there, and raises an insight when the condition is met. It moves nothing. Use create_alert instead only when the owner wants a notification delivered to the inbox, a webhook or Telegram. Saved only when the owner is signed in.",
    capability: "propose",
    schema: z
      .object({
        kind: z.enum(WATCH_KINDS as unknown as [WatchCondition["kind"], ...WatchCondition["kind"][]]),
        threshold: decimal.optional(),
        venue: z.string().regex(/^[a-z0-9-]{2,40}$/u).optional(),
        token: z.enum(["USDC", "EURC"]).optional(),
        amount: decimal.optional(),
        percent: decimal.optional(),
      })
      .strict(),
    json: obj(
      {
        kind: { type: "string", enum: [...WATCH_KINDS] },
        threshold: { type: "string", description: "health-below: the health factor, e.g. \"1.5\"" },
        venue: { type: "string", description: "Optional venue id: aave-v4, morpho-blue, uniswap-v3, aerodrome-slipstream" },
        token: { type: "string", enum: ["USDC", "EURC"], description: "idle-above only" },
        amount: { type: "string", description: "idle-above only: whole tokens" },
        percent: { type: "string", description: "apy-below only: a percent, e.g. \"4\"" },
      },
      ["kind"],
    ),
    async run(input: { kind: WatchCondition["kind"]; threshold?: string; venue?: string; token?: "USDC" | "EURC"; amount?: string; percent?: string }, tc) {
      // The Fence's health floor is the documented default threshold; any other figure must be the owner's.
      const floor = tc.agent.fence.lending?.minHealthFactor ?? "1.5";
      if (input.threshold !== undefined && Number(input.threshold) !== Number(floor) && !ok(tc, input.threshold)) return askOwner(tc, "Below which health factor should Lyko on watch tell you?", [`${floor}, my Fence floor`, "Let me type a number"], `${input.threshold} was not stated.`);
      if (!ok(tc, input.amount)) return askOwner(tc, `Above how much idle ${input.token ?? "USDC"} should Lyko on watch tell you?`, ["Let me type an amount"], `${input.amount} was not stated.`);
      if (!ok(tc, input.percent)) return askOwner(tc, "Below which APY should Lyko on watch tell you?", ["Let me type a percent"], `${input.percent}% was not stated.`);
      // A venue the owner did not name is dropped: the watch then covers every venue of that kind.
      const venue = input.venue && (!tc.ground || venueNamed(tc.ground, tc.environment, input.venue)) ? { venue: input.venue } : {};
      const condition: WatchCondition | null =
        input.kind === "health-below" ? { kind: "health-below", threshold: input.threshold ?? tc.agent.fence.lending?.minHealthFactor ?? "1.5", ...venue }
        : input.kind === "lp-out-of-range" ? { kind: "lp-out-of-range", ...venue }
        : input.kind === "idle-above" ? (input.token && input.amount ? { kind: "idle-above", token: input.token, amount: input.amount } : null)
        : input.percent ? { kind: "apy-below", percent: input.percent, ...venue } : null;
      if (!condition) throw new Error("This watch needs its token and amount (idle-above) or its percent (apy-below).");
      const who = verifiedOwner(tc);
      if (!who) return { summary: "Watch not saved: the owner is not signed in", data: { saved: false, condition, next: "Nothing was saved: this chat has not proven control of the owner's address. The owner signs in with the wallet (one message, no transaction) and asks again." } };
      const made = await createWatch(tc.ctx, { owner: who.owner, environment: tc.environment, condition, threadId: tc.threadId ?? null });
      const label = (made.payload as WatchPayload).label;
      tc.blocks?.push({ kind: "herded", items: [{ kind: "watch", label, saved: true, href: "/app/fold/herding?show=watches", next: "Lyko on watch checks it each time it reads your Fold" }] });
      return { summary: `Handed to Lyko on watch: ${label}`, data: { saved: true, id: made.id, label, status: made.status, manage: "/app/fold/herding?show=watches" } };
    },
  }),
  spec({
    name: "read_instructions",
    description: "Read the hand-offs between you and Lyko on watch: plans Lyko on watch sent you (from Fold insights, with their status: planned, signed, done) and the watch tasks you handed over (with what each last saw). Owner-only.",
    capability: "read",
    schema: z.object({}).strict(),
    json: obj({}),
    async run(_input: Record<string, never>, tc) {
      const who = verifiedOwner(tc);
      if (!who) return { summary: "Not signed in", data: { instructions: [], note: "Hand-offs are private: the owner signs in first." } };
      const list = await listInstructions(tc.ctx, who.owner, { environment: tc.environment });
      const rows = list.slice(0, 12).map((i) => (i.kind === "plan" ? { kind: "plan", from: "Lyko on watch", status: i.status, title: (i.payload as PlanPayload).title, reason: (i.payload as PlanPayload).reason, intentId: (i.payload as PlanPayload).intentId ?? null } : { kind: "watch", to: "Lyko on watch", status: i.status, label: (i.payload as WatchPayload).label, lastSaw: (i.payload as WatchPayload).observation }));
      return { summary: `${rows.length} hand-off(s)`, data: { instructions: rows } };
    },
  }),
  spec({
    name: "create_alert",
    description:
      "Arm an alert for the owner: price-above / price-below (token EURC or cirBTC, threshold in USD, Chainlink-priced), health-below (threshold = health factor), transfer-in / transfer-out (token USDC or EURC, threshold = whole tokens), scent-warning, order-filled. Channels: inbox (default), webhook, telegram. Alerts never move money. When the owner is signed in it is saved and armed; otherwise nothing is saved and the result carries a link to the Alerts page with the form prefilled.",
    capability: "propose",
    schema: z
      .object({
        kind: z.enum(ALERT_KINDS as unknown as [AlertKind, ...AlertKind[]]),
        token: z.string().min(2).max(10).optional(),
        threshold: decimal.optional(),
        channels: z.array(z.enum(ALERT_CHANNELS as unknown as [AlertChannel, ...AlertChannel[]])).min(1).max(3).optional(),
        cooldownSeconds: z.number().int().min(ALERT_LIMITS.minCooldownSeconds).max(7 * 86_400).optional(),
      })
      .strict(),
    json: obj(
      {
        kind: { type: "string", enum: [...ALERT_KINDS] },
        token: { type: "string", description: "price alerts: EURC or cirBTC; transfer alerts: USDC or EURC" },
        threshold: { type: "string", description: "Decimal string: USD price, health factor, or whole tokens for transfers, e.g. \"1.10\"" },
        channels: { type: "array", items: { type: "string", enum: [...ALERT_CHANNELS] }, minItems: 1, maxItems: 3 },
        cooldownSeconds: { type: "integer", minimum: ALERT_LIMITS.minCooldownSeconds, maximum: 604800, description: `Quiet time after a firing; default ${ALERT_LIMITS.defaultCooldownSeconds}` },
      },
      ["kind"],
    ),
    async run(input: { kind: AlertKind; token?: string; threshold?: string; channels?: AlertChannel[]; cooldownSeconds?: number }, tc) {
      if (!ok(tc, input.threshold)) return askOwner(tc, input.kind.startsWith("price-") ? `At what ${input.token ?? "EURC"} price should the watch tell you?` : input.kind === "health-below" ? "Below which health factor should the watch tell you?" : "From how many tokens should the watch tell you?", ["Let me type a number"], `The threshold ${input.threshold} was not stated.`);
      const issue = alertInputIssue({ environment: tc.environment, kind: input.kind, ...(input.token ? { token: input.token } : {}), ...(input.threshold ? { threshold: input.threshold } : {}) });
      if (issue) throw new Error(issue);
      const usesToken = input.kind.startsWith("price-") || input.kind.startsWith("transfer-");
      const usesThreshold = usesToken || input.kind === "health-below";
      const token = usesToken && input.token ? (findToken(tc.environment, input.token)?.symbol ?? input.token) : undefined;
      const draft: AlertDraft = {
        kind: input.kind,
        ...(token ? { token } : {}),
        ...(usesThreshold && input.threshold ? { threshold: input.threshold } : {}),
        ...(input.channels ? { channels: [...new Set(input.channels)] } : {}),
        ...(input.cooldownSeconds ? { cooldownSeconds: input.cooldownSeconds } : {}),
      };
      const described = describeAlert(draft);
      const who = verifiedOwner(tc);
      if (!who) {
        const link = alertDraftLink(draft);
        tc.drafts?.push({ kind: "alert", saved: false, label: described, href: link });
        return { summary: `Watch drafted (not saved): ${described}`, data: { saved: false, alert: draft, description: described, link, next: SIGN_IN_NOTE } };
      }
      const rule = await alertsService(tc.ctx).create({ owner: who.owner, environment: tc.environment, ...draft });
      tc.drafts?.push({ kind: "alert", saved: true, label: described, href: "/app/fold/herding?show=watches" });
      return { summary: `Watch set: ${described}`, data: { saved: true, id: rule.id, description: described, channels: rule.channels, cooldownSeconds: rule.cooldownSeconds, manage: "/app/fold/herding?show=watches" } };
    },
  }),
  spec({
    name: "draft_automation",
    description:
      "Set up a recurring automation for the owner. Trigger: schedule (every day/week/month at HH:MM in an IANA time zone; weekly needs weekday, monthly needs day 1-28), price (a Chainlink feed above/below a value), balance (a registry token's wallet balance above/below a value) or event (payout or invoice events). Action: plan one plain English sentence each time it fires (checked against the Fence and delivered as a proposal the owner signs, never executed alone), or notify the owner's webhooks. Example: every Friday 17:00 Europe/Istanbul, plan 'keep 1 USDC liquid and earn the rest'. When the owner is signed in it is saved; otherwise nothing is saved and the result carries a link to the Automations page with the form prefilled.",
    capability: "propose",
    schema: z.object({ name: z.string().min(1).max(120), trigger: automationTrigger, action: automationAction, maxFiresPerDay: z.number().int().min(1).max(24).optional() }).strict() as unknown as z.ZodType<AutomationToolInput>,
    json: obj(
      {
        name: { type: "string", maxLength: 120, description: "Short label, e.g. \"Friday USDC sweep\"" },
        trigger: {
          type: "object",
          description: "type picks the fields: price {feed, op, value}; schedule {every, weekday?, day?, at, timezone}; balance {token, op, value}; event {event}",
          properties: {
            type: { type: "string", enum: ["price", "schedule", "balance", "event"] },
            feed: { type: "string", enum: [...PRICE_FEEDS] },
            op: { type: "string", enum: ["above", "below"] },
            value: { type: "string", description: "Decimal string" },
            every: { type: "string", enum: ["day", "week", "month"] },
            weekday: { type: "string", enum: [...WEEKDAYS] },
            day: { type: "integer", minimum: 1, maximum: 28 },
            at: { type: "string", description: "HH:MM, 24-hour" },
            timezone: { type: "string", description: "IANA time zone, e.g. Europe/Istanbul or UTC" },
            token: { type: "string", description: "Registry symbol, e.g. USDC" },
            event: { type: "string", enum: [...AUTOMATION_EVENTS] },
          },
          required: ["type"],
          additionalProperties: false,
        },
        action: {
          type: "object",
          description: "plan {sentence}: one English sentence re-planned at each fire; notify {channel: webhook}",
          properties: { type: { type: "string", enum: ["plan", "notify"] }, sentence: { type: "string", maxLength: 400 }, channel: { type: "string", enum: ["webhook"] } },
          required: ["type"],
          additionalProperties: false,
        },
        maxFiresPerDay: { type: "integer", minimum: 1, maximum: 24 },
      },
      ["name", "trigger", "action"],
    ),
    async run(input: AutomationToolInput, tc) {
      const trigger = input.trigger as AutomationTrigger;
      if ((trigger.type === "price" || trigger.type === "balance") && !ok(tc, trigger.value)) return askOwner(tc, trigger.type === "price" ? `At what ${trigger.feed} price should it run?` : `At what ${trigger.token} balance should it run?`, ["Let me type a number"], `The trigger value ${trigger.value} was not stated.`);
      if (trigger.type === "schedule" && tc.ground && !timeStated(tc.ground, trigger.at)) return askOwner(tc, "At what time should it run, and in which time zone?", ["09:00 UTC", "17:00 Europe/Istanbul", "Let me type a time"], `The time ${trigger.at} was not stated.`);
      if (input.action.type === "plan" && tc.ground) {
        const sentenceActions = readSentence(input.action.sentence).actions;
        const invented = sentenceActions.map((a) => (a as { amount?: { exact?: string } }).amount?.exact).find((x) => x !== undefined && !grounded(tc.ground!, x));
        if (invented !== undefined) return askOwner(tc, `How much should each run use? ${invented} was not something you said.`, ["Everything above my floor", "Let me type an amount"], `${invented} in the plan sentence was not stated.`);
        const venue = sentenceActions.map((a) => (a as { venue?: string }).venue).find((v) => typeof v === "string" && !venueNamed(tc.ground!, tc.environment, v));
        if (venue) throw new Error(`The owner named no venue: drop "${venue}" from the plan sentence so each run uses the route search's best venue.`);
      }
      const issues = validateAutomationTrigger(trigger);
      if (trigger.type === "schedule" && trigger.every === "week" && !trigger.weekday) issues.push({ path: "trigger.weekday", message: "A weekly run needs a weekday." });
      if (trigger.type === "schedule" && trigger.every === "month" && !trigger.day) issues.push({ path: "trigger.day", message: "A monthly run needs a day from 1 to 28." });
      if (issues.length > 0) throw new Error(`Invalid trigger: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
      if (trigger.type === "balance" && !findToken(tc.environment, trigger.token)) throw new Error(`${trigger.token} is not a registry token.`);
      if (input.action.type === "plan") {
        const parsed = readSentence(input.action.sentence);
        if (parsed.clarify.length > 0 || parsed.actions.length === 0) return { summary: "Needs a detail", data: { saved: false, clarify: parsed.clarify.length > 0 ? parsed.clarify : [parsed.reply] } };
        const actionIssues = validateActions(parsed.actions);
        if (actionIssues.length > 0) throw new Error(`The sentence does not make a valid plan: ${actionIssues.map((i) => i.message).join("; ")}`);
      }
      const draft: AutomationDraft = { name: input.name, trigger, action: input.action, ...(input.maxFiresPerDay ? { maxFiresPerDay: input.maxFiresPerDay } : {}) };
      const when = describeAutomationTrigger(trigger);
      const what = input.action.type === "plan" ? `plan "${input.action.sentence}"` : "notify webhooks";
      const who = verifiedOwner(tc);
      if (!who) {
        const link = automationDraftLink(draft);
        tc.drafts?.push({ kind: "automation", saved: false, label: input.name, href: link, next: when.slice(0, 80) });
        return { summary: `Automation drafted (not saved): ${when}, ${what}`, data: { saved: false, automation: draft, trigger: when, action: what, link, next: SIGN_IN_NOTE } };
      }
      const saved = await createAutomation(
        tc.ctx,
        { developer: who.actor.developer, project: null, via: who.actor.via, consentProject: who.actor.projectId ?? null },
        { owner: who.owner, name: input.name, environment: tc.environment, trigger, action: input.action, fence: tc.agent.fence, ...(input.maxFiresPerDay ? { maxFiresPerDay: input.maxFiresPerDay } : {}) },
      );
      tc.drafts?.push({ kind: "automation", saved: true, label: input.name, href: "/app/fold/herding?show=automations", next: when.slice(0, 80) });
      return {
        summary: `Automation saved (${saved.status}): ${when}, ${what}`,
        data: { saved: true, id: saved.id, status: saved.status, trigger: when, action: what, fence: tc.agent.fence.label ?? "custom", next: "Each fire is checked against the Fence and arrives as a proposal the owner signs; nothing moves on its own. Pause it in the Fold's Running list; change it in Ask.", manage: "/app/fold/herding?show=automations" },
      };
    },
  }),
  spec({
    name: "compile_goal",
    description:
      "Compile a request with several goals, a time dimension (every month, on the 1st, if BTC goes above) or abstract wording (safe, defensive, the rest, a third, runway, hedge, out within a day) into a verified program: it reads the owner's balances, resolves shares, remainders and reserves into amounts, plans everything that happens now as ONE route under your Fence (the owner signs it), drafts automations, LykiaOrders orders and alerts for later (saved only when the owner is signed in, otherwise links), and returns the assumptions it made, trade-offs, rejected alternatives and questions. Pass the owner's own words (any language). Use overrides (assumption id -> value) to apply a change the owner asked for.",
    capability: "propose",
    schema: z.object({ goal: z.string().min(3).max(1000), overrides: z.record(z.string().max(64), z.string().max(64)).optional() }).strict(),
    json: obj({ goal: { type: "string", maxLength: 1000, description: "The owner's request in their own words." }, overrides: { type: "object", description: "Assumption id -> value, e.g. {\"share:e3\": \"25%\", \"schedule.timezone\": \"Europe/Berlin\"}", additionalProperties: { type: "string" } } }, ["goal"]),
    async run(input: { goal: string; overrides?: Record<string, string> }, tc) {
      const owner = needOwner(tc);
      // Amounts are grounded against the owner's own words, never against the model's restatement of them.
      const result = await compileIntent(tc.ctx, { text: input.goal, ...(tc.ground ? { ownerText: tc.ground.ownerText } : {}), owner, environment: tc.environment, fence: tc.agent.fence, search: false, proposedByAgent: true, ...(input.overrides ? { overrides: input.overrides } : {}) });
      const who = verifiedOwner(tc);
      const delivered = await deliver({ ctx: tc.ctx, environment: tc.environment, owner, fence: tc.agent.fence, verified: who ? who.actor : null, agent: { name: tc.agent.name, role: tc.agent.role }, proposedByAgent: true }, result, input.overrides ?? {});
      if (delivered.proposal) tc.proposals.push(delivered.proposal);
      tc.drafts?.push(...delivered.drafts);
      tc.programs?.push(delivered.view);
      tc.blocks?.push(...delivered.blocks);
      const v = delivered.view;
      return {
        summary: `Compiled (${result.status}): ${result.why.summary}`,
        data: {
          status: result.status,
          programHash: result.programHash,
          goals: v.goals,
          now: v.now ? { steps: v.now.steps.map((st) => st.summary), decision: v.now.decision, reasons: v.now.reasons, signable: delivered.proposal?.intentId ? "the owner signs it from the route panel" : "dry run" } : null,
          planError: delivered.planError,
          scheduled: v.scheduled.map((sch) => ({ kind: sch.kind, summary: sch.summary, saved: sch.saved, decision: sch.decision })),
          kept: v.kept,
          fees: v.fees,
          assumptions: v.assumptions.map((a) => ({ id: a.id, text: a.text, options: a.options })),
          questions: v.questions,
          refusals: v.refusals,
          blockers: v.blockers,
          tradeoffs: v.tradeoffs,
          rejected: v.rejected,
          next: "Present Now / Scheduled / Assumptions in a few lines, then ask the owner to confirm or change an assumption. Drafts with saved: false are links the owner opens signed in.",
        },
      };
    },
  }),
  spec({
    name: "plan_intent",
    description:
      "Propose a plan from one plain English sentence, e.g. 'deposit 100 USDC into Morpho', 'convert 200 USDC to EURC', 'send 20 USDC to 0x… for invoice 12', 'bridge 50 USDC to base'. Several moves can be chained with 'then'. The plan is checked against your own Fence; the owner signs later. Returns the steps and the verdict.",
    capability: "propose",
    schema: z.object({ sentence: z.string().min(3).max(400), why: z.string().max(300).optional() }).strict(),
    json: obj({ sentence: { type: "string", maxLength: 400 }, why: { type: "string", maxLength: 300, description: "One line: why this plan serves the goal." } }, ["sentence"]),
    async run(input: { sentence: string; why?: string }, tc) {
      const owner = needOwner(tc);
      const parsed = await readWithMemory(tc.ctx, tc.ownerVerified ? owner : null, input.sentence);
      if (parsed.clarify.length > 0 || parsed.actions.length === 0) return { summary: "Needs a detail", data: { clarify: parsed.clarify.length > 0 ? parsed.clarify : [parsed.reply] } };
      // Grounding: every amount, recipient and venue comes from the owner, a tool this turn, or a documented default.
      let actions = [...parsed.actions];
      const notes: string[] = [];
      if (tc.ground) {
        const g = await groundActions(tc.ctx, tc.ground, actions, { environment: tc.environment, owner, personal: tc.ownerVerified });
        if (!g.ok) return askOwner(tc, g.question, g.options, g.reason);
        actions = g.actions;
        notes.push(...g.notes);
      }
      // Route choice is binding: for earn, convert and bridge without an owner-named venue, the deterministic search picks the route and plan_intent plans exactly its winner.
      let routeLine: string | null = null;
      if (searchBinds(actions)) {
        const result = await services(tc.ctx).search.search({ environment: tc.environment, owner, actions, fence: tc.agent.fence, proposedByAgent: true, spent: await services(tc.ctx).intents.spent(tc.environment, owner), source: input.sentence });
        recordToolData(tc.ground, { best: result.best ? { label: result.best.label, net: result.best.score.totalUsd, steps: result.best.explanation.steps } : null });
        if (!result.best) return { summary: "Refused: no route passed", data: { refused: [...result.pruned.slice(0, 4).map((p) => `${p.label}: ${p.reason}`), ...result.failedChecks.map((f) => `${f.label}: ${f.reason}`)].join("; ") || "No route passed the Fence and the checks." } };
        actions = [...result.best.actions];
        routeLine = `Route search winner: ${result.best.label} (net ${result.best.score.totalUsd ?? "unpriced"} USD over 90 days; beat ${result.alternatives.length} other option${result.alternatives.length === 1 ? "" : "s"}).`;
      }
      const outcome = await planActions(tc.ctx, actions, input.sentence, { environment: tc.environment, owner, fence: tc.agent.fence, proposedByAgent: true });
      if (outcome.kind === "clarify") return { summary: "Needs a detail", data: { clarify: outcome.questions } };
      if (outcome.kind === "refused") {
        // A refusal preflight could name (an unsupported chain, a bridge minimum) still reaches the owner as a card with its reason.
        if (outcome.findings && outcome.findings.length > 0) tc.proposals.push({ intentId: null, title: input.sentence, steps: [], decision: "deny", reasons: [outcome.message], warnings: [], preflight: outcome.findings, attribution: [{ agent: tc.agent.name, role: tc.agent.role, part: input.sentence }], rationale: "" });
        return { summary: `Refused: ${outcome.message}`, data: { refused: outcome.message, ...(outcome.findings ? { preflight: outcome.findings.map((f) => ({ severity: f.severity, say: f.say })) } : {}) } };
      }
      const { intent } = outcome.result;
      const proposal: AgentProposal = {
        intentId: outcome.result.stored ? intent.id : null,
        title: input.sentence,
        steps: intent.steps.map((s) => s.summary),
        decision: intent.verdict.decision,
        reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message),
        warnings: intent.warnings, ...preflightOf(intent),
        attribution: [{ agent: tc.agent.name, role: tc.agent.role, part: input.sentence }],
        rationale: [input.why ?? "", ...notes, routeLine ?? ""].filter(Boolean).join(" ").slice(0, 600),
      };
      tc.proposals.push(proposal);
      tc.planned?.push({ actions: outcome.actions, proposal });
      const gate = fenceCard(intent, tc.agent.fence);
      if (gate) tc.blocks?.push(gate);
      const fx = intent.verdict.decision === "deny" ? null : quotedRate(intent);
      const tile = fx ? await rateCard(tc.ctx, fx.base, fx.quote, tc.agent.fence, fx.rate) : null;
      if (tile) tc.blocks?.push(tile);
      // The protocol fee explains why a step moves a little less (or a send costs a little more) than the sentence said.
      const fees = intent.steps.flatMap((st) => (st.fee ? [{ step: st.id, fee: `${fromBaseUnits(st.fee.amount, st.fee.decimals)} ${st.fee.symbol}`, bps: st.fee.bps, basis: FEE_BASIS[st.fee.basis] }] : []));
      const compared = intent.steps.map((st) => st.route?.reason).filter((r): r is string => Boolean(r));
      return { summary: `Planned (${intent.verdict.decision}): ${proposal.steps.join(" → ")}`, data: { intentId: proposal.intentId, steps: proposal.steps, decision: proposal.decision, reasons: proposal.reasons, warnings: proposal.warnings, ...(notes.length > 0 ? { grounding: notes } : {}), ...(routeLine ? { route: routeLine } : {}), ...(compared.length > 0 ? { why: compared } : {}), ...(fees.length > 0 ? { lykiaFees: fees } : {}), ...(intent.preflight && intent.preflight.length > 0 ? { preflight: intent.preflight.map((f) => ({ severity: f.severity, title: f.title, say: f.say, fixes: f.fixes.length })), preflightRule: "A block or warn finding leads the answer (the code writes that sentence first); the chat shows its fixes as chips the owner picks. Never apply a fix yourself, and never present a blocked plan as ready to sign." } : {}) } };
    },
  }),
  spec({
    name: "create_leash",
    description:
      "Draft a leash for an outside bot or agent: its name, what it is for (pay-invoices, trade-small or earn), a daily budget, optional most-in-one-step, how many days, the payees it may pay, and where it spends from (arc: your LykiaAccount; gateway: your Gateway balance through your LykiaStile). Every figure must be the owner's own: when one is missing the owner gets a question with options. Nothing is created here: the chat shows a leash card that opens the review sheet, where the owner checks it, gets the key and signs the session once.",
    capability: "propose",
    schema: z
      .object({
        name: z.string().min(1).max(48),
        template: z.enum(["pay-invoices", "trade-small", "earn"]),
        perDayUsd: decimal.optional(),
        perStepUsd: decimal.optional(),
        days: z.number().int().min(1).max(90).optional(),
        recipients: z.array(address).max(20).optional(),
        spendFrom: z.enum(["arc", "gateway"]).optional(),
      })
      .strict(),
    json: obj(
      {
        name: { type: "string", maxLength: 48, description: "Who holds the leash, e.g. \"Invoice bot\"" },
        template: { type: "string", enum: ["pay-invoices", "trade-small", "earn"] },
        perDayUsd: { type: "string", description: "USD a day, the owner's own figure" },
        perStepUsd: { type: "string", description: "Optional: most in one step" },
        days: { type: "integer", minimum: 1, maximum: 90 },
        recipients: { type: "array", items: { type: "string" }, maxItems: 20, description: "pay-invoices: the payees the owner named" },
        spendFrom: { type: "string", enum: ["arc", "gateway"], description: "gateway: the owner's Gateway balance through LykiaStile (the Stile option)" },
      },
      ["name", "template"],
    ),
    async run(input: { name: string; template: "pay-invoices" | "trade-small" | "earn"; perDayUsd?: string; perStepUsd?: string; days?: number; recipients?: string[]; spendFrom?: "arc" | "gateway" }, tc) {
      const days = input.days !== undefined && ok(tc, input.days) ? input.days : null;
      const perDay = input.perDayUsd !== undefined && ok(tc, input.perDayUsd) ? input.perDayUsd : null;
      const perStep = input.perStepUsd !== undefined && ok(tc, input.perStepUsd) ? input.perStepUsd : null;
      for (const r of input.recipients ?? []) if (tc.ground && !tc.ground.ownerText.toLowerCase().includes(r.toLowerCase()) && !tc.ground.toolAddresses.has(r.toLowerCase())) return askOwner(tc, `Who may ${input.name} pay? Paste the addresses.`, [], `The payee ${r} was not given by the owner.`);
      const drafted = leashDraftBlock({ name: input.name, template: input.template, perDayUsd: perDay, perStepUsd: perStep, days, ...(input.recipients ? { recipients: input.recipients } : {}), ...(input.spendFrom ? { spendFrom: input.spendFrom } : {}) });
      if (!drafted.ok) return askOwner(tc, drafted.question, drafted.options, drafted.reason);
      tc.blocks?.push(drafted.block);
      return { summary: `Leash drafted: ${drafted.summary}`, data: { drafted: drafted.summary, next: "The leash card in this chat opens the review: the owner checks it, gets the leash key once and signs the session. Nothing exists until then." } };
    },
  }),
  spec({
    name: "turn_on_autopilot",
    description: `Draft Autopilot: Lyko signs the owner's own automations inside a leash on the owner's LykiaAccount. Limits: per step and per day in USD (at most $${AUTOPILOT_BETA.perStepUsd} and $${AUTOPILOT_BETA.perDayUsd} in beta) and days (1 to 30), plus the payees it may pay. Every limit must be the owner's own; otherwise the owner gets a question with options. Nothing is turned on here: the chat shows an Autopilot card that opens the review (read what it holds, accept, sign once).`,
    capability: "propose",
    schema: z.object({ perStepUsd: decimal.optional(), perDayUsd: decimal.optional(), days: z.number().int().min(1).max(30).optional(), payees: z.array(address).max(10).optional() }).strict(),
    json: obj({ perStepUsd: { type: "string" }, perDayUsd: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 30 }, payees: { type: "array", items: { type: "string" }, maxItems: 10 } }),
    async run(input: { perStepUsd?: string; perDayUsd?: string; days?: number; payees?: string[] }, tc) {
      const pick = <T extends string | number>(v: T | undefined) => (v !== undefined && ok(tc, v) ? v : null);
      for (const p of input.payees ?? []) if (tc.ground && !tc.ground.ownerText.toLowerCase().includes(p.toLowerCase())) return askOwner(tc, "Who may Autopilot pay? Paste the addresses.", [], `The payee ${p} was not given by the owner.`);
      const drafted = autopilotDraft({ perStepUsd: pick(input.perStepUsd), perDayUsd: pick(input.perDayUsd), days: pick(input.days), payees: input.payees ?? [], environment: tc.environment });
      if (!drafted.ok) return askOwner(tc, drafted.question, drafted.options, drafted.reason);
      tc.blocks?.push(drafted.block);
      return { summary: drafted.summary, data: { drafted: drafted.summary, next: "The Autopilot card in this chat opens the review: the owner reads what it holds, accepts and signs its session once." } };
    },
  }),
  spec({
    name: "add_autopilot_task",
    description: "Draft an automation Autopilot signs: repay (amountUsd, floor = health factor, Aave), sweep (keepUsd stays in the account, amountUsd at most per run, vault name) or pay (amountUsd, every day/week/month, payee named when Autopilot was turned on). DCA is not an Autopilot task: use draft_order with kind dca. Every figure must be the owner's own. Nothing is added here: the chat shows a card the owner confirms.",
    capability: "propose",
    schema: z
      .object({
        kind: z.enum(["repay", "sweep", "pay"]),
        amountUsd: decimal,
        floor: decimal.optional(),
        keepUsd: decimal.optional(),
        vault: z.string().min(2).max(48).optional(),
        every: z.enum(["day", "week", "month"]).optional(),
        payee: address.optional(),
      })
      .strict(),
    json: obj({ kind: { type: "string", enum: ["repay", "sweep", "pay"] }, amountUsd: { type: "string" }, floor: { type: "string" }, keepUsd: { type: "string" }, vault: { type: "string" }, every: { type: "string", enum: ["day", "week", "month"] }, payee: { type: "string" } }, ["kind", "amountUsd"]),
    async run(input: { kind: "repay" | "sweep" | "pay"; amountUsd: string; floor?: string; keepUsd?: string; vault?: string; every?: "day" | "week" | "month"; payee?: string }, tc) {
      if (!ok(tc, input.amountUsd)) return askOwner(tc, "How much at most should one run move?", ["Let me type an amount"], `${input.amountUsd} was not stated.`);
      if (input.floor !== undefined && !ok(tc, input.floor)) return askOwner(tc, "Below which health factor should Autopilot repay?", ["1.5", "1.3"], `${input.floor} was not stated.`);
      if (input.keepUsd !== undefined && !ok(tc, input.keepUsd)) return askOwner(tc, "How much USDC should stay in your account?", ["Let me type an amount"], `${input.keepUsd} was not stated.`);
      if (input.payee && tc.ground && !tc.ground.ownerText.toLowerCase().includes(input.payee.toLowerCase())) return askOwner(tc, "Who should Autopilot pay? Paste the address.", [], "The payee was not given by the owner.");
      const task: AutopilotTaskInput | null =
        input.kind === "repay" ? (input.floor ? { kind: "repay", amountUsd: input.amountUsd, floor: input.floor } : null)
        : input.kind === "sweep" ? (input.keepUsd && input.vault ? { kind: "sweep", keepUsd: input.keepUsd, amountUsd: input.amountUsd, vault: input.vault } : null)
        : input.every && input.payee ? { kind: "pay", amountUsd: input.amountUsd, every: input.every, payee: input.payee as Address } : null;
      const missing = task ? null : input.kind === "repay" ? "floor" : input.kind === "sweep" ? (input.keepUsd ? "vault" : "keep") : input.payee ? "every" : "payee";
      const drafted = await autopilotTaskDraft(tc.ctx, tc.owner, tc.environment, task, missing, []);
      if (!drafted.ok) return askOwner(tc, drafted.question, drafted.options, drafted.reason);
      tc.blocks?.push(drafted.block);
      return { summary: drafted.summary, data: { drafted: drafted.summary, next: "The task card in this chat adds it once the owner confirms; it then shows in the Fold's Running list as an automation Autopilot signs." } };
    },
  }),
  spec({
    name: "create_agent",
    description: "Draft a Pack agent for the owner: it holds a leash (its own Fence inside the owner's, and a daily budget carved from it). Name, role (treasurer, payroll, fx-hedger, yield-keeper, bill-payer, sentinel, researcher or custom), a daily budget in USD and an optional mission. The budget must be the owner's own; otherwise the owner gets a question with options. Nothing is created here: the chat shows an agent card the owner confirms.",
    capability: "propose",
    schema: z.object({ name: z.string().min(1).max(48), role: z.enum(["treasurer", "payroll", "fx-hedger", "yield-keeper", "bill-payer", "sentinel", "researcher", "custom"]), dailyUsd: decimal.optional(), mission: z.string().max(400).optional() }).strict(),
    json: obj({ name: { type: "string", maxLength: 48 }, role: { type: "string", enum: ["treasurer", "payroll", "fx-hedger", "yield-keeper", "bill-payer", "sentinel", "researcher", "custom"] }, dailyUsd: { type: "string" }, mission: { type: "string", maxLength: 400 } }, ["name", "role"]),
    async run(input: { name: string; role: string; dailyUsd?: string; mission?: string }, tc) {
      const drafted = agentDraft({ name: input.name, role: input.role, dailyUsd: input.dailyUsd !== undefined && ok(tc, input.dailyUsd) ? input.dailyUsd : null, mission: input.mission ?? null, environment: tc.environment });
      if (!drafted.ok) return askOwner(tc, drafted.question, drafted.options, drafted.reason);
      tc.blocks?.push(drafted.block);
      return { summary: drafted.summary, data: { drafted: drafted.summary, next: "The agent card in this chat creates it once the owner confirms; it shows in the Fold's Pack with its leash and Revoke." } };
    },
  }),
  spec({
    name: "yields",
    description: "Live rates for USDC or EURC across Arc's vaults and lending markets, best first, each with its risk tier and source. Use it for \"where can I earn\" questions; the chat shows a yields card. Never state a rate this did not return.",
    capability: "read",
    schema: z.object({ token: z.enum(["USDC", "EURC"]) }).strict(),
    json: obj({ token: { type: "string", enum: ["USDC", "EURC"] } }, ["token"]),
    async run(input: { token: "USDC" | "EURC" }, tc) {
      const card = await yieldsCard(tc.ctx, tc.environment, input.token);
      tc.blocks?.push(card.block);
      return { summary: card.summary, data: { rows: card.rows } };
    },
  }),
  spec({
    name: "stop_plan",
    description: "Stop a plan in progress for the owner: every step not started yet is stopped; settled steps stay settled. Use it when the owner says stop, cancel or never mind about a plan from this chat (its intentId is in the plan's tool result or read_instructions). Owner-only; it also shows in the Fold's Herding list.",
    capability: "propose",
    schema: z.object({ intentId: z.string().regex(/^out_[A-Za-z0-9_-]{6,32}$/u) }).strict(),
    json: obj({ intentId: { type: "string", description: "The plan's id, out_…" } }, ["intentId"]),
    async run(input: { intentId: string }, tc) {
      const who = verifiedOwner(tc);
      if (!who) return { summary: "Not stopped: the owner is not signed in", data: { stopped: false, next: "Stopping is the owner's call: sign in with the wallet (one message, no transaction), or press Stop on the plan in the Fold." } };
      const { intent } = await services(tc.ctx).intents.get(input.intentId);
      if (intent.owner.toLowerCase() !== who.owner.toLowerCase()) throw new Error("That plan belongs to another owner.");
      const stopped = await services(tc.ctx).intents.stop(input.intentId);
      const steps = stopped.intent.steps;
      return { summary: `Stopped ${input.intentId}`, data: { stopped: true, intentId: input.intentId, settled: steps.filter((st) => st.status === "settled").length, stoppedSteps: steps.filter((st) => st.status === "stopped").length, manage: "/app/fold/herding" } };
    },
  }),
];

/** Lyko on watch reads, never plans: positions, the Flock, insights, the capability map, its hand-offs and reference prices. */
export const WATCH_TOOL_NAMES = ["positions", "flock", "get_insights", "capabilities", "read_instructions", "prices"] as const;

/** Tools an agent may see: its capabilities decide, and a dry-run-only Fence still plans (dry runs). Read-only mode keeps the watch tools only. */
export function toolsFor(agent: ActingAgent, options: { readonly readOnly?: boolean } = {}): ToolSpec<unknown>[] {
  const allowed = AGENT_TOOLS.filter((t) => agent.capabilities.includes(t.capability));
  return options.readOnly ? allowed.filter((t) => (WATCH_TOOL_NAMES as readonly string[]).includes(t.name) && t.capability === "read") : allowed;
}

export function toolDefinitions(tools: readonly ToolSpec<unknown>[]): LlmTool[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.json as LlmTool["input_schema"] }));
}

/** Runs a tool call from the model. Unknown tools, tools outside the agent's set and bad input never run. */
export async function runTool(name: string, rawInput: unknown, tc: ToolContext, allowed: readonly ToolSpec<unknown>[] = toolsFor(tc.agent, { readOnly: tc.readOnly === true })): Promise<ToolOutcome> {
  const tool = allowed.find((t) => t.name === name);
  if (!tool) return failure(`${tc.agent.name} has no tool named ${name}.`);
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) return failure(`Invalid input for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  try {
    const { summary, data } = await tool.run(parsed.data, tc);
    // What a tool returned this turn may be cited by later calls and by the final text (grounding.ts, numberGuard.ts).
    recordToolData(tc.ground, data);
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
