/**
 * The tools a Pack agent can call. Each tool names the capability it needs;
 * an agent only sees the tools its capabilities allow, and `plan_intent`
 * always plans under the calling agent's own Fence, so a specialist cannot
 * propose what its Fence forbids. No tool signs, sends, or edits a Fence.
 *
 * Every tool result goes back to the model wrapped as untrusted data:
 * token names, memos and card text are written by strangers.
 */
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
  getProtocol,
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
import type { AgentProposal, ChatDraftLink } from "@lykia/core/api/agents";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { services } from "../services.js";
import { planSentence } from "./engine.js";
import { knowledgePaths } from "../engine/search.js";
import { ordersService } from "../orders/service.js";
import { alertInputIssue, alertsService } from "../alerts/service.js";
import { createAutomation } from "../devflows/automations.js";
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
  /**
   * True only when the request proved control of `owner`: a SIWE session for
   * that address, or a secret key with the agents scope acting for it. Tools
   * that save state for the owner (alerts, automations) save only when this is
   * true; otherwise they return a draft and a link the owner opens signed in.
   */
  readonly ownerVerified: boolean;
  /** Who saves for the owner when verified: the owner's session, or the developer behind the secret key. */
  readonly actor?: { readonly developer: string; readonly via: "session" | "secret" };
  /** Alerts and automations set up this turn (saved, or a link to the prefilled form); the chat shows them as buttons. */
  readonly drafts?: ChatDraftLink[];
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
      "Draft a conditional order on LykiaOrders: limit, stop-loss, take-profit (one execution at a trigger price) or dca, twap (several executions at an interval). Registry tokens only; triggers need a Chainlink pair (e.g. EURC/USD, BTC/USD via cirBTC). Returns the order summary, per-execution fee and minimum output, and the allowance still needed. Nothing is signed: the owner signs the order on the Orders page.",
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
      const draft = await ordersService(tc.ctx).draft({ ...input, owner, environment: tc.environment });
      return {
        summary: `Order drafted: ${draft.summary}`,
        data: { summary: draft.summary, hash: draft.hash, executions: draft.order.executions, intervalSeconds: draft.order.interval, perExecution: draft.perExecution, approvalNeeded: draft.approval ? draft.approval.label : null, notes: draft.notes, next: "The owner signs this order (EIP-712) on the Orders page; funds stay in the wallet until a keeper executes it." },
      };
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
        return { summary: `Alert drafted (not saved): ${described}`, data: { saved: false, alert: draft, description: described, link, next: SIGN_IN_NOTE } };
      }
      const rule = await alertsService(tc.ctx).create({ owner: who.owner, environment: tc.environment, ...draft });
      tc.drafts?.push({ kind: "alert", saved: true, label: described, href: "/app/alerts" });
      return { summary: `Alert armed: ${described}`, data: { saved: true, id: rule.id, description: described, channels: rule.channels, cooldownSeconds: rule.cooldownSeconds, manage: "/app/alerts" } };
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
        tc.drafts?.push({ kind: "automation", saved: false, label: input.name, href: link });
        return { summary: `Automation drafted (not saved): ${when}, ${what}`, data: { saved: false, automation: draft, trigger: when, action: what, link, next: SIGN_IN_NOTE } };
      }
      const saved = await createAutomation(
        tc.ctx,
        { developer: who.actor.developer, project: null, via: who.actor.via },
        { owner: who.owner, name: input.name, environment: tc.environment, trigger, action: input.action, fence: tc.agent.fence, ...(input.maxFiresPerDay ? { maxFiresPerDay: input.maxFiresPerDay } : {}) },
      );
      tc.drafts?.push({ kind: "automation", saved: true, label: input.name, href: "/app/automations" });
      return {
        summary: `Automation saved (${saved.status}): ${when}, ${what}`,
        data: { saved: true, id: saved.id, status: saved.status, trigger: when, action: what, fence: tc.agent.fence.label ?? "custom", next: "Each fire is checked against the Fence and arrives as a proposal the owner signs; nothing moves on its own. Pause or delete it on the Automations page.", manage: "/app/automations" },
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
      // The protocol fee explains why a step moves a little less (or a send costs a little more) than the sentence said.
      const fees = intent.steps.flatMap((st) => (st.fee ? [{ step: st.id, fee: `${fromBaseUnits(st.fee.amount, st.fee.decimals)} ${st.fee.symbol}`, bps: st.fee.bps, basis: FEE_BASIS[st.fee.basis] }] : []));
      return { summary: `Planned (${intent.verdict.decision}): ${proposal.steps.join(" → ")}`, data: { intentId: proposal.intentId, steps: proposal.steps, decision: proposal.decision, reasons: proposal.reasons, warnings: proposal.warnings, ...(fees.length > 0 ? { lykiaFees: fees } : {}) } };
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
