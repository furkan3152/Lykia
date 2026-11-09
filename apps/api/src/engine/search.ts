/**
 * Route search: from a goal (plan actions) to the best executable route,
 * with the alternatives it beat and why.
 *
 * 1. Enumerate candidate routes over the knowledge graph (core
 *    knowledge.ts): the plan as asked, the best venues pinned one by one,
 *    convert-then-earn when another asset yields more, multi-hop
 *    conversions through an intermediate token, every borrow venue.
 *    Changes are applied one at a time to the plan as asked, so the search
 *    stays small and deterministic (bounded by `maxCandidates`).
 * 2. Prune early: Fence kinds, venues and tokens, venues Lykia cannot
 *    execute here, risk above the owner's appetite, conversions that cannot
 *    win (the target yields no more than the source).
 * 3. Plan every survivor with the real planner (dry run): live quotes,
 *    rates, fees and the Fence verdict (beta cap included). Denied plans
 *    are dropped with the Fence's reasons.
 * 4. Score with one objective, in USD over the horizon: yield − borrow cost
 *    − Lykia fee − gas − slippage − risk penalty − async delay. Ties go to
 *    fewer steps, then fewer signatures.
 * 5. Self-check the winner: its prepared calldata runs in one eth_call
 *    (simulate.ts). A route whose check fails is reported and the next one
 *    is tried.
 */
import {
  assetPaths,
  DEFAULT_FENCE,
  earnableAssets,
  KNOWLEDGE_ROWS,
  riskPenaltyBps,
  RISK_ORDER,
  tokenRoutes,
  usdMicros,
  venueFamily,
  venueKnowledge,
  type ActionAmount,
  type Address,
  type ArcEnvironment,
  type Fence,
  type IntegratorFeePolicy,
  type IntentGraph,
  type IntentStep,
  type PlanAction,
  type RiskTier,
  type StepKind,
} from "@lykia/core";
import type { ArcChains } from "../chains/arc.js";
import { LykiaHttpError } from "../http/errors.js";
import { ADAPTER_VENUE, EXECUTABLE_VENUES, type AdapterId, type StepPlan } from "./adapters.js";
import type { Planner, PlanResult } from "./planner.js";
import type { VenuePrefs, VenueRouter } from "./router.js";
import { simulateRoute, type RouteSimulation } from "./simulate.js";

const SEARCH_DEFAULTS = { maxCandidates: 10, horizonDays: 90, concurrency: 3, checks: 3, candidateTimeoutMs: 20_000 } as const;
/** Gas the Memo / Multicall3From wrapping adds per step. */
const STEP_OVERHEAD_GAS = 60_000;
/** One extra signature or step is worth a cent in the tie-break. */
const STEP_COST_MICROS = 10_000n;
/** Waiting for an async settlement costs a cent per 30 seconds. */
const DELAY_MICROS_PER_SECOND = 333n;

export interface RouteSearchInput {
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  readonly actions: readonly PlanAction[];
  readonly fence?: Fence;
  readonly signer?: "wallet" | "agent";
  readonly agent?: { readonly address: Address; readonly agentId?: string };
  readonly preferences?: VenuePrefs;
  readonly integrator?: IntegratorFeePolicy;
  readonly proposedByAgent?: boolean;
  /** Risk appetite: scales the risk penalty and caps venue risk. Defaults to the profile's maxRisk, then medium. */
  readonly appetite?: RiskTier;
  readonly horizonDays?: number;
  /** Self-check the chosen route with one eth_call (default true). */
  readonly simulate?: boolean;
  readonly maxCandidates?: number;
  readonly source?: string;
  /** USD spent today / this week (IntentService.spent); unknown spend fails the daily caps closed. */
  readonly spent?: { readonly dayUsd: string | null; readonly weekUsd: string | null };
  /** Digest of the compiled program (lykia.program/v1); pinned in every candidate's Fence facts. */
  readonly program?: `sha256:${string}`;
}

export interface RouteScore {
  /** Net value over the horizon, USD; null when something on the route is unpriced. */
  readonly totalUsd: string | null;
  readonly yieldUsd: string;
  readonly borrowCostUsd: string;
  readonly feeUsd: string;
  readonly gasUsd: string;
  readonly slippageUsd: string;
  readonly riskUsd: string;
  readonly delayUsd: string;
  readonly steps: number;
  readonly signatures: number;
  readonly unpriced: boolean;
}

