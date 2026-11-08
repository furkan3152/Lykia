/**
 * The planner: plan actions -> an intent graph with live reads and quotes,
 * a routed venue per step (with the alternatives it beat and why), the facts
 * the Fence needs, and the Fence verdict.
 *
 * Amount semantics (core/actions.ts): a share ("40%") is a share of the
 * balance the plan starts with, minus what `reserve` actions keep liquid;
 * "all" / "the rest" is what is still spendable at that point. So
 * "40% to the best vault, 20% to EURC, bridge the rest" never double-counts.
 */
import {
  allocationActions,
  DEFAULT_FENCE,
  evaluateFence,
  findCctpDestination,
  fromBaseUnits,
  getToken,
  INTENT_SPEC_VERSION,
  planAllocation,
  portionOf,
  ratioBps,
  toBaseUnitsBig,
  tokenAddress,
  tokensFor,
  venueFamily,
  usdMicrosOf,
  type ActionAmount,
  type Address,
  type ArcEnvironment,
  type Fence,
  type FenceFacts,
  type IntentGraph,
  type IntentStep,
  type PlanAction,
  type RiskTier,
  type RouteChoice,
  type StepAmount,
  type StepFact,
  type TokenFact,
  DEFAULT_FEE_POLICY,
  feeLine,
  feeOf,
  feeBpsFor,
  type StepKind,
  feeUnits,
  type IntegratorFeePolicy,
  validIntegratorFee,
  type FeePolicy,
  type StepFee,
} from "@lykia/core";
import type { ArcChains } from "../chains/arc.js";
import type { FetchLike } from "../health/dependencies.js";
import { LykiaHttpError } from "../http/errors.js";
import { usdValue, type PriceService } from "../arc/prices.js";
import { systemClock } from "../clock.js";
import { ERC4626_ABI, morphoVaults } from "../flock/flock.js";
import { cctpFeeBps, manifestStep, noRoute, stepKindOf, stepVenue, type AdapterId, type StepPlan } from "./adapters.js";
import { quoteRelay } from "./venues/relay.js";
import { PRACTICE_LENDING_ABI } from "./abis.js";
import { forwardedRouteFee } from "../circle/cctp.js";
import { VenueRouter, type Candidate, type VenuePrefs } from "./router.js";
import { legsAllowlisted, ROUTER_LEG_ADAPTERS, type RouterLeg } from "./lykiaRouter.js";
import { aavePositions, aaveSpokes, projectAaveHealth, readAaveAccount, wadToRatio } from "./venues/aave.js";
import { morphoPositions } from "./venues/morphoBlue.js";
import { practiceVenues } from "./venues/practice.js";
import { YieldService } from "./venues/yields.js";

const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_MIN_HEALTH = "1.5";
/** The core tokens every plan reads first; `planTokens` adds every other registry token of the environment. */
const PLAN_TOKENS = ["USDC", "EURC", "cirBTC"] as const;

function planTokens(environment: ArcEnvironment): string[] {
  const rest = tokensFor(environment).map((t) => t.symbol).filter((s) => !(PLAN_TOKENS as readonly string[]).includes(s));
  return [...PLAN_TOKENS, ...rest];
}

export interface PlannerDeps {
  readonly chains: ArcChains;
  readonly prices: PriceService;
  readonly fetch: FetchLike;
  readonly stablefxConfigured: boolean;
  /** Defaults to a router over a fresh YieldService. */
  readonly router?: VenueRouter;
  /** Lykia's protocol fee (LYKIA_FEE_BPS / LYKIA_FEE_RECIPIENT); defaults to 1% to the admin. */
  readonly fee?: FeePolicy;
  /** Mainnet beta cap above every Fence (LYKIA_BETA_CAP_USD); absent = none. */
  readonly beta?: { readonly perStepUsd: string; readonly perDayUsd: string } | null;
}

export interface PlanInput {
  readonly id: string;
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  readonly signer: "wallet" | "agent";
  readonly agent?: { readonly address: Address; readonly agentId?: string };
  readonly actions: readonly PlanAction[];
  readonly fence?: Fence;
  readonly source: string;
  readonly now: number;
  /** USD spent today / this week (from the store); null when unknown. */
  readonly spent: { readonly dayUsd: string | null; readonly weekUsd: string | null };
  readonly proposedByAgent?: boolean;
  /** Dry runs plan past a short balance (with a warning) so a route can be previewed before funding. */
  readonly dryRun?: boolean;
  readonly preferences?: VenuePrefs;
  /** The embedding project's fee, paid to its address beside Lykia's fee (capped at MAX_INTEGRATOR_FEE_BPS). */
  readonly integrator?: IntegratorFeePolicy;
  /** Digest of the compiled program (lykia.program/v1) this plan came from; pinned in the Fence facts. */
  readonly program?: `sha256:${string}`;
}

export interface PlanResult {
  readonly graph: IntentGraph;
  readonly plans: Record<string, StepPlan>;
  readonly facts: FenceFacts;
  readonly fence: Fence;
}

interface Draft {
  readonly adapter: AdapterId;
  readonly fx: boolean;
  readonly summary: string;
  readonly params: Record<string, string>;
  readonly inputs: StepAmount[];
  readonly outputs: StepAmount[];
  readonly fact: Omit<StepFact, "id" | "kind" | "venue">;
  readonly settlement: IntentStep["settlement"];
  readonly warnings: string[];
  readonly route?: RouteChoice;
  readonly fee?: StepFee;
}

interface Ledger {
  readonly env: ArcEnvironment;
  readonly account: Address;
  readonly owner: Address;
  readonly fence: Fence;
  readonly dryRun: boolean;
  readonly start: Map<string, bigint>;
  readonly balances: Map<string, bigint>;
  readonly reserved: Map<string, bigint>;
  readonly prices: Record<string, { usd: string | null }>;
  readonly warnings: string[];
  readonly prefs?: VenuePrefs;
  readonly fee: FeePolicy;
  readonly integrator?: IntegratorFeePolicy;
  readonly intentId: string;
  /** What the last drafted step produced (symbol and units), for `{ previous: true }` amounts. */
  last?: { readonly symbol: string; readonly units: bigint };
}

/** Turns amounts into base units against the ledger and records spends and receipts. */
class Book {
  constructor(readonly l: Ledger) {}

  spendable(symbol: string): bigint {
    const have = this.l.balances.get(symbol) ?? 0n;
    const keep = this.l.reserved.get(symbol) ?? 0n;
    return have > keep ? have - keep : 0n;
  }

