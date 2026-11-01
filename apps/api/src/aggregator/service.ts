/**
 * The aggregator: Lykia's best-execution layer for every Arc protocol,
 * served as one "quote -> build" shape for every action type.
 *
 *   quote  plan the action as a dry run with live quotes (the same planner,
 *          router and Fence the app uses), store the request under a quote
 *          id for QUOTE_TTL_MS, and return the best route, the alternatives,
 *          price impact, gas in USDC, Lykia's fee, the integrator's fee and
 *          the Fence verdict.
 *   build  re-plan with fresh quotes (from a quote id or from params),
 *          refuse when the price moved past the quoted minimum, check the
 *          Fence (deny -> 422, confirm without `confirm: true` -> 409), shape
 *          the calls (per-step EOA transactions with Arc Memo and
 *          Multicall3From, one batch for the whole route, plain calls for
 *          smart accounts, or EIP-5792 wallet_sendCalls), self-check the
 *          whole route in one eth_call, and run the security layer on every
 *          step (a block -> 409 SECURITY_BLOCKED). Nothing is signed or
 *          broadcast; Lykia's fee rides inside each step's own batch.
 */
import { randomBytes } from "node:crypto";
import {
  DEFAULT_FEE_BPS,
  fenceForProfile,
  fromBaseUnits,
  MAX_INTEGRATOR_FEE_BPS,
  networkFor,
  projectFence,
  tightenFence,
  usdMicros,
  validIntegratorFee,
  venueKnowledge,
  verdictTag,
  type Address,
  type ArcEnvironment,
  type Fence,
  type IntegratorFeePolicy,
  type IntentGraph,
  type IntentStep,
  type LykiaMemo,
  type PlanAction,
  type UnsignedTransaction,
  type VenueOption,
} from "@lykia/core";
import type { SecurityReport } from "@lykia/core/security/index";
import type { Request } from "express";
import type { AppContext } from "../context.js";
import { ADAPTER_VENUE, buildCalls, EXECUTABLE_VENUES, type StepPlan } from "../engine/adapters.js";
import { batched, shape, withMemo, type RawCall } from "../engine/calls.js";
import type { PlanResult } from "../engine/planner.js";
import type { VenuePrefs } from "../engine/router.js";
import { externalInputs } from "../engine/search.js";
import { bindingOf, newIntentId } from "../engine/service.js";
import { simulateRoute, type RouteSimulation } from "../engine/simulate.js";
import { LykiaHttpError } from "../http/errors.js";
import { getProfile } from "../personal/profile.js";
import { integratorFeeOf, projectOf } from "../platform/projects.js";
import { securityReview } from "../security/preflight.js";
import type { SimulationResult } from "../security/simulate.js";
import { routableManifests } from "../integrations/registry.js";
import { services } from "../services.js";
import { EXTRA_PROVIDERS, poweredByLabel, providerQuotes, type ProviderQuote, type ProviderRequest } from "../engine/providers.js";
import { feeCall } from "../engine/calls.js";
import type { JsonValue } from "../store/types.js";

export const QUOTE_TTL_MS = 60_000;
/** Quotes stay readable a little longer than they are buildable, so an expired id says "expired", not "unknown". */
const QUOTE_KEEP_MS = 10 * 60_000;
const STEP_OVERHEAD_GAS = 60_000;