export interface ScoredRoute {
  readonly id: string;
  readonly label: string;
  readonly strategy: "as-asked" | "venue" | "convert-then-earn" | "multi-hop" | "borrow-venue";
  readonly actions: readonly PlanAction[];
  readonly steps: readonly { readonly id: string; readonly kind: StepKind; readonly venue: string; readonly summary: string }[];
  readonly decision: IntentGraph["verdict"]["decision"];
  readonly signable: boolean;
  readonly score: RouteScore;
  readonly explanation: { readonly why: string; readonly steps: readonly string[]; readonly couldFail: readonly string[]; readonly fence: readonly string[]; readonly warnings: readonly string[] };
  readonly simulation?: RouteSimulation;
}

export interface RouteSearchResult {
  readonly environment: ArcEnvironment;
  readonly objective: string;
  readonly best: ScoredRoute | null;
  readonly alternatives: readonly ScoredRoute[];
  readonly considered: number;
  readonly pruned: readonly { readonly label: string; readonly reason: string }[];
  readonly failedChecks: readonly { readonly label: string; readonly reason: string }[];
  readonly tookMs: number;
}

interface Candidate {
  readonly label: string;
  readonly strategy: ScoredRoute["strategy"];
  readonly actions: PlanAction[];
}

interface Evaluated {
  readonly candidate: Candidate;
  readonly result: PlanResult;
  readonly score: RouteScore;
  readonly totalMicros: bigint | null;
}

export interface SearchDeps {
  readonly planner: Planner;
  readonly router: VenueRouter;
  readonly chains: ArcChains;
  readonly now: () => number;
  /** The self-check; defaults to simulateRoute (tests inject failures). */
  readonly simulate?: typeof simulateRoute;
}

const fmt = (micros: bigint) => {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  return `${negative ? "-" : ""}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;
};

const apyFraction = (apy: string | null | undefined): number | null => (apy === null || apy === undefined || apy === "" || Number.isNaN(Number(apy)) ? null : Number(apy));

function riskAllowed(risk: RiskTier, ceiling: RiskTier): boolean {
  return RISK_ORDER.indexOf(risk) <= RISK_ORDER.indexOf(ceiling);
}

function venueAllowedByFence(fence: Fence, venue: string): string | null {
  const family = venueFamily(venue);
  if (family.some((v) => fence.venues?.deny?.includes(v))) return `the Fence denies ${venue}`;
  if (fence.venues?.allow && fence.venues.allow.length > 0 && !family.some((v) => fence.venues!.allow!.includes(v))) return `${venue} is not on the Fence's venue list`;
  return null;
}

function kindsOf(actions: readonly PlanAction[]): StepKind[] {
  return actions.flatMap((a): StepKind[] => {
    switch (a.verb) {
      case "send": return ["transfer"];
      case "fx": return ["fx"];
      case "swap": return ["swap"];
      case "earn": return ["deposit"];
      case "supply": return ["supply"];
      case "withdraw": return ["withdraw"];
      case "borrow": return ["borrow"];
      case "repay": return ["repay"];
      case "bridge": return ["bridge"];
      case "unify": return ["gateway-deposit"];
      default: return [];
    }
  });
}

/** What the static checks say about a candidate before anything is quoted. */
export function staticPrune(candidate: Candidate, fence: Fence, environment: ArcEnvironment, adapterVenues: ReadonlySet<string> = new Set()): string | null {
  const allowKinds = fence.kinds?.allow;
  if (allowKinds && allowKinds.length > 0) {
    for (const kind of kindsOf(candidate.actions)) {
      // The planner names USDC<->EURC swaps "fx"; either is acceptable to a Fence that allows one of them.
      if (!allowKinds.includes(kind) && !((kind === "swap" || kind === "fx") && (allowKinds.includes("swap") || allowKinds.includes("fx")))) return `the Fence does not allow ${kind}`;
    }
  }
  for (const action of candidate.actions) {
    const venue = "venue" in action && typeof action.venue === "string" ? action.venue.split(":")[0]! : null;
    if (venue) {
      const denied = venueAllowedByFence(fence, venue);
      if (denied) return denied;
      if (!EXECUTABLE_VENUES[environment].has(venue) && !adapterVenues.has(venue)) return `Lykia cannot execute ${venue} on Arc ${environment}`;
    }
    const acquired = action.verb === "swap" || action.verb === "fx" ? action.to : null;
    const allowTokens = fence.tokens?.allow;
    if (acquired && allowTokens && allowTokens.length > 0 && !allowTokens.includes(acquired)) return `the Fence does not let the plan acquire ${acquired}`;
  }
  return null;
}