  resolve(amount: ActionAmount, symbol: string, decimals: number): bigint {
    if ("exact" in amount) return toBaseUnitsBig(amount.exact, decimals);
    if ("previous" in amount) return this.previous(symbol);
    if ("percent" in amount) {
      const base = (this.l.start.get(symbol) ?? 0n) - (this.l.reserved.get(symbol) ?? 0n);
      return portionOf(base > 0n ? base : 0n, amount.percent * 100);
    }
    return this.spendable(symbol);
  }

  spend(symbol: string, units: bigint, label: string): void {
    const token = getToken(symbol);
    const decimals = token?.decimals ?? 6;
    const available = this.spendable(symbol);
    const kept = this.l.reserved.get(symbol) ?? 0n;
    if (units > 0n && units > available && this.l.dryRun) {
      this.l.warnings.push(`Dry run: ${label} needs ${fromBaseUnits(units, decimals)} ${symbol}; ${fromBaseUnits(available, decimals)} is spendable${kept > 0n ? ` after keeping ${fromBaseUnits(kept, decimals)} liquid` : ""}. Fund the wallet before signing.`);
      this.l.balances.set(symbol, kept);
      return;
    }
    if (units <= 0n) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `Nothing to ${label}: the spendable ${symbol} balance is 0${kept > 0n ? ` (${fromBaseUnits(kept, decimals)} kept liquid)` : ""}.`);
    if (units > available) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `${label} needs ${fromBaseUnits(units, decimals)} ${symbol}; ${this.l.account.slice(0, 6)}…${this.l.account.slice(-4)} has ${fromBaseUnits(available, decimals)} spendable${kept > 0n ? ` (${fromBaseUnits(kept, decimals)} kept liquid)` : ""}.`);
    this.l.balances.set(symbol, (this.l.balances.get(symbol) ?? 0n) - units);
  }

  receive(symbol: string, units: bigint): void {
    this.l.balances.set(symbol, (this.l.balances.get(symbol) ?? 0n) + units);
    this.l.last = { symbol, units };
  }

  /** What the previous step produced, in `symbol`; refuses when it produced something else. */
  previous(symbol: string): bigint {
    const last = this.l.last;
    if (!last) throw new LykiaHttpError("INVALID_ACTIONS", 400, `"It" refers to the previous step's output, but no step before produced ${symbol}.`);
    if (last.symbol !== symbol) throw new LykiaHttpError("INVALID_ACTIONS", 400, `The previous step produced ${last.symbol}, not ${symbol}.`);
    return last.units;
  }

  amount(symbol: string, units: bigint, minimum?: bigint): StepAmount {
    const token = getToken(symbol)!;
    const whole = fromBaseUnits(units, token.decimals);
    return { symbol: token.symbol, token: tokenAddress(token, this.l.env) as Address, decimals: token.decimals, amount: units.toString(), ...(minimum !== undefined ? { minimum: minimum.toString() } : {}), usd: usdValue(whole, this.l.prices[token.symbol]?.usd ?? null) };
  }

  fact(symbol: string, acquired: boolean): TokenFact {
    return { symbol, address: tokenAddress(getToken(symbol)!, this.l.env) as Address, listed: true, acquired };
  }

  display(symbol: string, units: bigint): string {
    return `${fromBaseUnits(units, getToken(symbol)!.decimals)} ${symbol}`;
  }

  /** Lykia's fee on `units` of `symbol`, or undefined when the policy charges nothing. */
  fee(symbol: string, units: bigint, basis: StepFee["basis"], kind?: StepKind): StepFee | undefined {
    // Per-kind schedule (LYKIA_FEE_SCHEDULE); without one this is the base fee, as before.
    const bps = feeBpsFor(kind, this.l.fee.bps, this.l.fee.schedule);
    const amount = feeOf(units, bps);
    const extra = this.l.integrator ? feeOf(units, this.l.integrator.bps) : 0n;
    if (amount === 0n && extra === 0n) return undefined;
    const a = this.amount(symbol, amount);
    const i = this.l.integrator && extra > 0n ? { integrator: { bps: this.l.integrator.bps, recipient: this.l.integrator.recipient, amount: extra.toString(), usd: this.amount(symbol, extra).usd, ...(this.l.integrator.projectId ? { projectId: this.l.integrator.projectId } : {}) } } : {};
    return { bps, recipient: this.l.fee.recipient, symbol: a.symbol, token: a.token, decimals: a.decimals, amount: amount.toString(), usd: a.usd, basis, ...i };
  }
}

/** The plan params that make the adapter add the fee transfer to the step's batch. */
function feeParams(fee: StepFee | undefined, at: "before" | "after" = "before"): Record<string, string> {
  if (!fee) return {};
  const app: Record<string, string> = fee.integrator ? { appFeeAmount: fee.integrator.amount, appFeeRecipient: fee.integrator.recipient } : {};
  return { feeAmount: fee.amount, feeToken: fee.token, feeRecipient: fee.recipient, feeAt: at, feeLabel: feeLine(fee), ...app };
}

/** A valid integrator policy for the ledger, or nothing (zero bps, bad recipient or above the cap). */
function integratorOf(policy: IntegratorFeePolicy | undefined): { integrator?: IntegratorFeePolicy } {
  if (!policy || policy.bps <= 0 || !validIntegratorFee(policy)) return {};
  return { integrator: policy };
}

/** The Fence fact for a fee; `usd` of the step already includes it. */
function feeFact(fee: StepFee | undefined): { fee?: { line: string; usd: string | null } } {
  return fee ? { fee: { line: feeLine(fee), usd: fee.usd } } : {};
}


export class Planner {
  readonly router: VenueRouter;

  constructor(private readonly deps: PlannerDeps) {
    this.router = deps.router ?? new VenueRouter({ chains: deps.chains, prices: deps.prices, fetch: deps.fetch, yields: new YieldService({ fetch: deps.fetch, clock: systemClock }) });
  }