export const ACTION_KINDS = ["transfer", "swap", "fx", "bridge", "deposit", "withdraw", "supply", "borrow", "repay", "batch"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type AmountInput = string | "all";

/** One request shape for every action type; only the fields of the kind are read. */
export interface ActionRequest {
  readonly kind: ActionKind;
  readonly environment?: ArcEnvironment;
  /** The account that signs (alias: owner). */
  readonly taker: Address;
  readonly tokenIn?: string;
  readonly tokenOut?: string;
  readonly token?: string;
  readonly amount?: AmountInput;
  readonly to?: Address;
  readonly memo?: string;
  readonly destination?: string;
  readonly recipient?: Address;
  readonly venue?: string;
  readonly maxRisk?: "low" | "medium" | "high";
  readonly collateral?: { readonly token: string; readonly amount?: AmountInput };
  readonly minHealth?: string;
  readonly actions?: readonly PlanAction[];
  readonly slippageBps?: number;
  readonly integratorFee?: { readonly bps: number; readonly recipient: Address };
  readonly venues?: { readonly include?: readonly string[]; readonly exclude?: readonly string[] };
  /** Split a swap across two pools when it pays (default true). */
  readonly split?: boolean;
  readonly fence?: Fence;
  readonly signer?: "wallet" | "agent";
  readonly agent?: { readonly address: Address; readonly agentId?: string };
}

export interface BuildOptions {
  /** transactions: EOA transactions (Arc Memo + Multicall3From); calls: plain calls for smart accounts; eip5792: wallet_sendCalls params. */
  readonly format?: "transactions" | "calls" | "eip5792";
  /** EOA only: one Multicall3From transaction for the whole route instead of one per step. */
  readonly batch?: "step" | "single";
  /** The Fence asked for confirmation and the owner gave it. */
  readonly confirm?: boolean;
  /** The taker does not hold the inputs yet: plan past short balances and fund the self-check with state overrides. */
  readonly preview?: boolean;
  /** Execute through a registered provider (engine/providers.ts) instead of Lykia's engine; "lykia" is the default. */
  readonly provider?: string;
}

interface Resolved {
  readonly environment: ArcEnvironment;
  readonly taker: Address;
  readonly actions: PlanAction[];
  readonly fence: Fence;
  readonly preferences: VenuePrefs;
  readonly integrator?: IntegratorFeePolicy;
}

const amountOf = (value: AmountInput | undefined): { exact: string } | { all: true } => {
  if (value === undefined) throw new LykiaHttpError("INVALID_REQUEST", 400, "amount is required.");
  return value === "all" ? { all: true } : { exact: value };
};

const need = <T>(value: T | undefined, name: string): T => {
  if (value === undefined || value === null || value === "") throw new LykiaHttpError("INVALID_REQUEST", 400, `${name} is required for this action.`);
  return value;
};

/** The request as plan actions (validated again by core before planning). */
export function actionsOf(req: ActionRequest): PlanAction[] {
  switch (req.kind) {
    case "transfer":
      return [{ verb: "send", token: need(req.token, "token"), amount: amountOf(req.amount), to: need(req.to, "to"), ...(req.memo ? { memo: req.memo } : {}) }];
    case "swap":
    case "fx": {
      const from = need(req.tokenIn, "tokenIn");
      const to = need(req.tokenOut, "tokenOut");
      const fx = (from === "USDC" && to === "EURC") || (from === "EURC" && to === "USDC");
      if (req.kind === "fx" && !fx) throw new LykiaHttpError("INVALID_REQUEST", 400, "fx converts USDC <-> EURC; use swap for other pairs.");
      // The planner names USDC<->EURC "fx" either way; "swap" carries the caller's slippage.
      return [{ verb: "swap", from, to, amount: amountOf(req.amount), ...(req.slippageBps !== undefined ? { slippageBps: req.slippageBps } : {}) }];
    }
    case "bridge":
      return [{ verb: "bridge", token: "USDC", amount: amountOf(req.amount), destination: need(req.destination, "destination"), ...(req.recipient ? { recipient: req.recipient } : {}) }];
    case "deposit":
      return [{ verb: "earn", token: need(req.token, "token"), amount: amountOf(req.amount), ...(req.venue ? { venue: req.venue } : {}), ...(req.maxRisk ? { maxRisk: req.maxRisk } : {}) }];
    case "withdraw":
      return [{ verb: "withdraw", token: need(req.token, "token"), amount: amountOf(req.amount), ...(req.venue ? { venue: req.venue } : {}) }];
    case "supply":
      return [{ verb: "supply", token: need(req.token, "token"), amount: amountOf(req.amount), ...(req.venue ? { venue: req.venue } : {}) }];
    case "borrow":
      return [{ verb: "borrow", token: need(req.token, "token"), amount: amountOf(req.amount), ...(req.venue ? { venue: req.venue } : {}), ...(req.collateral ? { collateral: { token: req.collateral.token, ...(req.collateral.amount ? { amount: amountOf(req.collateral.amount) } : {}) } } : {}), ...(req.minHealth ? { minHealth: req.minHealth } : {}) }];
    case "repay":
      return [{ verb: "repay", token: need(req.token, "token"), amount: amountOf(req.amount), ...(req.venue ? { venue: req.venue } : {}) }];
    case "batch":
      return [...need(req.actions, "actions")];
  }
}

/** The integrator's fee: the caller's, else the project's; capped like the project app fee (MAX_INTEGRATOR_FEE_BPS). */
export function integratorOf(req: ActionRequest, project: ReturnType<typeof projectOf>): IntegratorFeePolicy | undefined {
  if (req.integratorFee) {
    const policy = { bps: req.integratorFee.bps, recipient: req.integratorFee.recipient, ...(project ? { projectId: project.id } : {}) };
    if (!validIntegratorFee(policy)) throw new LykiaHttpError("INVALID_REQUEST", 400, `integratorFee.bps must be an integer from 0 to ${MAX_INTEGRATOR_FEE_BPS} and recipient an address.`);
    return policy.bps > 0 ? policy : undefined;
  }
  return integratorFeeOf(project);
}

async function resolve(ctx: AppContext, req: ActionRequest, http: Request | null): Promise<Resolved> {
  const project = http ? projectOf(http) : null;
  const profile = await getProfile(ctx, req.taker);
  // Same precedence as POST /v1/intents: the request's Fence, else the project's, else the owner's profile. A project only tightens.
  let fence = req.fence ?? (project ? projectFence(project) : fenceForProfile(profile));
  if (project) fence = tightenFence(fence, project);
  const environment = req.environment ?? (project ? project.network : ctx.config.mode);
  const known = new Set([...EXECUTABLE_VENUES[environment], "aerodrome-slipstream", ...(await routableManifests(ctx, environment).catch(() => [])).map((m) => m.protocol.id)]);
  const include = req.venues?.include;
  const blocked = [...new Set([...profile.venues.blocked, ...(req.venues?.exclude ?? []), ...(include && include.length > 0 ? [...known].filter((v) => !include.includes(v)) : [])])];
  const preferences: VenuePrefs = { favorites: profile.venues.favorites, blocked, maxRisk: profile.risk, ...(req.split === false ? { noSplit: true } : {}) };
  const integrator = integratorOf(req, project);
  return { environment, taker: req.taker, actions: actionsOf(req), fence, preferences, ...(integrator ? { integrator } : {}) };
}

async function plan(ctx: AppContext, req: ActionRequest, r: Resolved, dryRun: boolean): Promise<PlanResult> {
  const s = services(ctx);
  return s.planner.plan({
    id: newIntentId(),
    environment: r.environment,
    owner: r.taker,
    signer: req.signer ?? "wallet",
    ...(req.agent ? { agent: req.agent } : {}),
    actions: r.actions,
    fence: r.fence,
    source: `aggregator:${req.kind}`,
    now: ctx.clock.now(),
    spent: await s.intents.spent(r.environment, r.taker),
    ...(dryRun ? { dryRun: true } : {}),
    preferences: r.preferences,
    ...(r.integrator ? { integrator: r.integrator } : {}),
  });
}

async function gasPrice(ctx: AppContext, environment: ArcEnvironment): Promise<bigint> {
  try {
    const live = await (ctx.chains.client(environment) as unknown as { getGasPrice?: () => Promise<bigint> }).getGasPrice?.();
    if (typeof live === "bigint" && live > 0n) return live;
  } catch {
    /* Arc's floor */
  }
  return 20_000_000_000n;
}

function gasUnits(result: PlanResult): number {
  return result.graph.steps.reduce((sum, step) => {
    const adapter = result.plans[step.id]?.adapter;
    const row = adapter ? venueKnowledge(adapter === "manifest" ? step.venue : ADAPTER_VENUE[adapter]) : null;
    const cap = row?.capabilities.find((c) => c.adapter === adapter);
    return sum + (cap?.gas ?? 150_000) + STEP_OVERHEAD_GAS;
  }, 0);
}

const usdText = (micros: bigint) => `${micros < 0n ? "-" : ""}${(micros < 0n ? -micros : micros) / 1_000_000n}.${((micros < 0n ? -micros : micros) % 1_000_000n).toString().padStart(6, "0")}`;

function feesOf(steps: readonly IntentStep[]) {
  let lykia = 0n;
  let app = 0n;
  let unpriced = false;
  const lines: { stepId: string; symbol: string; lykia: string; integrator: string | null; bps: number; integratorBps: number | null; usd: string | null }[] = [];
  for (const step of steps) {
    if (!step.fee) continue;
    const f = step.fee;
    if (f.usd === null || (f.integrator && f.integrator.usd === null)) unpriced = true;
    lykia += f.usd ? usdMicros(f.usd) : 0n;
    app += f.integrator?.usd ? usdMicros(f.integrator.usd) : 0n;
    lines.push({ stepId: step.id, symbol: f.symbol, lykia: fromBaseUnits(f.amount, f.decimals), integrator: f.integrator ? fromBaseUnits(f.integrator.amount, f.decimals) : null, bps: f.bps, integratorBps: f.integrator?.bps ?? null, usd: f.usd });
  }
  return { lykiaUsd: unpriced ? null : usdText(lykia), integratorUsd: unpriced ? null : usdText(app), totalUsd: unpriced ? null : usdText(lykia + app), lines };
}

/** Price impact of the conversion steps in bps: input value after fees vs output value, at Chainlink prices. */
function priceImpactBps(steps: readonly IntentStep[]): number | null {
  const conversions = steps.filter((s) => s.kind === "swap" || s.kind === "fx");
  if (conversions.length === 0) return null;
  let inMicros = 0n;
  let outMicros = 0n;
  for (const step of conversions) {
    for (const i of step.inputs) {
      if (i.usd === null) return null;
      inMicros += usdMicros(i.usd);
    }
    if (step.fee) {
      if (step.fee.usd === null) return null;
      inMicros -= usdMicros(step.fee.usd) + (step.fee.integrator?.usd ? usdMicros(step.fee.integrator.usd) : 0n);
    }
    for (const o of step.outputs) {
      if (o.usd === null) return null;
      outMicros += usdMicros(o.usd);
    }
  }
  if (inMicros <= 0n) return null;
  return Number(((inMicros - outMicros) * 10_000n) / inMicros);
}

function amountView(a: IntentStep["inputs"][number]) {
  return { symbol: a.symbol, token: a.token, amount: fromBaseUnits(a.amount, a.decimals), units: a.amount, ...(a.minimum ? { minimum: fromBaseUnits(a.minimum, a.decimals), minimumUnits: a.minimum } : {}), usd: a.usd };
}

export interface QuoteView {
  readonly id: string;
  readonly kind: ActionKind;
  readonly environment: ArcEnvironment;
  readonly taker: Address;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly sell: ReturnType<typeof amountView>[];
  readonly buy: ReturnType<typeof amountView>[];
  readonly route: { readonly steps: readonly { id: string; kind: string; venue: string; summary: string; reason: string | null; split: unknown }[] };
  readonly best: VenueOption | null;
  readonly alternatives: readonly VenueOption[];
  readonly priceImpactBps: number | null;
  readonly gas: { readonly units: number; readonly priceWei: string; readonly usdc: string };
  readonly fees: ReturnType<typeof feesOf> & { readonly lykiaBps: number; readonly integrator: { readonly bps: number; readonly recipient: Address } | null };
  readonly fence: { readonly decision: string; readonly signable: boolean; readonly reasons: readonly string[]; readonly digest: string };
  readonly warnings: readonly string[];
  readonly actions: readonly PlanAction[];
  /** Other ways to execute the same action (engine/providers.ts), e.g. Circle-native paths labelled "Powered by Circle". */
  readonly providers?: { readonly quotes: readonly (ProviderQuote & { readonly badge: string | null })[]; readonly errors: readonly { provider: string; message: string }[] };
}

function describePlan(ctx: AppContext, id: string, req: ActionRequest, r: Resolved, result: PlanResult, price: bigint): QuoteView {
  const graph = result.graph;
  const now = ctx.clock.now();
  const steps = graph.steps;
  // What leaves the wallet: inputs no earlier step produced. What arrives: the last outputs.
  const produced = new Set(steps.flatMap((s) => s.outputs.map((o) => o.symbol)));
  const sell = steps.flatMap((s) => s.inputs.filter((i) => !produced.has(i.symbol) || s === steps[0])).map(amountView);
  const lastWithOutput = [...steps].reverse().find((s) => s.outputs.length > 0);
  const buy = (lastWithOutput?.outputs ?? []).map(amountView);
  const routed = steps.find((s) => s.route);
  const units = gasUnits(result);
  const feeView = feesOf(steps);
  return {
    id,
    kind: req.kind,
    environment: r.environment,
    taker: r.taker,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(),
    sell,
    buy,
    route: { steps: steps.map((s) => ({ id: s.id, kind: s.kind, venue: s.venue, summary: s.summary, reason: s.route?.reason ?? null, split: s.route?.split ?? null })) },
    best: routed?.route?.chosen ?? null,
    alternatives: routed?.route?.alternatives ?? [],
    priceImpactBps: priceImpactBps(steps),
    gas: { units, priceWei: price.toString(), usdc: fromBaseUnits(BigInt(units) * price, 18) },
    fees: { ...feeView, lykiaBps: ctx.config.fee.bps ?? DEFAULT_FEE_BPS, integrator: r.integrator ? { bps: r.integrator.bps, recipient: r.integrator.recipient } : null },
    fence: { decision: graph.verdict.decision, signable: graph.verdict.signable, reasons: graph.verdict.reasons.filter((x) => x.decision !== "allow").map((x) => x.message), digest: graph.verdict.digest },
    warnings: graph.warnings,
    actions: r.actions,
  };
}

function quotes(ctx: AppContext) {
  return ctx.store.collection<JsonValue>("aggregator_quotes");
}

/** Quote any action: best route, alternatives, price impact, gas, fees, Fence verdict and a quote id. */
export async function quoteAction(ctx: AppContext, req: ActionRequest, http: Request | null = null): Promise<QuoteView> {
  const r = await resolve(ctx, req, http);
  const [result, price] = await Promise.all([plan(ctx, req, r, true), gasPrice(ctx, r.environment)]);
  const id = `q_${randomBytes(12).toString("base64url")}`;
  const providerRequest: ProviderRequest = { kind: req.kind, environment: r.environment, taker: r.taker, actions: r.actions, graph: result.graph, ...(req.slippageBps !== undefined ? { slippageBps: req.slippageBps } : {}) };
  const extra = EXTRA_PROVIDERS.length > 0 ? await providerQuotes(ctx, providerRequest) : { quotes: [], errors: [] };
  const view: QuoteView = { ...describePlan(ctx, id, req, r, result, price), providers: { quotes: extra.quotes.map((q) => ({ ...q, badge: poweredByLabel(q) })), errors: extra.errors } };
  await quotes(ctx).put(id, { request: req as unknown as JsonValue, expiresAt: view.expiresAt, buy: view.buy as unknown as JsonValue, project: http ? (projectOf(http)?.id ?? null) : null }, { ttlMs: QUOTE_KEEP_MS });
  return view;
}

/** The request stored under a quote id; 404 unknown, 410 expired. */
export async function quoteRequest(ctx: AppContext, id: string): Promise<{ request: ActionRequest; buy: { symbol: string; minimumUnits?: string; units: string }[] }> {
  if (!/^q_[A-Za-z0-9_-]{8,40}$/u.test(id)) throw new LykiaHttpError("NOT_FOUND", 404, "No such quote.");
  const doc = await quotes(ctx).get(id);
  if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No such quote (quotes are kept for 10 minutes).");
  const value = doc.value as unknown as { request: ActionRequest; expiresAt: string; buy: { symbol: string; minimumUnits?: string; units: string }[] };
  if (Date.parse(value.expiresAt) < ctx.clock.now()) throw new LykiaHttpError("QUOTE_EXPIRED", 410, "This quote has expired; ask for a new one.", { expiresAt: value.expiresAt });
  return { request: value.request, buy: value.buy };
}

export interface BuiltStep {
  readonly id: string;
  readonly kind: string;
  readonly venue: string;
  readonly summary: string;
  readonly transactions: readonly UnsignedTransaction[];
  readonly calls: readonly { readonly to: Address; readonly data: `0x${string}`; readonly value: string; readonly label: string }[];
  readonly binding: string;
  readonly memo: string;
  readonly security: SecurityReport;
}

export interface BuildView extends Omit<QuoteView, "id" | "expiresAt"> {
  readonly quoteId: string | null;
  readonly intentId: string;
  readonly format: NonNullable<BuildOptions["format"]>;
  readonly preview: boolean;
  readonly chainId: number;
  /** format "transactions": what the EOA signs, in order. */
  readonly transactions: readonly UnsignedTransaction[];
  /** Plain calls in order (smart accounts, batching wallets). */
  readonly calls: readonly { readonly to: Address; readonly data: `0x${string}`; readonly value: string; readonly label: string; readonly stepId: string }[];
  /** format "eip5792": the params of wallet_sendCalls. */
  readonly walletSendCalls: { readonly version: "2.0.0"; readonly chainId: `0x${string}`; readonly from: Address; readonly atomicRequired: true; readonly calls: readonly { to: Address; data: `0x${string}`; value: `0x${string}` }[] } | null;
  readonly steps: readonly BuiltStep[];
  readonly simulation: RouteSimulation;
  readonly security: { readonly decision: "pass" | "warn" | "block"; readonly findings: number; readonly warnings: readonly string[] };
}

function routeSimResult(stepId: string, sim: RouteSimulation): SimulationResult {
  if (sim.ok) return { method: "eth_call", findings: [], assetChanges: [] };
  const failedHere = sim.failedStep === stepId || sim.failedStep === undefined;
  const findings = failedHere ? [{ layer: "simulation" as const, rule: "simulation.reverts", severity: "block" as const, message: `The route would revert on Arc: ${sim.reason ?? "the simulation failed"}.`, stepId }] : [];
  return { method: "eth_call", findings, assetChanges: [] };
}

/** Build ready-to-sign calls for an action (or a stored quote), simulated and checked by the security layer first. */
export async function buildAction(ctx: AppContext, input: { readonly quoteId?: string; readonly request?: ActionRequest }, options: BuildOptions = {}, http: Request | null = null): Promise<BuildView> {
  let req: ActionRequest;
  let quoted: { symbol: string; minimumUnits?: string; units: string }[] | null = null;
  if (input.quoteId) {
    const stored = await quoteRequest(ctx, input.quoteId);
    req = stored.request;
    quoted = stored.buy;
  } else if (input.request) req = input.request;
  else throw new LykiaHttpError("INVALID_REQUEST", 400, "Send a quoteId or the action's params.");
  const format = options.format ?? "transactions";
  if (options.batch === "single" && format !== "transactions") throw new LykiaHttpError("INVALID_REQUEST", 400, "batch: single shapes EOA transactions; smart accounts get plain calls already.");
  const r = await resolve(ctx, req, http);
  const preview = options.preview === true;
  const [result, price] = await Promise.all([plan(ctx, req, r, preview), gasPrice(ctx, r.environment)]);
  const graph: IntentGraph = result.graph;
  const verdict = graph.verdict;

  // The Fence decides first, and fails closed.
  if (verdict.decision === "deny") throw new LykiaHttpError("FENCE_DENIED", 422, verdict.reasons.filter((x) => x.decision === "deny").map((x) => x.message).join(" "), { verdict: { decision: verdict.decision, digest: verdict.digest, reasons: verdict.reasons } });
  if (!verdict.signable) throw new LykiaHttpError("NOT_SIGNABLE", 409, "This Fence is in dry-run mode: nothing is built for signing.", { verdict: verdict.digest });
  if (verdict.decision === "confirm" && !options.confirm) throw new LykiaHttpError("CONFIRMATION_REQUIRED", 409, "The Fence asks the owner to confirm this move; build again with confirm: true once they have.", { reasons: verdict.reasons.filter((x) => x.decision === "confirm").map((x) => x.message) });

  // A built route never guarantees less than the quote did.
  if (quoted) {
    const last = [...graph.steps].reverse().find((s) => s.outputs.length > 0);
    for (const q of quoted) {
      const now = last?.outputs.find((o) => o.symbol === q.symbol);
      if (q.minimumUnits && now && BigInt(now.amount) < BigInt(q.minimumUnits)) throw new LykiaHttpError("PRICE_MOVED", 409, `The price moved: ${q.symbol} out is now below the quoted minimum. Ask for a new quote.`, { quotedMinimum: q.minimumUnits, now: now.amount });
    }
  }

  const network = networkFor(r.environment);
  const account = req.agent?.address ?? r.taker;
  if (options.provider && options.provider !== "lykia") return providerBuild(ctx, { req, r, result, price, options, quoteId: input.quoteId ?? null, account, chainId: network.chainId });
  const accountKind = format === "transactions" ? "eoa" : "smart";
  const steps = graph.steps.map((s) => ({ step: s, plan: result.plans[s.id] as StepPlan }));

  // Self-check: the whole route in one Multicall3From eth_call from the account (funded with overrides in preview).
  const short = graph.warnings.some((w) => w.startsWith("Dry run:"));
  const simulation = await simulateRoute(ctx.chains, r.environment, account, { intentId: graph.id, verdictDigest: verdict.digest, steps: steps.map((s) => ({ id: s.step.id, plan: s.plan })), ...(preview && short ? { fund: externalInputs(graph.steps) } : {}) });

  const built: BuiltStep[] = [];
  const singleCalls: RawCall[] = [];
  for (const { step, plan: stepPlan } of steps) {
    const memo: LykiaMemo = { intentId: graph.id, stepId: step.id, verdict: verdictTag(verdict.digest), ...(stepPlan.params.note ? { note: stepPlan.params.note } : {}) };
    const calls = await buildCalls(stepPlan, { environment: r.environment, chains: ctx.chains, account });
    const shapeOptions = { environment: r.environment, chainId: network.chainId, from: account, memo, account: accountKind as "eoa" | "smart" };
    const transactions = shape(calls.calls, calls.approvals, shapeOptions);
    const plain = [...calls.approvals, ...calls.calls].map((c) => ({ to: c.to, data: c.data, value: "0", label: c.label }));
    if (options.batch === "single") {
      let target = calls.calls.length - 1;
      while (target > 0 && calls.calls[target]?.role === "fee") target -= 1;
      singleCalls.push(...calls.approvals, ...calls.calls.map((c, i) => (i === target ? withMemo(c, shapeOptions) : c)));
    }
    const binding = bindingOf(transactions);
    const security = await securityReview(ctx, { graph, step, params: stepPlan.params, transactions, binding, mode: "build", simulation: routeSimResult(step.id, simulation) });
    built.push({ id: step.id, kind: step.kind, venue: step.venue, summary: step.summary, transactions, calls: plain, binding, memo: `lykia:1:${memo.intentId}:${memo.stepId}:${memo.verdict}${memo.note ? `|${memo.note}` : ""}`, security });
  }

  const transactions: UnsignedTransaction[] =
    options.batch === "single" && singleCalls.length > 0
      ? (() => {
          const one = batched(singleCalls, r.environment);
          return [{ chainId: network.chainId, from: account, to: one.to, data: one.data, value: "0", label: `Whole route in one transaction: ${built.map((b) => b.summary).join(" + ")}` }];
        })()
      : built.flatMap((b) => b.transactions);
  const calls = built.flatMap((b) => b.calls.map((c) => ({ ...c, stepId: b.id })));
  const view = describePlan(ctx, input.quoteId ?? "", req, r, result, price);
  const { id: _id, expiresAt: _exp, ...rest } = view;
  const findings = built.flatMap((b) => b.security.findings);
  const warnings = [...new Set(findings.filter((f) => f.severity === "warn").map((f) => f.message))];
  return {
    ...rest,
    quoteId: input.quoteId ?? null,
    intentId: graph.id,
    format,
    preview,
    chainId: network.chainId,
    transactions: format === "transactions" ? transactions : [],
    calls,
    walletSendCalls: format === "eip5792" ? { version: "2.0.0", chainId: `0x${network.chainId.toString(16)}`, from: account, atomicRequired: true, calls: calls.map((c) => ({ to: c.to, data: c.data, value: `0x${BigInt(c.value).toString(16)}` as `0x${string}` })) } : null,
    steps: built,
    simulation,
    security: { decision: built.some((b) => b.security.decision === "warn") ? "warn" : "pass", findings: findings.length, warnings },
    warnings: [...graph.warnings, ...(preview && short ? ["Preview: the taker does not hold every input yet; the self-check funded them with state overrides. Fund the wallet before signing."] : [])],
  };
}


/**
 * A build through a registered provider. The Fence already passed (the
 * caller checked it on the engine's plan). On-chain provider transactions
 * get Lykia's fee transfers in front, are simulated and go through the
 * security layer like any build; an off-chain execution handle is returned
 * as is. Single-step actions only, so the security layer can diff the
 * provider's calls against one planned step.
 */
async function providerBuild(
  ctx: AppContext,
  input: { req: ActionRequest; r: Resolved; result: PlanResult; price: bigint; options: BuildOptions; quoteId: string | null; account: Address; chainId: number },
): Promise<BuildView & { readonly provider: { readonly id: string; readonly badge: string | null; readonly execution: { id: string; status: string; url?: string } | null; readonly notes: readonly string[] } }> {
  const { req, r, result, price, options, account, chainId } = input;
  const provider = EXTRA_PROVIDERS.find((p) => p.id === options.provider);
  if (!provider || !provider.build || !provider.kinds.includes(req.kind) || !provider.environments.includes(r.environment)) throw new LykiaHttpError("INVALID_REQUEST", 400, `No provider ${options.provider} can build ${req.kind} on Arc ${r.environment}.`);
  if (!provider.available(ctx)) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 503, `${provider.label} is not configured on this server.`);
  const graph = result.graph;
  if (graph.steps.length !== 1) throw new LykiaHttpError("INVALID_REQUEST", 400, "Provider builds take one step; build multi-step routes through Lykia's engine.");
  const step = graph.steps[0]!;
  const out = await provider.build(ctx, { kind: req.kind, environment: r.environment, taker: r.taker, actions: r.actions, graph, ...(req.slippageBps !== undefined ? { slippageBps: req.slippageBps } : {}) }, { account: options.format === "transactions" || options.format === undefined ? "eoa" : "smart" });
  if (!out) throw new LykiaHttpError("NO_ROUTE", 422, `${provider.label} cannot build this action.`);
  const fees: UnsignedTransaction[] = [];
  if (step.fee) {
    const f = step.fee;
    const lykia = feeCall(f.token, f.recipient, BigInt(f.amount), "Lykia fee");
    fees.push({ chainId, from: account, to: lykia.to, data: lykia.data, value: "0", label: lykia.label });
    if (f.integrator && BigInt(f.integrator.amount) > 0n) {
      const app = feeCall(f.token, f.integrator.recipient, BigInt(f.integrator.amount), "App fee");
      fees.push({ chainId, from: account, to: app.to, data: app.data, value: "0", label: app.label });
    }
  }
  const transactions = out.transactions ? [...fees, ...out.transactions] : [];
  const binding = bindingOf(transactions);
  const security = transactions.length > 0 ? await securityReview(ctx, { graph, step, params: result.plans[step.id]?.params ?? {}, transactions, binding, mode: "build" }) : null;
  const view = describePlan(ctx, input.quoteId ?? "", req, r, result, price);
  const { id: _id, expiresAt: _exp, ...rest } = view;
  const calls = transactions.map((t) => ({ to: t.to, data: t.data, value: t.value, label: t.label, stepId: step.id }));
  const notes = [...out.notes, ...(out.execution && step.fee ? ["Off-chain execution: Lykia's fee is settled with the provider's own flow."] : [])];
  return {
    ...rest,
    quoteId: input.quoteId,
    intentId: graph.id,
    format: options.format ?? "transactions",
    preview: options.preview === true,
    chainId,
    transactions,
    calls,
    walletSendCalls: options.format === "eip5792" ? { version: "2.0.0", chainId: `0x${chainId.toString(16)}`, from: account, atomicRequired: true, calls: calls.map((c) => ({ to: c.to, data: c.data, value: `0x${BigInt(c.value).toString(16)}` as `0x${string}` })) } : null,
    steps: security ? [{ id: step.id, kind: step.kind, venue: provider.id, summary: step.summary, transactions, calls, binding, memo: "", security }] : [],
    simulation: { ok: security !== null, mode: "batch", calls: [], funded: [], block: null, ...(security ? {} : { reason: "Executed off chain by the provider; nothing to simulate." }) },
    security: { decision: security?.decision === "warn" ? "warn" : "pass", findings: security?.findings.length ?? 0, warnings: security ? security.findings.filter((f) => f.severity === "warn").map((f) => f.message) : [] },
    provider: { id: provider.id, badge: poweredByLabel(provider), execution: out.execution ?? null, notes },
  };
}