export class RouteSearch {
  constructor(private readonly deps: SearchDeps) {}

  /** Candidate routes, the plan as asked first; deterministic for the same quotes. */
  async candidates(input: RouteSearchInput, appetite: RiskTier): Promise<{ list: Candidate[]; pruned: { label: string; reason: string }[] }> {
    const env = input.environment;
    const base = [...input.actions];
    const list: Candidate[] = [{ label: "As asked", strategy: "as-asked", actions: base }];
    const pruned: { label: string; reason: string }[] = [];
    const earnable = earnableAssets(KNOWLEDGE_ROWS);
    const replace = (index: number, actions: PlanAction[]) => [...base.slice(0, index), ...actions, ...base.slice(index + 1)];
    const bestApy = new Map<string, number | null>();
    const earnOptions = async (symbol: string) => {
      const options = (await this.deps.router.earn(env, symbol).catch(() => [])).filter((c) => c.option.executable !== false && !(input.preferences?.blocked ?? []).includes(c.option.venue));
      const fitting = options.filter((c) => riskAllowed(c.option.risk, appetite));
      for (const c of options) if (!riskAllowed(c.option.risk, appetite)) pruned.push({ label: `Earn ${symbol} on ${c.option.label}`, reason: `risk ${c.option.risk} is above your ${appetite} appetite` });
      const sorted = [...fitting].sort((a, b) => (apyFraction(b.option.apy) ?? -1) - (apyFraction(a.option.apy) ?? -1) || a.option.label.localeCompare(b.option.label));
      bestApy.set(symbol, sorted[0] ? apyFraction(sorted[0].option.apy) : null);
      return sorted;
    };

    for (const [index, action] of base.entries()) {
      if (action.verb === "earn" && !action.venue) {
        const own = await earnOptions(action.token);
        for (const c of own.slice(0, 3)) {
          const pin = c.adapter === "vault-deposit" ? `morpho-vaults:${c.params.vault}` : c.option.venue;
          list.push({ label: `Earn ${action.token} on ${c.option.label}`, strategy: "venue", actions: replace(index, [{ ...action, venue: pin }]) });
        }
        for (const asset of earnable) {
          if (asset === action.token) continue;
          const routes = tokenRoutes(KNOWLEDGE_ROWS, action.token, asset, 2);
          if (routes.length === 0) continue;
          const other = await earnOptions(asset);
          const here = bestApy.get(action.token) ?? null;
          const there = other[0] ? apyFraction(other[0].option.apy) : null;
          if (there === null || (here !== null && there <= here)) {
            pruned.push({ label: `Convert ${action.token} to ${asset} and earn`, reason: there === null ? `no readable ${asset} yield` : `${asset} yields ${(there * 100).toFixed(2)}%, no more than ${action.token}'s ${((here ?? 0) * 100).toFixed(2)}%: converting cannot win` });
            continue;
          }
          const pin = other[0]!.adapter === "vault-deposit" ? `morpho-vaults:${other[0]!.params.vault}` : other[0]!.option.venue;
          const verb = (action.token === "USDC" && asset === "EURC") || (action.token === "EURC" && asset === "USDC") ? "fx" : "swap";
          const convert: PlanAction = verb === "fx" ? { verb: "fx", from: action.token, to: asset, amount: action.amount } : { verb: "swap", from: action.token, to: asset, amount: action.amount };
          list.push({ label: `Convert ${action.token} to ${asset}, then earn on ${other[0]!.option.label}`, strategy: "convert-then-earn", actions: replace(index, [convert, { verb: "earn", token: asset, amount: { previous: true }, venue: pin, ...(action.maxRisk ? { maxRisk: action.maxRisk } : {}) }]) });
        }
      }
      if (action.verb === "borrow" && !action.venue) {
        for (const venue of ["aave-v4", "morpho-blue"]) list.push({ label: `Borrow ${action.token} on ${venueKnowledge(venue)?.venue === "aave-v4" ? "Aave V4" : "Morpho Blue"}`, strategy: "borrow-venue", actions: replace(index, [{ ...action, venue }]) });
      }
      if ((action.verb === "swap" || action.verb === "fx") && !("venue" in action && action.venue)) {
        for (const route of tokenRoutes(KNOWLEDGE_ROWS, action.from, action.to, 2).filter((r) => r.length === 3)) {
          const via = route[1]!;
          const hop = (from: string, to: string, amount: ActionAmount): PlanAction =>
            (from === "USDC" && to === "EURC") || (from === "EURC" && to === "USDC") ? { verb: "fx", from, to, amount } : { verb: "swap", from, to, amount };
          list.push({ label: `${action.from} → ${via} → ${action.to} as two swaps`, strategy: "multi-hop", actions: replace(index, [hop(action.from, via, action.amount), hop(via, action.to, { previous: true })]) });
        }
      }
    }
    return { list, pruned };
  }