  async plan(input: PlanInput): Promise<PlanResult> {
    const env = input.environment;
    const account = input.agent?.address ?? input.owner;
    const client = this.deps.chains.client(env);
    const fence = input.fence ?? DEFAULT_FENCE;
    // Every registry token in this environment, so any of them can be sent, swapped or kept.
    const symbols = planTokens(env);
    const reads = await client.multicall({
      contracts: symbols.map((s) => ({ address: tokenAddress(getToken(s)!, env) as Address, abi: ERC4626_ABI, functionName: "balanceOf", args: [account] }) as const),
      allowFailure: true,
    });
    const start = new Map<string, bigint>();
    symbols.forEach((s, i) => start.set(s, reads[i]?.status === "success" ? (reads[i].result as bigint) : 0n));
    const prices = await this.deps.prices.prices(symbols);
    const ledger: Ledger = { env, account, owner: input.owner, fence, dryRun: input.dryRun === true, start, balances: new Map(start), reserved: new Map(), prices, warnings: [], fee: this.deps.fee ?? DEFAULT_FEE_POLICY, intentId: input.id, ...(input.preferences ? { prefs: input.preferences } : {}), ...integratorOf(input.integrator) };
    const book = new Book(ledger);

    // Reserves apply to the whole plan, wherever they appear in the sentence.
    for (const action of input.actions) {
      if (action.verb !== "reserve") continue;
      const token = getToken(action.token)!;
      const units = "exact" in action.amount ? toBaseUnitsBig(action.amount.exact, token.decimals) : "percent" in action.amount ? portionOf(start.get(token.symbol) ?? 0n, action.amount.percent * 100) : start.get(token.symbol) ?? 0n;
      ledger.reserved.set(token.symbol, (ledger.reserved.get(token.symbol) ?? 0n) + units);
      ledger.warnings.push(`Keeping ${book.display(token.symbol, units)} liquid${action.reason ? ` (${action.reason})` : ""}; shares and "the rest" are taken from what is left.`);
    }

    const actions: PlanAction[] = [];
    for (const action of input.actions) {
      if (action.verb === "reserve") continue;
      if (action.verb === "rebalance") actions.push(...this.expandRebalance(action, book));
      else actions.push(action);
    }
    if (actions.length === 0) throw new LykiaHttpError("NO_ROUTE", 422, "Nothing to do: the flock is already where you want it.");

    const drafts: Draft[] = [];
    for (const action of actions) {
      const before = ledger.last;
      drafts.push(...(await this.draft(action, book)));
      // A step that produced nothing (a send, a bridge) leaves nothing for "it" to refer to.
      if (ledger.last === before) delete ledger.last;
    }

    const plans: Record<string, StepPlan> = {};
    const steps: IntentStep[] = drafts.map((d, i) => {
      const id = `s${i + 1}`;
      plans[id] = { adapter: d.adapter, params: d.params };
      return {
        id,
        kind: d.adapter === "manifest" ? manifestStep(d.params, d.fx).kind : stepKindOf(d.adapter, d.fx),
        venue: d.adapter === "manifest" ? manifestStep(d.params, d.fx).venue : stepVenue(d.adapter, d.params),
        summary: d.summary,
        signer: input.signer,
        account,
        dependsOn: i === 0 ? [] : [`s${i}`],
        inputs: d.inputs,
        outputs: d.outputs,
        settlement: d.settlement,
        ...(d.route ? { route: d.route } : {}),
        ...(d.fee ? { fee: d.fee } : {}),
        status: i === 0 ? "ready" : "blocked",
      };
    });
    const facts: FenceFacts = {
      environment: env,
      signer: input.signer,
      owner: input.owner,
      ...(input.proposedByAgent ? { proposedByAgent: true } : {}),
      steps: steps.map((s, i) => ({ id: s.id, kind: s.kind, venue: s.venue, ...(drafts[i] as Draft).fact })),
      spent: input.spent,
      now: input.now,
      ...(input.program ? { program: input.program } : {}),
    };
    const verdict = evaluateFence(fence, facts, this.deps.beta ? { beta: this.deps.beta } : {});
    const graph: IntentGraph = {
      spec: INTENT_SPEC_VERSION,
      id: input.id,
      environment: env,
      createdAt: new Date(input.now).toISOString(),
      source: input.source,
      owner: input.owner,
      ...(input.agent ? { agent: input.agent } : {}),
      steps,
      verdict,
      warnings: [...ledger.warnings, ...drafts.flatMap((d) => d.warnings)],
    };
    return { graph, plans, facts, fence };
  }

  /** Target weights -> the fewest fx/swap actions (USD values from Chainlink). */
  private expandRebalance(action: Extract<PlanAction, { verb: "rebalance" }>, book: Book): PlanAction[] {
    const holdings = action.targets.map((t) => {
      const token = getToken(t.token)!;
      return { symbol: token.symbol, units: book.spendable(token.symbol), decimals: token.decimals, usd: book.l.prices[token.symbol]?.usd ?? null };
    });
    const plan = planAllocation(holdings, action.targets.map((t) => ({ token: getToken(t.token)!.symbol, weightBps: t.weightBps })), action.toleranceBps ?? 100);
    if (plan.unpriced.length > 0) throw new LykiaHttpError("UNPRICED", 422, `Cannot rebalance without a price for ${plan.unpriced.join(", ")}.`);
    const now = plan.current.map((c) => `${c.symbol} ${(c.weightBps / 100).toFixed(1)}%`).join(", ");
    const want = action.targets.map((t) => `${getToken(t.token)!.symbol} ${(t.weightBps / 100).toFixed(1)}%`).join(", ");
    book.l.warnings.push(plan.balanced ? `Already balanced (${now}); target ${want}.` : `Rebalance: now ${now}; target ${want}.`);
    return allocationActions(plan, (s) => getToken(s)!.decimals);
  }

  private async draft(action: PlanAction, book: Book): Promise<Draft[]> {
    const { env } = book.l;
    switch (action.verb) {
      case "send": {
        const token = getToken(action.token)!;
        const resolved = book.resolve(action.amount, token.symbol, token.decimals);
        // An exact send reaches the recipient in full and pays the fee on top; a share or "all" pays it from the amount.
        const onTop = "exact" in action.amount;
        const fee = book.fee(token.symbol, resolved, onTop ? "on-top" : "input", "transfer");
        const feePaid = feeUnits(fee);
        const units = onTop ? resolved : resolved - feePaid;
        book.spend(token.symbol, units + feePaid, "send");
        const amount = book.amount(token.symbol, units);
        const gross = book.amount(token.symbol, units + feePaid);
        const display = book.display(token.symbol, units);
        return [{
          adapter: "transfer",
          fx: false,
          summary: `Send ${display} to ${action.to}${action.memo ? ` (${action.memo})` : ""}`,
          params: { token: amount.token, amount: units.toString(), to: action.to, display, decimals: String(token.decimals), ...(action.memo ? { note: action.memo } : {}), ...feeParams(fee) },
          inputs: [gross],
          outputs: [],
          fee,
          fact: { usd: gross.usd, tokens: [book.fact(token.symbol, false)], recipient: action.to, ...feeFact(fee) },
          settlement: { kind: "receipt" },
          warnings: [],
        }];
      }
      case "bridge": {
        const dest = findCctpDestination(action.destination);
        if (!dest) throw noRoute(`${action.destination} is not a CCTP destination.`);
        if (dest.vm !== "evm") throw noRoute(`${dest.name} needs a token account as the mint recipient; Lykia bridges to EVM chains for now.`);
        const recipient = (action.recipient as Address | undefined) ?? book.l.owner;
        if (!/^0x[0-9a-fA-F]{40}$/u.test(recipient)) throw new LykiaHttpError("INVALID_ACTIONS", 400, "recipient must be an EVM address.");
        const gross = book.resolve(action.amount, "USDC", 6);
        book.spend("USDC", gross, "bridge");
        const fee = book.fee("USDC", gross, "input", "bridge");
        const units = gross - feeUnits(fee);
        const warnings: string[] = [];
        // Circle's Forwarding Service mints on the destination (no gas needed there); maxFee then covers its fee.
        const forwarded = dest.forwarding ? await forwardedRouteFee(this.deps.fetch, env, dest.domain, units) : null;
        const feeBps = forwarded ? null : await cctpFeeBps(this.deps.fetch, env, dest.domain);
        if (!forwarded) warnings.push(`Circle's forwarding fee could not be read, so the mint on ${dest.name} is not forwarded: after attestation, call receiveMessage on ${dest.name} (GET /v1/intents/:id/steps/:sid/attestation).`);
        if (!forwarded && feeBps === null) warnings.push("The CCTP fee could not be read; the burn allows no fee (standard transfer).");
        const maxFee = forwarded ? forwarded.maxFee : feeBps ? (units * BigInt(Math.ceil(feeBps * 100)) + 999_999n) / 1_000_000n : 0n;
        const amount = book.amount("USDC", units);
        const display = book.display("USDC", units);
        // Relay (intent bridge, mainnet) is quoted beside CCTP: it wins only by delivering more, or when named.
        const named = action.venue?.split(":")[0];
        const chainId = dest.chainIds[env];
        const relay = env === "mainnet" && chainId !== null && named !== "cctp" && units > 0n ? await quoteRelay(this.deps.fetch, env, { user: book.l.account, recipient: recipient as Address, usdc: amount.token as Address, amount: units, destinationChainId: chainId }) : null;
        if (named === "relay" && !relay) throw noRoute(`Relay did not quote ${display} to ${dest.name}.`);
        const cctpOk = maxFee < units;
        const cctpOption = { venue: "cctp", label: `CCTP to ${dest.name}`, amountOut: (cctpOk ? units - maxFee : 0n).toString(), netAmountOut: (cctpOk ? units - maxFee : 0n).toString(), risk: "low" as const, executable: cctpOk, notes: [forwarded ? "Burn and mint; Circle forwards the mint." : "Burn and mint after Circle's attestation."] };
        const relayOption = relay ? { venue: "relay", label: `Relay to ${dest.name}`, amountOut: relay.amountOut.toString(), netAmountOut: relay.amountOut.toString(), risk: "medium" as const, executable: true, notes: ["Cross-chain: a Relay solver delivers on the destination chain; unfilled deposits are refunded on Arc.", `Relay's fee ${book.display("USDC", relay.feeUnits)}.`] } : null;
        const useRelay = relay !== null && (named === "relay" || !cctpOk || relay.amountOut > units - maxFee);
        if (!useRelay && !cctpOk) throw noRoute(`Bridging ${display} costs at least ${book.display("USDC", maxFee)} in CCTP fees; send more.`);
        if (useRelay && relay && relayOption) {
          const minOut = (relay.amountOut * BigInt(10_000 - DEFAULT_SLIPPAGE_BPS)) / 10_000n;
          const reason = named === "relay" ? `You named Relay; it delivers ${book.display("USDC", relay.amountOut)} on ${dest.name}.` : `Relay delivers ${book.display("USDC", relay.amountOut)} on ${dest.name}, more than CCTP's ${cctpOk ? book.display("USDC", units - maxFee) : "nothing (fee above the amount)"}.`;
          return [{
            adapter: "bridge-relay",
            fx: false,
            summary: `Bridge ${display} to ${dest.name} over Relay (cross-chain: delivered on ${dest.name}, min ${fromBaseUnits(minOut, 6)} USDC)`,
            params: { token: amount.token, amount: units.toString(), recipient, chainId: String(chainId), minOut: minOut.toString(), destinationName: dest.name, destination: dest.key, display, decimals: "6", ...feeParams(fee) },
            inputs: [book.amount("USDC", gross)],
            outputs: [{ ...book.amount("USDC", relay.amountOut, minOut), symbol: `USDC@${dest.key}` }],
            fee,
            fact: { usd: book.amount("USDC", gross).usd, tokens: [book.fact("USDC", false)], recipient, destination: dest.key, ...feeFact(fee) },
            settlement: { kind: "receipt" },
            warnings: [`Cross-chain: Relay's solver delivers on ${dest.name}${relay.timeEstimateSeconds !== null ? ` in about ${relay.timeEstimateSeconds} s` : ""}; if it does not fill, Relay refunds the USDC on Arc.`],
            route: { chosen: relayOption, alternatives: [cctpOption], reason },
          }];
        }
        const route = relayOption ? { chosen: cctpOption, alternatives: [relayOption], reason: `CCTP delivers ${book.display("USDC", units - maxFee)} on ${dest.name}, at least as much as Relay's ${book.display("USDC", BigInt(relayOption.amountOut))}; CCTP stays the default for USDC.` } : undefined;
        return [{
          adapter: "bridge",
          fx: false,
          summary: `Bridge ${display} to ${dest.name} over CCTP${forwarded ? " (Circle forwards the mint)" : ""}`,
          params: { token: amount.token, amount: units.toString(), domain: String(dest.domain), recipient, maxFee: maxFee.toString(), destinationName: dest.name, destination: dest.key, display, decimals: "6", ...(forwarded ? { forward: "1" } : {}), ...feeParams(fee) },
          inputs: [book.amount("USDC", gross)],
          outputs: [{ ...book.amount("USDC", units - maxFee), symbol: `USDC@${dest.key}` }],
          fee,
          fact: { usd: book.amount("USDC", gross).usd, tokens: [book.fact("USDC", false)], recipient, destination: dest.key, ...feeFact(fee) },
          settlement: { kind: "cctp", destination: dest.key, expectedSeconds: 30 },
          warnings,
          ...(route ? { route } : {}),
        }];
      }
      case "unify": {
        const gross = book.resolve(action.amount, "USDC", 6);
        book.spend("USDC", gross, "deposit into Gateway");
        const fee = book.fee("USDC", gross, "input", "gateway-deposit");
        const units = gross - feeUnits(fee);
        const amount = book.amount("USDC", units);
        const display = book.display("USDC", units);
        return [{
          adapter: "gateway",
          fx: false,
          summary: `Deposit ${display} into Circle Gateway (one balance on every Gateway chain)`,
          params: { token: amount.token, amount: units.toString(), display, decimals: "6", ...feeParams(fee) },
          inputs: [book.amount("USDC", gross)],
          outputs: [{ ...amount, symbol: "USDC@gateway" }],
          fee,
          fact: { usd: book.amount("USDC", gross).usd, tokens: [book.fact("USDC", false)], ...feeFact(fee) },
          settlement: { kind: "gateway", destination: "gateway", expectedSeconds: 1 },
          warnings: [],
        }];
      }
      case "earn":
        return [await this.draftEarn(action.token, action.amount, book, action.venue, action.maxRisk)];
      case "supply": {
        const token = getToken(action.token)!;
        if (token.symbol !== "cirBTC") return [await this.draftEarn(token.symbol, action.amount, book, action.venue ?? "aave-v4", "high")];
        const spoke = aaveSpokes(env).find((s) => s.key === "main");
        if (!spoke) throw noRoute(env === "testnet" ? "Supplying cirBTC alone has no testnet venue; borrow against it to post it on Lykia Practice Lending." : "Aave V4 is not on this environment.");
        const gross = book.resolve(action.amount, token.symbol, token.decimals);
        book.spend(token.symbol, gross, "supply");
        const fee = book.fee(token.symbol, gross, "input", "supply");
        const units = gross - feeUnits(fee);
        const amount = book.amount(token.symbol, units);
        const display = book.display(token.symbol, units);
        return [{
          adapter: "aave-supply",
          fx: false,
          summary: `Supply ${display} to ${spoke.label}`,
          params: { spoke: spoke.address, spokeName: spoke.label, reserveId: "2", token: amount.token, symbol: token.symbol, amount: units.toString(), display, decimals: String(token.decimals), ...feeParams(fee) },
          inputs: [book.amount(token.symbol, gross)],
          outputs: [{ ...amount, symbol: `${token.symbol}@aave-v4` }],
          fee,
          fact: { usd: book.amount(token.symbol, gross).usd, tokens: [book.fact(token.symbol, false)], ...feeFact(fee) },
          settlement: { kind: "receipt" },
          warnings: ["Supplied cirBTC earns little on its own; enable it as collateral when you borrow."],
        }];
      }
      case "withdraw":
        return [await this.draftWithdraw(action, book)];
      case "borrow":
        return [await this.draftBorrow(action, book)];
      case "repay":
        return [await this.draftRepay(action, book)];
      case "fx":
      case "swap":
        return this.draftSwap(action, book);
      case "reserve":
      case "rebalance":
        return [];
    }
  }