  async search(input: RouteSearchInput): Promise<RouteSearchResult> {
    const started = this.deps.now();
    const env = input.environment;
    const fence = input.fence ?? DEFAULT_FENCE;
    const appetite: RiskTier = input.appetite ?? input.preferences?.maxRisk ?? "medium";
    const horizonDays = Math.max(1, Math.min(3650, input.horizonDays ?? SEARCH_DEFAULTS.horizonDays));
    const max = Math.max(1, Math.min(24, input.maxCandidates ?? SEARCH_DEFAULTS.maxCandidates));
    const { list, pruned } = await this.candidates(input, appetite);

    // Routable adapter manifests are executable venues too (integrations/registry.ts).
    const adapterVenues = new Set((await (this.deps.router.adapterManifests?.(env) ?? Promise.resolve([]))).map((m) => m.protocol.id));
    const seen = new Set<string>();
    const queue: Candidate[] = [];
    for (const c of list) {
      const key = JSON.stringify(c.actions);
      if (seen.has(key)) continue;
      seen.add(key);
      const reason = staticPrune(c, fence, env, adapterVenues);
      if (reason) pruned.push({ label: c.label, reason });
      else if (queue.length < max) queue.push(c);
      else pruned.push({ label: c.label, reason: `search bound: only ${max} candidates are planned` });
    }

    const gasPrice = await this.gasPrice(env);
    const evaluated: Evaluated[] = [];
    for (let i = 0; i < queue.length; i += SEARCH_DEFAULTS.concurrency) {
      const batch = queue.slice(i, i + SEARCH_DEFAULTS.concurrency);
      const results = await Promise.all(batch.map((c, j) => this.evaluate(c, input, fence, appetite, horizonDays, gasPrice, `out_search${i + j}x${started.toString(36)}`)));
      results.forEach((r, j) => {
        if ("reason" in r) pruned.push({ label: batch[j]!.label, reason: r.reason });
        else evaluated.push(r);
      });
    }

    // Two candidates that plan to the same steps are one route: keep the first (the plan as asked wins).
    const unique: Evaluated[] = [];
    const planKeys = new Set<string>();
    for (const e of evaluated) {
      const key = e.result.graph.steps.map((st) => `${st.venue}|${st.summary}`).join("||");
      if (planKeys.has(key)) {
        pruned.push({ label: e.candidate.label, reason: "plans to the same steps as an earlier candidate" });
        continue;
      }
      planKeys.add(key);
      unique.push(e);
    }
    const ranked = [...unique].sort(compareEvaluated);
    const failedChecks: { label: string; reason: string }[] = [];
    let best: ScoredRoute | null = null;
    const alternatives: ScoredRoute[] = [];
    let checks = 0;
    for (const e of ranked) {
      if (best === null && input.simulate !== false && checks < SEARCH_DEFAULTS.checks) {
        checks += 1;
        const simulation = await this.selfCheck(e, input);
        if (!simulation.ok) {
          failedChecks.push({ label: e.candidate.label, reason: simulation.reason ?? "the simulation failed" });
          alternatives.push(this.describe(e, ranked, horizonDays, appetite, simulation));
          continue;
        }
        best = this.describe(e, ranked, horizonDays, appetite, simulation);
        continue;
      }
      if (best === null && input.simulate === false) {
        best = this.describe(e, ranked, horizonDays, appetite);
        continue;
      }
      alternatives.push(this.describe(e, ranked, horizonDays, appetite));
    }
    return {
      environment: env,
      objective: `Maximise net USD over ${horizonDays} days: yield − borrow cost − Lykia fee − gas − slippage − risk penalty (${appetite} appetite) − async delay; ties go to fewer steps, then fewer signatures.`,
      best,
      alternatives: alternatives.slice(0, 6),
      considered: list.length,
      pruned,
      failedChecks,
      tookMs: this.deps.now() - started,
    };
  }