  private async draftEarn(symbol: string, amountSpec: ActionAmount, book: Book, venue?: string, maxRisk?: RiskTier): Promise<Draft> {
    const { env } = book.l;
    const token = getToken(symbol)!;
    if (token.symbol !== "USDC" && token.symbol !== "EURC") throw noRoute("Earn takes USDC or EURC on Arc.");
    const candidates = await this.router.earn(env, token.symbol);
    const choice = this.router.chooseEarn(candidates, maxRisk ?? book.l.prefs?.maxRisk ?? "medium", venue, book.l.prefs);
    if (!choice) throw noRoute(env === "testnet" ? "No earn venue on Arc testnet yet: the Lykia practice vault is not deployed (Morpho and Aave are mainnet only)." : `No ${token.symbol} earn venue answered.`);
    const gross = book.resolve(amountSpec, token.symbol, token.decimals);
    book.spend(token.symbol, gross, "deposit");
    const fee = book.fee(token.symbol, gross, "input", "deposit");
    const units = gross - feeUnits(fee);
    const amount = book.amount(token.symbol, units);
    const display = book.display(token.symbol, units);
    const c: Candidate = choice.candidate;
    const where = c.adapter === "aave-supply" ? c.params.spokeName : c.params.vaultName;
    return {
      adapter: c.adapter as AdapterId,
      fx: false,
      summary: `Deposit ${display} into ${where}`,
      params: { ...c.params, amount: units.toString(), display, ...feeParams(fee) },
      inputs: [book.amount(token.symbol, gross)],
      outputs: [{ ...amount, symbol: `${token.symbol}@${c.option.venue}` }],
      fee,
      fact: { usd: book.amount(token.symbol, gross).usd, tokens: [book.fact(token.symbol, false)], ...feeFact(fee) },
      settlement: { kind: "receipt" },
      warnings: [],
      route: choice.route,
    };
  }

  private async draftWithdraw(action: Extract<PlanAction, { verb: "withdraw" }>, book: Book): Promise<Draft> {
    const { env, account } = book.l;
    const token = getToken(action.token)!;
    const client = this.deps.chains.client(env);
    type Held = { venue: string; label: string; max: bigint; adapter: AdapterId; params: Record<string, string>; healthAfter?: (units: bigint) => Promise<string | null | undefined> };
    const held: Held[] = [];
    const vaults = morphoVaults(env).filter((v) => v.asset === token.symbol);
    const practice = await practiceVenues(env);
    const practiceVault = token.symbol === "USDC" ? practice.vaultUsdc : token.symbol === "EURC" ? practice.vaultEurc : null;
    const vaultList = [...vaults.map((v) => ({ ...v, practice: false })), ...(practiceVault ? [{ id: `Lykia Practice Vault ${token.symbol}`, address: practiceVault, asset: token.symbol, practice: true }] : [])];
    if (vaultList.length > 0) {
      const reads = await client.multicall({ contracts: vaultList.map((v) => ({ address: v.address, abi: ERC4626_ABI, functionName: "maxWithdraw", args: [account] }) as const), allowFailure: true });
      vaultList.forEach((v, i) => {
        const max = reads[i]?.status === "success" ? (reads[i].result as bigint) : 0n;
        const curator = "curator" in v ? v.curator : undefined;
        if (max > 0n) held.push({ venue: v.practice ? "lykia-practice" : (curator?.id ?? "morpho-vaults"), label: v.practice ? v.id : `Morpho ${v.id}`, max, adapter: v.practice ? "practice-vault-withdraw" : "vault-withdraw", params: { vault: v.address, vaultName: v.practice ? v.id : `Morpho ${v.id}`, ...(curator ? { venue: curator.id } : {}) } });
      });
    }
    try {
      for (const p of await aavePositions(this.deps.chains, env, account)) {
        if (p.reserve.symbol !== token.symbol || p.supplied === 0n) continue;
        const spoke = p.spoke;
        const cf = p.reserve.collateralFactorBps;
        held.push({
          venue: "aave-v4",
          label: spoke.label,
          max: p.supplied,
          adapter: "aave-withdraw",
          params: { spoke: spoke.address, spokeName: spoke.label, reserveId: String(p.reserve.reserveId) },
          healthAfter: cf === 0 ? undefined : async (units) => {
            const acct = await readAaveAccount(this.deps.chains, env, spoke.address, account);
            const price = book.l.prices[token.symbol]?.usd ?? null;
            if (!acct || price === null) return null;
            if (acct.debtValueRay === 0n) return undefined;
            return wadToRatio(projectAaveHealth(acct, -usdMicrosOf(units, token.decimals, price), cf, 0n));
          },
        });
      }
    } catch {
      /* no Aave on this environment */
    }
    // Positions at routable adapter manifests (integrations/runtime.ts), read through their position function.
    for (const m of await this.router.adapterPositions(env, token.symbol, account)) held.push({ venue: m.venue, label: m.label, max: m.max, adapter: "manifest", params: m.params });
    if (held.length === 0) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `No ${token.symbol} position to withdraw from on Arc ${env}.`);
    const [venueId, name] = (action.venue ?? "").split(":");
    const named = action.venue ? held.find((h) => venueFamily(h.venue).includes(venueId!) && (!name || h.label.toLowerCase().replace(/\s+/gu, "").includes(name.toLowerCase().replace(/usdc|eurc/gu, "")))) : undefined;
    const pick = named ?? [...held].sort((a, b) => (b.max > a.max ? 1 : -1))[0]!;
    const all = "all" in action.amount;
    const units = all ? pick.max : "percent" in action.amount ? portionOf(pick.max, action.amount.percent * 100) : toBaseUnitsBig((action.amount as { exact: string }).exact, token.decimals);
    if (units > pick.max) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `${pick.label} holds ${book.display(token.symbol, pick.max)} for you.`);
    let shares = "0";
    if (all && (pick.adapter === "vault-withdraw" || pick.adapter === "practice-vault-withdraw")) shares = (await client.readContract({ address: pick.params.vault as Address, abi: ERC4626_ABI, functionName: "balanceOf", args: [account] })).toString();
    book.receive(token.symbol, units);
    const amount = book.amount(token.symbol, units);
    const display = book.display(token.symbol, units);
    const health = pick.healthAfter ? await pick.healthAfter(units) : undefined;
    return {
      adapter: pick.adapter,
      fx: false,
      summary: `Withdraw ${display} from ${pick.label}`,
      params: { ...pick.params, mode: all ? (pick.adapter === "aave-withdraw" ? "all" : "redeem") : "withdraw", amount: units.toString(), shares, display, decimals: String(token.decimals), symbol: token.symbol },
      inputs: [],
      outputs: [amount],
      fact: { usd: amount.usd, tokens: [book.fact(token.symbol, true)], recipient: account, ...(health !== undefined ? { healthFactorAfter: health } : {}) },
      settlement: { kind: "receipt" },
      warnings: held.length > 1 && !named ? [`Withdrawing from ${pick.label}, your largest ${token.symbol} position; name a venue to pick another.`] : [],
    };
  }

  private async draftBorrow(action: Extract<PlanAction, { verb: "borrow" }>, book: Book): Promise<Draft> {
    const { env, account, fence } = book.l;
    const loan = getToken(action.token)!;
    if (loan.symbol !== "USDC" && loan.symbol !== "EURC") throw noRoute("Lykia borrows USDC or EURC on Arc.");
    const coll = getToken(action.collateral?.token ?? "cirBTC")!;
    if (coll.symbol !== "cirBTC") throw noRoute("cirBTC is the collateral Lykia posts on Arc for now.");
    const minHealth = action.minHealth ?? (fence.lending?.minHealthFactor && ratioBps(fence.lending.minHealthFactor) > ratioBps(DEFAULT_MIN_HEALTH) ? fence.lending.minHealthFactor : DEFAULT_MIN_HEALTH);
    const amountUnits = "exact" in action.amount ? toBaseUnitsBig(action.amount.exact, loan.decimals) : null;
    if (amountUnits === null || amountUnits <= 0n) throw new LykiaHttpError("INVALID_ACTIONS", 400, "Say how much to borrow as an exact amount (e.g. 1000 USDC).");
    const wallet = book.spendable(coll.symbol);
    const collateralUnits = action.collateral?.amount ? book.resolve(action.collateral.amount, coll.symbol, coll.decimals) : null;
    const minHealthWad = ratioBps(minHealth) * 10n ** 14n;
    const candidates = await this.router.borrow(env, { loan: loan.symbol, amount: amountUnits, collateral: coll.symbol, collateralUnits, walletCollateral: book.l.dryRun && wallet === 0n ? 10n ** 30n : wallet, minHealthWad, account });
    if (candidates.length === 0) throw noRoute(env === "testnet" ? "No borrow venue on Arc testnet yet: Lykia Practice Lending is not deployed (Aave V4 and Morpho Blue are mainnet only)." : `No ${loan.symbol} market against ${coll.symbol} answered.`);
    const choice = this.router.chooseBorrow(candidates, minHealth, action.venue, book.l.prefs);
    if (!choice) {
      const best = candidates.map((c) => `${c.option.label}: health ${c.healthFactor ?? "unknown"}`).join("; ");
      throw new LykiaHttpError("NO_ROUTE", 422, `No venue keeps the health factor at ${minHealth} or above for this borrow (${best}). Post more ${coll.symbol} or borrow less.`, { alternatives: candidates.map((c) => c.option) });
    }
    const c = choice.candidate;
    if (c.collateralUnits > 0n) book.spend(coll.symbol, c.collateralUnits, "post collateral");
    // The fee comes out of the borrowed amount, right after the borrow, in the same transaction.
    const fee = book.fee(loan.symbol, amountUnits, "output", "borrow");
    book.receive(loan.symbol, amountUnits - feeUnits(fee));
    const debt = book.amount(loan.symbol, amountUnits);
    const display = book.display(loan.symbol, amountUnits);
    const collText = c.collateralUnits > 0n ? `post ${book.display(coll.symbol, c.collateralUnits)} and ` : "";
    return {
      adapter: c.adapter as AdapterId,
      fx: false,
      summary: `On ${c.option.label}: ${collText}borrow ${display} (health factor ${c.healthFactor ?? "unknown"} after, floor ${minHealth})`,
      params: { ...c.params, amount: amountUnits.toString(), collateral: c.collateralUnits.toString(), display, minHealth, ...feeParams(fee, "after") },
      inputs: c.collateralUnits > 0n ? [book.amount(coll.symbol, c.collateralUnits)] : [],
      outputs: [book.amount(loan.symbol, amountUnits - feeUnits(fee))],
      fee,
      fact: { usd: debt.usd, tokens: [book.fact(loan.symbol, true), ...(c.collateralUnits > 0n ? [book.fact(coll.symbol, false)] : [])], healthFactorAfter: c.healthFactor, ...feeFact(fee) },
      settlement: { kind: "receipt" },
      warnings: action.minHealth && fence.lending?.minHealthFactor && ratioBps(action.minHealth) < ratioBps(fence.lending.minHealthFactor) ? [`You asked for health ${action.minHealth}; the Fence floor is ${fence.lending.minHealthFactor} and still applies.`] : [],
      route: choice.route,
    };
  }

  private async draftRepay(action: Extract<PlanAction, { verb: "repay" }>, book: Book): Promise<Draft> {
    const { env, account } = book.l;
    const token = getToken(action.token)!;
    type Debt = { venue: string; label: string; debt: bigint; adapter: AdapterId; params: Record<string, string> };
    const debts: Debt[] = [];
    try {
      for (const p of await aavePositions(this.deps.chains, env, account)) if (p.reserve.symbol === token.symbol && p.debt > 0n) debts.push({ venue: "aave-v4", label: p.spoke.label, debt: p.debt, adapter: "aave-repay", params: { spoke: p.spoke.address, spokeName: p.spoke.label, reserveId: String(p.reserve.reserveId) } });
    } catch {
      /* no Aave here */
    }
    try {
      for (const { market, position } of await morphoPositions(this.deps.chains, env, account)) if (market.loan === token.symbol && position.borrowAssets > 0n) debts.push({ venue: "morpho-blue", label: market.label, debt: position.borrowAssets, adapter: "morpho-repay", params: { market: market.id } });
    } catch {
      /* no Morpho here */
    }
    const practice = await practiceVenues(env);
    if (practice.lending && token.symbol === "USDC") {
      try {
        const debt = await this.deps.chains.client(env).readContract({ address: practice.lending, abi: PRACTICE_LENDING_ABI, functionName: "debtOf", args: [account] });
        if (debt > 0n) debts.push({ venue: "lykia-practice", label: "Lykia Practice Lending", debt, adapter: "practice-repay", params: { pool: practice.lending } });
      } catch {
        /* unreadable */
      }
    }
    if (debts.length === 0) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `No ${token.symbol} debt to repay on Arc ${env}.`);
    const named = action.venue ? debts.find((d) => d.venue === action.venue!.split(":")[0]) : undefined;
    const pick = named ?? [...debts].sort((a, b) => (b.debt > a.debt ? 1 : -1))[0]!;
    const all = "all" in action.amount;
    const units = all ? pick.debt : "percent" in action.amount ? portionOf(pick.debt, action.amount.percent * 100) : toBaseUnitsBig((action.amount as { exact: string }).exact, token.decimals);
    const capped = units > pick.debt ? pick.debt : units;
    book.spend(token.symbol, all ? capped + capped / 1000n : capped, "repay");
    const amount = book.amount(token.symbol, capped);
    const display = book.display(token.symbol, capped);
    return {
      adapter: pick.adapter,
      fx: false,
      summary: `Repay ${all ? "all " : ""}${display} on ${pick.label}`,
      params: { ...pick.params, token: amount.token, symbol: token.symbol, amount: capped.toString(), mode: all ? "all" : "exact", display, decimals: String(token.decimals) },
      inputs: [amount],
      outputs: [],
      fact: { usd: amount.usd, tokens: [book.fact(token.symbol, false)] },
      settlement: { kind: "receipt" },
      warnings: all ? ["Interest accrues every second: the approval leaves 0.1% headroom and the repay clears the debt exactly."] : [],
    };
  }

  private async draftSwap(action: Extract<PlanAction, { verb: "fx" | "swap" }>, book: Book): Promise<Draft[]> {
    const { env } = book.l;
    const from = getToken(action.from)!;
    const to = getToken(action.to)!;
    const isFx = (from.symbol === "USDC" && to.symbol === "EURC") || (from.symbol === "EURC" && to.symbol === "USDC");
    const gross = book.resolve(action.amount, from.symbol, from.decimals);
    if (gross <= 0n && !book.l.dryRun) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `Nothing to ${action.verb}: the spendable ${from.symbol} balance is 0.`);
    // The fee leaves the input first; every venue is quoted on the same net amount, so the comparison is fair.
    const fee = book.fee(from.symbol, gross, "input", isFx ? "fx" : "swap");
    const units = gross - feeUnits(fee);
    const best = await this.router.bestSwap(env, from.symbol, to.symbol, units > 0n ? units : 10n ** BigInt(from.decimals), book.l.prefs);
    if (!best) throw noRoute(env === "testnet" ? `No ${isFx ? "FX" : "swap"} venue on Arc testnet yet: the Lykia practice swap is not deployed (Uniswap is mainnet only).` : `No venue on Arc quotes ${from.symbol} -> ${to.symbol}.`);
    book.spend(from.symbol, gross, action.verb);
    // An explicit slippage is kept as asked (the Fence then judges it); the default never exceeds the Fence's ceiling.
    const fenceMax = book.l.fence.limits?.maxSlippageBps;
    const slippageBps = action.verb === "swap" && action.slippageBps !== undefined ? action.slippageBps : fenceMax !== undefined ? Math.min(DEFAULT_SLIPPAGE_BPS, fenceMax) : DEFAULT_SLIPPAGE_BPS;
    const eurUsd = book.l.prices.EURC?.usd ?? null;
    const drafts: Draft[] = [];
    const scale = (value: bigint, legIn: bigint, quotedIn: bigint) => (quotedIn === 0n ? 0n : (value * legIn) / quotedIn);
    // A split runs atomically through LykiaRouter when every leg's venue is allowlisted there.
    let routerNote: string | null = null;
    if (best.legs.length > 1 && best.legs.every((l) => ROUTER_LEG_ADAPTERS.has(l.candidate.adapter))) {
      const legs: RouterLeg[] = best.legs.map((leg) => {
        const quotedIn = BigInt(leg.candidate.params.amountIn as string);
        const out = scale(leg.candidate.amountOut, leg.amountIn, quotedIn);
        const p = leg.candidate.params;
        return {
          adapter: leg.candidate.adapter as RouterLeg["adapter"],
          tokenIn: p.tokenIn as Address,
          tokenOut: p.tokenOut as Address,
          amountIn: leg.amountIn.toString(),
          minOut: ((out * BigInt(10_000 - slippageBps)) / 10_000n).toString(),
          ...(p.fee ? { fee: p.fee } : {}),
          ...(p.pool ? { pool: p.pool, router: p.router } : {}),
          label: leg.candidate.option.label,
        };
      });
      const check = await legsAllowlisted(this.deps.chains, env, legs);
      if (check.ok) {
        const out = best.legs.reduce((sum, leg) => sum + scale(leg.candidate.amountOut, leg.amountIn, BigInt(leg.candidate.params.amountIn as string)), 0n);
        const minOut = legs.reduce((sum, l) => sum + BigInt(l.minOut), 0n);
        book.receive(to.symbol, minOut);
        const input = book.amount(from.symbol, units + feeUnits(fee));
        const display = `${fromBaseUnits(units, from.decimals)} ${from.symbol} -> ${fromBaseUnits(out, to.decimals)} ${to.symbol}`;
        return [{
          adapter: "router-split",
          fx: isFx,
          summary: `${isFx ? "Convert" : "Swap"} ${display} split across ${legs.map((l) => l.label).join(" and ")} through LykiaRouter (min ${fromBaseUnits(minOut, to.decimals)})`,
          params: { legs: JSON.stringify(legs), intentId: book.l.intentId, symbolIn: from.symbol, display, amountIn: units.toString(), minOut: minOut.toString(), decimals: String(from.decimals), ...feeParams(fee) },
          inputs: [input],
          outputs: [book.amount(to.symbol, out, minOut)],
          ...(fee ? { fee } : {}),
          fact: { usd: input.usd, tokens: [book.fact(from.symbol, false), book.fact(to.symbol, true)], slippageBps, ...(isFx ? { fxDeviationBps: eurUsd === null ? null : fxDeviation(from.symbol, units, out, eurUsd) } : {}), ...feeFact(fee) },
          settlement: { kind: "receipt" },
          warnings: ["Both legs run in one LykiaRouter transaction: they settle together or not at all."],
          route: best.route,
        }];
      }
      routerNote = `The split runs as separate steps: ${check.missing.join(" and ")} ${check.missing.length === 1 ? "is" : "are"} not allowlisted on LykiaRouter yet (owner console → Router venues).`;
    }
    let legsOut = 0n;
    for (const [index, leg] of best.legs.entries()) {
      const quotedIn = BigInt(leg.candidate.params.amountIn as string);
      const legIn = best.legs.length === 1 ? units : leg.amountIn;
      const out = scale(leg.candidate.amountOut, legIn, quotedIn);
      const minOut = (out * BigInt(10_000 - slippageBps)) / 10_000n;
      book.receive(to.symbol, minOut);
      legsOut += minOut;
      // The whole fee rides on the first leg (one transfer per plan action).
      const legFee = index === 0 ? fee : undefined;
      const input = book.amount(from.symbol, legIn + feeUnits(legFee));
      const display = `${fromBaseUnits(legIn, from.decimals)} ${from.symbol} -> ${fromBaseUnits(out, to.decimals)} ${to.symbol}`;
      const warnings: string[] = [];
      if (routerNote && index === 0) warnings.push(routerNote);
      if (isFx && index === 0) warnings.push(this.deps.stablefxConfigured ? "StableFX RFQ credentials are set but its taker flow is not built yet; routed on-chain and checked against Chainlink EURC/USD." : "Routed on-chain and checked against Chainlink EURC/USD; StableFX RFQ needs Circle credentials.");
      drafts.push({
        adapter: leg.candidate.adapter as AdapterId,
        fx: isFx,
        summary: `${isFx ? "Convert" : "Swap"} ${display} on ${leg.candidate.option.label} (min ${fromBaseUnits(minOut, to.decimals)})`,
        params: { ...leg.candidate.params, amountIn: legIn.toString(), minOut: minOut.toString(), display, ...(leg.candidate.adapter === "swap-zerox" ? { slippageBps: String(slippageBps) } : {}), ...feeParams(legFee) },
        inputs: [input],
        outputs: [book.amount(to.symbol, out, minOut)],
        ...(legFee ? { fee: legFee } : {}),
        fact: { usd: input.usd, tokens: [book.fact(from.symbol, false), book.fact(to.symbol, true)], slippageBps, ...(isFx ? { fxDeviationBps: eurUsd === null ? null : fxDeviation(from.symbol, legIn, out, eurUsd) } : {}), ...feeFact(legFee) },
        settlement: { kind: "receipt" },
        warnings,
        ...(index === 0 ? { route: best.route } : {}),
      });
    }
    // "It" after a split swap means both legs' output.
    book.l.last = { symbol: to.symbol, units: legsOut };
    return drafts;
  }
}

/**
 * Deviation of a USDC<->EURC quote from the Chainlink EURC/USD reference,
 * in bps (positive = worse than the reference for the user).
 */
export function fxDeviation(fromSymbol: string, amountIn: bigint, amountOut: bigint, eurcUsd: string): number {
  const [w = "0", f = ""] = eurcUsd.split(".");
  const price = BigInt(w) * 100_000_000n + BigInt(f.padEnd(8, "0").slice(0, 8) || "0");
  if (price <= 0n || amountIn <= 0n) return 0;
  // Both tokens have 6 decimals. Fair out: USDC->EURC = in / price; EURC->USDC = in * price.
  const fair = fromSymbol === "USDC" ? (amountIn * 100_000_000n) / price : (amountIn * price) / 100_000_000n;
  if (fair === 0n) return 0;
  return Number(((fair - amountOut) * 10_000n) / fair);
}