  private async gasPrice(environment: ArcEnvironment): Promise<bigint> {
    try {
      if (!this.deps.chains) return 20_000_000_000n;
      const live = await (this.deps.chains.client(environment) as unknown as { getGasPrice?: () => Promise<bigint> }).getGasPrice?.();
      if (typeof live === "bigint" && live > 0n) return live;
    } catch {
      /* floor */
    }
    return 20_000_000_000n;
  }

  private async evaluate(candidate: Candidate, input: RouteSearchInput, fence: Fence, appetite: RiskTier, horizonDays: number, gasPrice: bigint, id: string): Promise<Evaluated | { reason: string }> {
    let result: PlanResult;
    try {
      result = await withTimeout(
        this.deps.planner.plan({
          id,
          environment: input.environment,
          owner: input.owner,
          signer: input.signer ?? "wallet",
          ...(input.agent ? { agent: input.agent } : {}),
          actions: candidate.actions,
          fence,
          source: input.source ?? "route-search",
          now: this.deps.now(),
          spent: input.spent ?? { dayUsd: null, weekUsd: null },
          dryRun: true,
          ...(input.proposedByAgent ? { proposedByAgent: true } : {}),
          ...(input.preferences ? { preferences: input.preferences } : {}),
          ...(input.integrator ? { integrator: input.integrator } : {}),
          ...(input.program ? { program: input.program } : {}),
        }),
        SEARCH_DEFAULTS.candidateTimeoutMs,
      );
    } catch (error) {
      return { reason: error instanceof LykiaHttpError ? error.message : error instanceof Error ? error.message : "planning failed" };
    }
    const verdict = result.graph.verdict;
    if (verdict.decision === "deny") return { reason: `the Fence denies it: ${verdict.reasons.filter((r) => r.decision === "deny").map((r) => r.message).join("; ")}` };
    const score = scoreGraph(result, { horizonDays, appetite, gasPrice });
    return { candidate, result, score, totalMicros: score.totalUsd === null ? null : usdMicros(score.totalUsd) };
  }

  private async selfCheck(e: Evaluated, input: RouteSearchInput): Promise<RouteSimulation> {
    const graph = e.result.graph;
    const account = input.agent?.address ?? input.owner;
    const steps = graph.steps.map((s) => ({ id: s.id, plan: e.result.plans[s.id] as StepPlan }));
    const short = graph.warnings.some((w) => w.startsWith("Dry run:"));
    return (this.deps.simulate ?? simulateRoute)(this.deps.chains, input.environment, account, { intentId: graph.id, verdictDigest: graph.verdict.digest, steps, ...(short ? { fund: externalInputs(graph.steps) } : {}) });
  }

  private describe(e: Evaluated, ranked: readonly Evaluated[], horizonDays: number, appetite: RiskTier, simulation?: RouteSimulation): ScoredRoute {
    const graph = e.result.graph;
    const s = e.score;
    const runnerUp = ranked.find((r) => r !== e);
    const lines: string[] = [];
    if (s.totalUsd === null) lines.push("Part of this route is unpriced, so its value could not be scored; it ranks after priced routes.");
    else lines.push(`Net ${s.totalUsd} USD over ${horizonDays} days: yield ${s.yieldUsd}, borrow cost ${s.borrowCostUsd}, fee ${s.feeUsd}, gas ${s.gasUsd}, slippage ${s.slippageUsd}, risk penalty ${s.riskUsd} (${appetite} appetite).`);
    const yieldM = usdMicros(s.yieldUsd);
    const oneOff = usdMicros(s.feeUsd) + usdMicros(s.gasUsd) + usdMicros(s.slippageUsd);
    const carry = yieldM - usdMicros(s.borrowCostUsd) - usdMicros(s.riskUsd);
    if (carry > 0n && oneOff > 0n) lines.push(`One-off costs (${fmt(oneOff)} USD) are earned back in about ${Math.ceil((Number(oneOff) / Number(carry)) * horizonDays)} days at today's rates.`);
    if (usdMicros(s.borrowCostUsd) > 0n && carry <= 0n) lines.push("The borrow costs more than the position earns at today's rates (negative carry).");
    if (runnerUp && e.totalMicros !== null && runnerUp.totalMicros !== null && e.totalMicros >= runnerUp.totalMicros) lines.push(`Beats “${plannedLabel(runnerUp)}” by ${fmt(e.totalMicros - runnerUp.totalMicros)} USD.`);
    const reasons = graph.steps.map((st) => st.route?.reason).filter((r): r is string => typeof r === "string");
    lines.push(...reasons);
    const couldFail = [...new Set(graph.steps.flatMap((st) => failuresFor(e.result.plans[st.id]?.adapter)))];
    const fenceLines = [`Fence: ${graph.verdict.decision}${graph.verdict.signable ? "" : " (not signable)"}.`, ...graph.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message)];
    return {
      id: graph.id,
      label: plannedLabel(e),
      strategy: e.candidate.strategy,
      actions: e.candidate.actions,
      steps: graph.steps.map((st) => ({ id: st.id, kind: st.kind, venue: st.venue, summary: st.summary })),
      decision: graph.verdict.decision,
      signable: graph.verdict.signable,
      score: s,
      explanation: { why: lines.join(" "), steps: graph.steps.map((st, i) => `${i + 1}. ${st.summary}`), couldFail, fence: fenceLines, warnings: graph.warnings },
      ...(simulation ? { simulation } : {}),
    };
  }
}

/**
 * The one ranking: higher net USD first. Steps already cost a cent each in the
 * net, so only exact ties fall through to fewer steps, fewer signatures, then
 * the label. The route labelled best is always the one with the highest net.
 */
export function compareEvaluated(a: Pick<Evaluated, "totalMicros" | "score" | "candidate">, b: Pick<Evaluated, "totalMicros" | "score" | "candidate">): number {
  if (a.totalMicros === null && b.totalMicros !== null) return 1;
  if (b.totalMicros === null && a.totalMicros !== null) return -1;
  if (a.totalMicros !== null && b.totalMicros !== null && a.totalMicros !== b.totalMicros) return a.totalMicros > b.totalMicros ? -1 : 1;
  return a.score.steps - b.score.steps || a.score.signatures - b.score.signatures || a.candidate.label.localeCompare(b.candidate.label);
}

/** "As asked" says which venues the planner picked, so the label never claims a best it did not score. */
function plannedLabel(e: Evaluated): string {
  if (e.candidate.strategy !== "as-asked") return e.candidate.label;
  const venues = [...new Set(e.result.graph.steps.filter((st) => st.kind !== "approve").map((st) => st.route?.chosen.label ?? st.venue))];
  return venues.length > 0 ? `As asked: ${venues.join(" then ")}` : "As asked";
}

/** The route's inputs that no earlier step produces: what the wallet must hold. */
export function externalInputs(steps: readonly IntentStep[]): { symbol: string; units: bigint }[] {
  const produced = new Map<string, bigint>();
  const need = new Map<string, bigint>();
  for (const step of steps) {
    for (const input of step.inputs) {
      const have = produced.get(input.symbol) ?? 0n;
      const amount = BigInt(input.amount);
      const fromProduced = have >= amount ? amount : have;
      produced.set(input.symbol, have - fromProduced);
      if (amount > fromProduced) need.set(input.symbol, (need.get(input.symbol) ?? 0n) + amount - fromProduced);
    }
    for (const output of step.outputs) if (!output.symbol.includes("@")) produced.set(output.symbol, (produced.get(output.symbol) ?? 0n) + BigInt(output.minimum ?? output.amount));
  }
  return [...need.entries()].map(([symbol, units]) => ({ symbol, units }));
}

export function gasFor(adapter: AdapterId | undefined): number {
  if (!adapter) return STEP_OVERHEAD_GAS;
  const venue = ADAPTER_VENUE[adapter];
  const row = venueKnowledge(venue);
  const cap = row?.capabilities.find((c) => c.adapter === adapter);
  const fnGas = row?.functions.filter((f) => f.adapters.includes(adapter) && f.verb !== "infra").reduce((sum, f) => sum + f.gas, 0) ?? 0;
  return (cap?.gas ?? (fnGas || 150_000)) + STEP_OVERHEAD_GAS;
}

function failuresFor(adapter: AdapterId | undefined): string[] {
  if (!adapter) return [];
  const row = venueKnowledge(ADAPTER_VENUE[adapter]);
  return (row?.functions ?? []).filter((f) => f.adapters.includes(adapter) && f.verb !== "infra").flatMap((f) => f.failures.map((x) => `${row!.venue}: ${x.meaning}`));
}

function delayFor(step: IntentStep): number {
  return step.settlement.kind === "cctp" ? step.settlement.expectedSeconds ?? 30 : 0;
}

/** The objective, from a planned graph. */
export function scoreGraph(result: PlanResult, options: { readonly horizonDays: number; readonly appetite: RiskTier; readonly gasPrice: bigint }): RouteScore {
  let unpriced = false;
  const usd = (value: string | null | undefined): bigint => {
    if (value === null || value === undefined) {
      unpriced = true;
      return 0n;
    }
    return usdMicros(value);
  };
  const yearShare = (micros: bigint, rate: number) => BigInt(Math.round(Number(micros) * rate * (options.horizonDays / 365)));
  let yieldM = 0n;
  let borrowM = 0n;
  let feeM = 0n;
  let gasM = 0n;
  let slipM = 0n;
  let riskM = 0n;
  let delayM = 0n;
  let signatures = 0;
  for (const step of result.graph.steps) {
    const plan = result.plans[step.id];
    const adapter = plan?.adapter;
    signatures += 1;
    gasM += (BigInt(gasFor(adapter)) * options.gasPrice) / 10n ** 12n;
    const fee = step.fee ? usd(step.fee.usd) + (step.fee.integrator ? usd(step.fee.integrator.usd) : 0n) : 0n;
    feeM += fee;
    const chosen = step.route?.chosen;
    const apy = apyFraction(chosen?.apy);
    const tier: RiskTier = chosen?.risk ?? venueKnowledge(step.venue)?.risk.tier ?? "medium";
    if (step.kind === "swap" || step.kind === "fx") {
      const input = step.inputs.reduce((sum, a) => sum + usd(a.usd), 0n);
      const output = step.outputs.reduce((sum, a) => sum + usd(a.usd), 0n);
      const loss = input - fee - output;
      slipM += loss > 0n ? loss : 0n;
    }
    if (step.kind === "deposit" || (step.kind === "supply" && plan?.params.symbol !== "cirBTC")) {
      const amount = step.outputs.reduce((sum, a) => sum + usd(a.usd), 0n);
      if (apy !== null) yieldM += yearShare(amount, apy);
      riskM += yearShare(amount, riskPenaltyBps(tier, options.appetite) / 10_000);
    }
    if (step.kind === "borrow") {
      const debt = step.outputs.reduce((sum, a) => sum + usd(a.usd), 0n) + fee;
      if (apy !== null) borrowM += yearShare(debt, apy);
      riskM += yearShare(debt, riskPenaltyBps(tier, options.appetite) / 10_000);
    }
    delayM += BigInt(delayFor(step)) * DELAY_MICROS_PER_SECOND;
  }
  const stepCost = BigInt(result.graph.steps.length) * STEP_COST_MICROS;
  const total = yieldM - borrowM - feeM - gasM - slipM - riskM - delayM - stepCost;
  return {
    totalUsd: unpriced ? null : fmt(total),
    yieldUsd: fmt(yieldM),
    borrowCostUsd: fmt(borrowM),
    feeUsd: fmt(feeM),
    gasUsd: fmt(gasM),
    slippageUsd: fmt(slipM),
    riskUsd: fmt(riskM),
    delayUsd: fmt(delayM),
    steps: result.graph.steps.length,
    signatures,
    unpriced,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)))]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Paths in the knowledge graph between two assets, for "how could this be done" questions. */
export function knowledgePaths(from: string, to: string, maxHops = 3): { venues: string[]; tokens: string[]; settlement: string }[] {
  return assetPaths(KNOWLEDGE_ROWS, from, to, { verbs: ["swap", "fx", "deposit", "supply", "borrow", "withdraw", "bridge", "gateway-deposit", "transfer"], maxHops, executableOnly: true, limit: 20 }).map((p) => ({
    venues: p.hops.map((h) => `${h.venue} (${h.verb})`),
    tokens: [from, ...p.hops.map((h) => h.to)],
    settlement: p.hops.some((h) => h.settlement === "async") ? `async, ~${p.delaySeconds}s` : "instant",
  }));
}
