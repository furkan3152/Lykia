/**
 * The intent engine: plan (with the Fence), store, prepare unsigned calls,
 * verify submitted hashes against Arc receipts, and follow CCTP legs.
 * The server never signs. On Arc a successful receipt is final, so a
 * same-chain step settles the moment its receipt exists.
 */
import { randomBytes } from "node:crypto";
import {
  canonicalDigest,
  networkFor,
  outrunOf,
  sameAddress,
  transition,
  unlockSteps,
  usdMicros,
  verdictTag,
  type Address,
  type ArcEnvironment,
  type Fence,
  type FenceFacts,
  type IntentGraph,
  type IntentStep,
  type LykiaMemo,
  type Outrun,
  type PlanAction,
  type UnsignedTransaction,
  type IntegratorFeePolicy,
} from "@lykia/core";
import type { CreateIntentResponse, PrepareStepResponse, SubmitStepResponse } from "@lykia/core/api/intents";
import type { VenuePrefs } from "./router.js";
import type { EventBus } from "../bus.js";
import type { ArcChains } from "../chains/arc.js";
import type { Clock } from "../clock.js";
import type { FetchLike } from "../health/dependencies.js";
import { LykiaHttpError } from "../http/errors.js";
import type { Logger } from "../log.js";
import type { JsonValue, Store } from "../store/types.js";
import { opRunsPrepared, resolveUserOp, UserOpError, type ResolvedUserOp } from "./userop.js";
import { buildCalls, IRIS_API, type StepPlan } from "./adapters.js";
import { batched, shape } from "./calls.js";
import { amountSymbol, type Planner, type StepSource } from "./planner.js";
import { routeCalls } from "./simulate.js";

declare module "../bus.js" {
  interface LykiaEvents {
    "intent.updated": { readonly id: string; readonly intent: IntentGraph; readonly outrun: Outrun };
  }
}

export interface StoredIntent {
  readonly graph: IntentGraph;
  readonly plans: Record<string, StepPlan>;
  readonly facts: FenceFacts;
  readonly fence: Fence;
  readonly account: "eoa" | "smart";
  readonly confirmed: boolean;
  readonly cctp?: Record<string, { readonly attestation?: string; readonly message?: string; readonly status: string; readonly forwarded?: boolean; readonly forwardState?: string; readonly destinationMintTxHash?: string }>;
  /** The action behind each step (plans stored before staged plans have none and are never rebuilt). */
  readonly sources?: Record<string, StepSource>;
  /** What a rebuilt step is planned with: the signer, the agent and the owner's preferences at plan time. */
  readonly planInput?: { readonly signer: "wallet" | "agent"; readonly agent?: { readonly address: Address; readonly agentId?: string }; readonly preferences?: VenuePrefs; readonly integrator?: IntegratorFeePolicy; readonly program?: `sha256:${string}` };
  /** Steps prepared together as one transaction, by the step that leads them. */
  readonly batches?: Record<string, readonly string[]>;
}

/** Prepare refusals that pause the plan at this step until the owner retries or stops. */
const PAUSES = new Set(["FENCE_DENIED", "NO_ROUTE", "INSUFFICIENT_BALANCE", "UNPRICED"]);
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type ReceiptLike = { readonly status?: string; readonly logs?: readonly unknown[] } | null;

/**
 * What a step delivered to `account`: the net of the output token's
 * Transfer logs in its receipts (in minus out). Undefined when the step has
 * no registry-token output or nothing arrived.
 */
export function receivedOf(receipts: readonly ReceiptLike[], step: Pick<IntentStep, "outputs">, account: Address): IntentStep["received"] {
  const out = step.outputs.find((o) => !o.symbol.includes("@"));
  if (!out) return undefined;
  let net = 0n;
  for (const r of receipts) {
    for (const raw of r?.logs ?? []) {
      const log = raw as { address?: string; topics?: readonly string[]; data?: string };
      if (!log.address || !sameAddress(log.address, out.token) || log.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length < 3) continue;
      const from = `0x${log.topics[1]!.slice(26)}`;
      const to = `0x${log.topics[2]!.slice(26)}`;
      let value: bigint;
      try {
        value = BigInt(log.data ?? "0x0");
      } catch {
        continue;
      }
      if (sameAddress(to, account)) net += value;
      if (sameAddress(from, account)) net -= value;
    }
  }
  return net > 0n ? { symbol: out.symbol, token: out.token, decimals: out.decimals, amount: net.toString(), usd: null } : undefined;
}

export interface CreateInput {
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  readonly actions: readonly PlanAction[];
  readonly source: string;
  readonly fence?: Fence;
  readonly signer?: "wallet" | "agent";
  readonly agent?: { readonly address: Address; readonly agentId?: string };
  readonly account?: "eoa" | "smart";
  readonly dryRun?: boolean;
  readonly proposedByAgent?: boolean;
  /** Owner venue preferences: favourites win near-ties, blocked venues are never chosen. */
  readonly preferences?: VenuePrefs;
  /** The embedding project's fee, paid on chain beside Lykia's fee. */
  readonly integrator?: IntegratorFeePolicy;
  /** Digest of the compiled program the plan came from (pinned in the verdict). */
  readonly program?: `sha256:${string}`;
  /** Spend that counts toward the Fence's daily and weekly caps; default the owner's own (a leash passes its own). */
  readonly spent?: { readonly dayUsd: string | null; readonly weekUsd: string | null };
}

const INTENT_TTL_MS = 30 * 24 * 3600_000;

export function newIntentId(): string {
  return `out_${randomBytes(9).toString("base64url")}`;
}

export function bindingOf(transactions: readonly UnsignedTransaction[]): string {
  return canonicalDigest(transactions.map((t) => ({ chainId: t.chainId, from: t.from.toLowerCase(), to: t.to.toLowerCase(), data: t.data.toLowerCase(), value: t.value })));
}

/** Does an on-chain transaction match the prepared one? */
export function matchesPrepared(prepared: UnsignedTransaction, onchain: { readonly from: string; readonly to: string | null; readonly input: string; readonly value: bigint; readonly chainId?: number }): boolean {
  return (
    sameAddress(prepared.from, onchain.from) &&
    onchain.to !== null &&
    sameAddress(prepared.to, onchain.to) &&
    prepared.data.toLowerCase() === onchain.input.toLowerCase() &&
    BigInt(prepared.value) === onchain.value &&
    (onchain.chainId === undefined || onchain.chainId === prepared.chainId)
  );
}

/** The step and the steps after it in the same stage that can go out in one batch with it. */
function stageMembers(graph: IntentGraph, lead: IntentStep): IntentStep[] {
  if (lead.stage === undefined || lead.settlement.kind !== "receipt") return [lead];
  const out = [lead];
  for (const s of graph.steps.slice(graph.steps.indexOf(lead) + 1)) {
    if (s.stage !== lead.stage || s.settlement.kind !== "receipt" || !sameAddress(s.account, lead.account)) break;
    if (s.status !== "blocked" && s.status !== "ready" && s.status !== "awaiting-signature") break;
    out.push(s);
  }
  return out;
}

/** The steps one prepared transaction carries: the batch `stepId` leads or belongs to, else the step alone. */
function batchOf(doc: StoredIntent, stepId: string): { lead: string; members: readonly string[] } {
  const hit = Object.entries(doc.batches ?? {}).find(([lead, ids]) => lead === stepId || ids.includes(stepId));
  return hit ? { lead: hit[0], members: hit[1] } : { lead: stepId, members: [stepId] };
}

/** Records each step's delivered amount; a token two steps of one batch both deliver is not split between them. */
function recordReceived(steps: readonly IntentStep[], receipts: readonly ReceiptLike[]): void {
  const outs = steps.map((s) => s.outputs.find((o) => !o.symbol.includes("@"))?.token.toLowerCase() ?? null);
  steps.forEach((s, i) => {
    if (outs[i] === null || outs.filter((t) => t === outs[i]).length > 1) return;
    const got = receivedOf(receipts, s, s.account);
    if (got) s.received = got;
  });
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function weekKey(now: number): string {
  const d = new Date(now);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

export class IntentService {
  constructor(
    private readonly deps: {
      readonly planner: Planner;
      readonly chains: ArcChains;
      readonly store: Store;
      readonly clock: Clock;
      readonly bus: EventBus;
      readonly fetch: FetchLike;
      readonly log: Logger;
    },
  ) {}

  private intents() {
    return this.deps.store.collection<JsonValue>("intents");
  }

  private claims() {
    return this.deps.store.collection<JsonValue>("claims");
  }

  private spend() {
    return this.deps.store.counters("spend");
  }

  /** USD spent (settled steps) by `owner` today and this week, in cents. */
  async spent(environment: ArcEnvironment, owner: Address): Promise<{ dayUsd: string | null; weekUsd: string | null }> {
    const now = this.deps.clock.now();
    try {
      const [day, week] = await Promise.all([
        this.spend().get(`${environment}:${owner.toLowerCase()}:d:${dayKey(now)}`),
        this.spend().get(`${environment}:${owner.toLowerCase()}:w:${weekKey(now)}`),
      ]);
      const usd = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
      return { dayUsd: usd(day), weekUsd: usd(week) };
    } catch {
      return { dayUsd: null, weekUsd: null };
    }
  }

  async create(input: CreateInput): Promise<CreateIntentResponse> {
    const now = this.deps.clock.now();
    const result = await this.deps.planner.plan({
      id: newIntentId(),
      environment: input.environment,
      owner: input.owner,
      signer: input.signer ?? "wallet",
      ...(input.agent ? { agent: input.agent } : {}),
      actions: input.actions,
      ...(input.fence ? { fence: input.fence } : {}),
      source: input.source,
      ...(input.dryRun ? { dryRun: true } : {}),
      now,
      spent: input.spent ?? (await this.spent(input.environment, input.owner)),
      ...(input.proposedByAgent ? { proposedByAgent: true } : {}),
      ...(input.preferences ? { preferences: input.preferences } : {}),
      ...(input.integrator ? { integrator: input.integrator } : {}),
      ...(input.program ? { program: input.program } : {}),
    });
    const planInput: StoredIntent["planInput"] = { signer: input.signer ?? "wallet", ...(input.agent ? { agent: input.agent } : {}), ...(input.preferences ? { preferences: input.preferences } : {}), ...(input.integrator ? { integrator: input.integrator } : {}), ...(input.program ? { program: input.program } : {}) };
    const stored: StoredIntent = { ...result, account: input.account ?? "eoa", confirmed: false, planInput };
    if (!input.dryRun) await this.intents().put(result.graph.id, stored as unknown as JsonValue, { ttlMs: INTENT_TTL_MS });
    return { intent: result.graph, outrun: outrunOf(result.graph), stored: !input.dryRun };
  }

  async load(id: string): Promise<{ doc: StoredIntent; version: number }> {
    if (!/^out_[A-Za-z0-9_-]{6,32}$/u.test(id)) throw new LykiaHttpError("NOT_FOUND", 404, "No such intent.");
    const found = await this.intents().get(id);
    if (!found) throw new LykiaHttpError("NOT_FOUND", 404, "No such intent.");
    return { doc: found.value as unknown as StoredIntent, version: found.version };
  }

  async get(id: string): Promise<{ intent: IntentGraph; outrun: Outrun }> {
    const { doc } = await this.load(id);
    return { intent: doc.graph, outrun: outrunOf(doc.graph) };
  }

  private async save(id: string, version: number, doc: StoredIntent): Promise<void> {
    const saved = await this.intents().compareAndSet(id, version, doc as unknown as JsonValue, { ttlMs: INTENT_TTL_MS });
    if (!saved) throw new LykiaHttpError("CONFLICT", 409, "The intent changed meanwhile; read it again.");
    this.deps.bus.emit("intent.updated", { id, intent: doc.graph, outrun: outrunOf(doc.graph) });
  }

  /**
   * Unsigned calls for a step, rebuilt now. A step that spends what the step
   * before delivered is first planned again with the amount its receipt
   * shows (never the quote). The Fence and the beta cap are checked again on
   * the plan as it is now. With `stage`, an EOA's steps that share the
   * step's stage go out as one Multicall3From batch. A refusal here pauses
   * the plan at this step (recorded on the step) until it is retried.
   */
  async prepare(id: string, stepId: string, options: { readonly confirm?: boolean; readonly stage?: boolean } = {}): Promise<PrepareStepResponse> {
    const loaded = await this.load(id);
    let doc = loaded.doc;
    const version = loaded.version;
    if (!doc.graph.verdict.signable) throw new LykiaHttpError("NOT_SIGNABLE", 409, doc.graph.verdict.decision === "deny" ? "The Fence denies this plan." : "This plan is a dry run: nothing is signed.", { verdict: doc.graph.verdict.digest });
    if (doc.graph.verdict.decision === "confirm" && !doc.confirmed && !options.confirm) throw new LykiaHttpError("CONFIRMATION_REQUIRED", 409, "The Fence asks the owner to confirm this plan.", { reasons: doc.graph.verdict.reasons.filter((r) => r.decision === "confirm").map((r) => r.message) });
    const first = doc.graph.steps.find((s) => s.id === stepId);
    if (!first || !doc.plans[stepId]) throw new LykiaHttpError("NOT_FOUND", 404, "No such step.");
    if (first.status !== "ready" && first.status !== "awaiting-signature") throw new LykiaHttpError("STEP_NOT_READY", 409, `Step ${stepId} is ${first.status}.`);
    let replanned: PrepareStepResponse["replanned"];
    try {
      const rebuilt = await this.replanIfNeeded(doc, stepId);
      if (rebuilt) {
        doc = rebuilt.doc;
        replanned = rebuilt.replanned;
      }
      const check = this.deps.planner.recheck(doc.fence, { ...doc.facts, now: this.deps.clock.now() });
      if (check.decision === "deny") {
        const reasons = check.reasons.filter((r) => r.decision === "deny").map((r) => r.message);
        throw new LykiaHttpError("FENCE_DENIED", 409, `Your Fence refuses this step now: ${reasons.join(" ") || "a rule says no."}`, { reasons });
      }
      if (check.decision === "confirm" && doc.graph.verdict.decision === "allow" && !doc.confirmed && !options.confirm) {
        throw new LykiaHttpError("CONFIRMATION_REQUIRED", 409, "The plan changed enough that your Fence asks you to confirm this step.", { reasons: check.reasons.filter((r) => r.decision === "confirm").map((r) => r.message) });
      }
      const graph = doc.graph;
      const step = graph.steps.find((s) => s.id === stepId) as IntentStep;
      const members = options.stage && doc.account === "eoa" ? stageMembers(graph, step) : [step];
      const network = networkFor(graph.environment);
      const plan = doc.plans[stepId] as StepPlan;
      const memo: LykiaMemo = { intentId: graph.id, stepId, verdict: verdictTag(graph.verdict.digest), ...(plan.params.note ? { note: plan.params.note } : {}) };
      let transactions: UnsignedTransaction[];
      if (members.length > 1) {
        const flat = await routeCalls(this.deps.chains, graph.environment, step.account, graph.id, graph.verdict.digest, members.map((m) => ({ id: m.id, plan: doc.plans[m.id] as StepPlan })));
        const call = batched(flat.map((f) => f.call), graph.environment);
        transactions = [{ chainId: network.chainId, from: step.account, to: call.to, data: call.data, value: "0", label: `${members.length} steps in one transaction: ${members.map((m) => m.summary).join("; ")}` }];
      } else {
        const built = await buildCalls(plan, { environment: graph.environment, chains: this.deps.chains, account: step.account });
        transactions = shape(built.calls, built.approvals, { environment: graph.environment, chainId: network.chainId, from: step.account, memo, account: doc.account });
      }
      const binding = bindingOf(transactions);
      for (const m of members) {
        m.transactions = transactions;
        m.binding = binding as IntentStep["binding"];
        delete m.failure;
        if (m.status === "blocked") m.status = "ready";
        if (m.status === "ready") transition(m, "awaiting-signature");
      }
      const batches = { ...(doc.batches ?? {}) };
      if (members.length > 1) batches[stepId] = members.map((m) => m.id);
      else delete batches[stepId];
      await this.save(id, version, { ...doc, graph, confirmed: doc.confirmed || options.confirm === true, batches });
      const memoText = `lykia:1:${memo.intentId}:${memo.stepId}:${memo.verdict}${memo.note ? `|${memo.note}` : ""}`;
      return { stepId, transactions, binding, memo: memoText, ...(members.length > 1 ? { stepIds: members.map((m) => m.id) } : {}), ...(replanned ? { replanned } : {}) };
    } catch (error) {
      if (error instanceof LykiaHttpError && PAUSES.has(error.code)) {
        const step = doc.graph.steps.find((s) => s.id === stepId);
        if (step) {
          step.failure = { code: error.code, message: error.message, retryable: true };
          await this.save(id, version, doc).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  /** A step that spends "it", planned again with what the step before delivered; null when nothing to rebuild. */
  private async replanIfNeeded(doc: StoredIntent, stepId: string): Promise<{ doc: StoredIntent; replanned: NonNullable<PrepareStepResponse["replanned"]> } | null> {
    const source = doc.sources?.[stepId];
    const graph = doc.graph;
    const index = graph.steps.findIndex((s) => s.id === stepId);
    const step = graph.steps[index];
    const before = graph.steps[index - 1];
    if (!source?.previous || source.drafts !== 1 || !step || step.replanned || !before?.received || !doc.planInput) return null;
    const symbol = amountSymbol(source.action);
    if (!symbol || before.received.symbol !== symbol) return null;
    const actual = BigInt(before.received.amount);
    const planned = BigInt(step.inputs[0]?.amount ?? "0");
    const rebuilt = await this.deps.planner.replanStep(
      { id: graph.id, environment: graph.environment, owner: graph.owner, signer: doc.planInput.signer, ...(doc.planInput.agent ? { agent: doc.planInput.agent } : {}), fence: doc.fence, now: this.deps.clock.now(), spent: doc.facts.spent ?? { dayUsd: null, weekUsd: null }, ...(doc.planInput.preferences ? { preferences: doc.planInput.preferences } : {}), ...(doc.planInput.integrator ? { integrator: doc.planInput.integrator } : {}), ...(doc.planInput.program ? { program: doc.planInput.program } : {}) },
      source.action,
      actual,
    );
    const at = new Date(this.deps.clock.now()).toISOString();
    const { route: _r, fee: _f, ...rest } = step;
    const next: IntentStep = {
      ...rest,
      kind: rebuilt.step.kind,
      venue: rebuilt.step.venue,
      summary: rebuilt.step.summary,
      inputs: rebuilt.step.inputs,
      outputs: rebuilt.step.outputs,
      settlement: rebuilt.step.settlement,
      ...(rebuilt.step.route ? { route: rebuilt.step.route } : {}),
      ...(rebuilt.step.fee ? { fee: rebuilt.step.fee } : {}),
      replanned: { symbol, planned: planned.toString(), actual: actual.toString(), at },
    };
    const steps = graph.steps.slice();
    steps[index] = next;
    const facts: FenceFacts = { ...doc.facts, steps: doc.facts.steps.map((f) => (f.id === stepId ? { ...rebuilt.fact, id: stepId } : f)) };
    return { doc: { ...doc, graph: { ...graph, steps }, plans: { ...doc.plans, [stepId]: rebuilt.plan }, facts }, replanned: { symbol, planned: planned.toString(), actual: actual.toString() } };
  }

  /**
   * "Retry this step": a step that failed (its transaction reverted, so
   * nothing moved) or was refused at prepare goes back to ready, with its
   * old calls dropped; the next prepare rebuilds it. Settled steps stay.
   */
  async retry(id: string, stepId: string): Promise<{ intent: IntentGraph; outrun: Outrun }> {
    const { doc, version } = await this.load(id);
    const step = doc.graph.steps.find((s) => s.id === stepId);
    if (!step) throw new LykiaHttpError("NOT_FOUND", 404, "No such step.");
    const members = Object.entries(doc.batches ?? {}).find(([lead, ids]) => lead === stepId || ids.includes(stepId))?.[1] ?? [stepId];
    let moved = false;
    for (const m of doc.graph.steps.filter((s) => members.includes(s.id))) {
      if (m.status === "failed" || ((m.status === "ready" || m.status === "awaiting-signature") && m.failure)) {
        if (m.status === "failed") transition(m, "ready");
        if (m.status === "awaiting-signature") transition(m, "ready");
        delete m.failure;
        delete m.transactions;
        delete m.binding;
        delete m.references;
        moved = true;
      }
    }
    if (!moved) throw new LykiaHttpError("STEP_NOT_READY", 409, `Step ${stepId} is ${step.status}; only a paused step can be retried.`);
    // A step that follows a batch member but was in the batch goes back to waiting for the one before it.
    for (const m of doc.graph.steps.filter((s) => members.includes(s.id) && s.id !== stepId && s.status === "ready")) {
      const before = doc.graph.steps[doc.graph.steps.indexOf(m) - 1];
      if (before && before.status !== "settled") m.status = "blocked";
    }
    const batches = Object.fromEntries(Object.entries(doc.batches ?? {}).filter(([, ids]) => !ids.includes(stepId)));
    await this.save(id, version, { ...doc, batches });
    return { intent: doc.graph, outrun: outrunOf(doc.graph) };
  }

  async submit(id: string, stepId: string, hashes: readonly string[]): Promise<SubmitStepResponse> {
    const { doc, version } = await this.load(id);
    const graph = doc.graph;
    const batch = batchOf(doc, stepId);
    const step = graph.steps.find((s) => s.id === batch.lead);
    if (!step) throw new LykiaHttpError("NOT_FOUND", 404, "No such step.");
    if (step.status !== "awaiting-signature" || !step.transactions) throw new LykiaHttpError("STEP_NOT_READY", 409, `Step ${step.id} is ${step.status}; prepare it first.`);
    if (hashes.length !== step.transactions.length) throw new LykiaHttpError("BINDING_MISMATCH", 409, `Expected ${step.transactions.length} transaction hash(es).`);
    const env = graph.environment;
    for (let i = 0; i < hashes.length; i++) {
      const hash = hashes[i] as string;
      const tx = await this.deps.chains.getTransaction(env, hash);
      if (!tx) throw new LykiaHttpError("NOT_FOUND", 404, `Arc does not know ${hash} yet. Submit again once it is broadcast.`);
      if (!matchesPrepared(step.transactions[i] as UnsignedTransaction, { from: tx.from, to: tx.to, input: tx.input, value: tx.value, ...(tx.chainId !== undefined ? { chainId: tx.chainId } : {}) })) {
        throw new LykiaHttpError("BINDING_MISMATCH", 409, "That transaction does not match the prepared one.", { hash });
      }
    }
    for (const hash of hashes) {
      const claim = await this.claims().compareAndSet(hash.toLowerCase(), null, { intent: id, step: step.id } as JsonValue, { ttlMs: INTENT_TTL_MS });
      if (!claim) {
        const existing = await this.claims().get(hash.toLowerCase());
        const owner = existing?.value as { intent?: string; step?: string } | undefined;
        if (owner?.intent !== id || owner.step !== step.id) throw new LykiaHttpError("REFERENCE_CLAIMED", 409, "That hash is attached to another step.", { hash });
      }
    }
    // Every step the transaction carries moves with it; the batch settles whole or not at all.
    const members = graph.steps.filter((s) => batch.members.includes(s.id) && s.status === "awaiting-signature" && s.binding === step.binding);
    for (const m of members) {
      m.references = hashes as `0x${string}`[];
      transition(m, "submitted");
    }
    const receipts = await Promise.all(hashes.map((h) => this.deps.chains.getTxReceipt(env, h)));
    if (receipts.every((r) => r !== null)) {
      if (receipts.some((r) => r?.status !== "success")) {
        for (const m of members) {
          transition(m, "failed");
          m.failure = { code: "RECEIPT_REVERTED", message: "The transaction reverted on Arc, so nothing moved.", retryable: true };
        }
      } else {
        recordReceived(members, receipts as ReceiptLike[]);
        for (const m of members) {
          if (m.settlement.kind === "receipt" || m.settlement.kind === "gateway") {
            transition(m, "settled");
            m.settledAt = new Date(this.deps.clock.now()).toISOString();
            await this.recordSpend(graph, m);
          } else {
            transition(m, "settling");
          }
        }
        unlockSteps(graph);
      }
    }
    await this.save(id, version, { ...doc, graph });
    return { step: graph.steps.find((s) => s.id === stepId) ?? step, outrun: outrunOf(graph) };
  }

  /**
   * Smart accounts (ERC-4337): the step's calls ran inside one
   * UserOperation. The op is found by its EntryPoint event, its sender must
   * be the step's account and its callData must carry every prepared call
   * (see userop.ts). The userOpHash is claimed once; the bundle transaction
   * hash becomes the step's reference for the explorer.
   */
  async submitUserOp(id: string, stepId: string, userOpHash: string): Promise<SubmitStepResponse> {
    const { doc, version } = await this.load(id);
    const graph = doc.graph;
    const step = graph.steps.find((s) => s.id === stepId);
    if (!step) throw new LykiaHttpError("NOT_FOUND", 404, "No such step.");
    if (step.status !== "awaiting-signature" || !step.transactions) throw new LykiaHttpError("STEP_NOT_READY", 409, `Step ${stepId} is ${step.status}; prepare it first.`);
    let op: ResolvedUserOp;
    try {
      op = await resolveUserOp(this.deps.chains, graph.environment, userOpHash as `0x${string}`);
    } catch (error) {
      if (error instanceof UserOpError) throw new LykiaHttpError(error.code, error.code === "NOT_FOUND" ? 404 : 409, error.message, { userOpHash });
      throw error;
    }
    if (op.sender.toLowerCase() !== step.account.toLowerCase()) throw new LykiaHttpError("BINDING_MISMATCH", 409, "That UserOperation was sent by another account.", { userOpHash, sender: op.sender });
    if (!opRunsPrepared(op, step.transactions)) throw new LykiaHttpError("BINDING_MISMATCH", 409, "That UserOperation does not run the prepared calls.", { userOpHash });
    const key = `userop:${userOpHash.toLowerCase()}`;
    const claim = await this.claims().compareAndSet(key, null, { intent: id, step: stepId } as JsonValue, { ttlMs: INTENT_TTL_MS });
    if (!claim) {
      const owner = (await this.claims().get(key))?.value as { intent?: string; step?: string } | undefined;
      if (owner?.intent !== id || owner.step !== stepId) throw new LykiaHttpError("REFERENCE_CLAIMED", 409, "That UserOperation is attached to another step.", { userOpHash });
    }
    step.references = [op.transactionHash];
    transition(step, "submitted");
    if (!op.success) {
      transition(step, "failed");
      step.failure = { code: "RECEIPT_REVERTED", message: "The UserOperation reverted on Arc (EntryPoint reported success = false), so nothing moved.", retryable: true };
    } else if (step.settlement.kind === "receipt" || step.settlement.kind === "gateway") {
      const receipt = await this.deps.chains.getTxReceipt(graph.environment, op.transactionHash).catch(() => null);
      if (receipt) recordReceived([step], [receipt as ReceiptLike]);
      transition(step, "settled");
      step.settledAt = new Date(this.deps.clock.now()).toISOString();
      await this.recordSpend(graph, step);
      unlockSteps(graph);
    } else {
      transition(step, "settling");
    }
    await this.save(id, version, { ...doc, graph });
    return { step, outrun: outrunOf(graph) };
  }

  /**
   * Steps that ran inside one transaction built outside prepare/submit (a
   * payout batch: many transfers, one Multicall3From call). The caller has
   * verified the transaction and its receipt; this records the outcome on
   * each step and counts the spend toward the daily caps.
   */
  async settleExternal(id: string, stepIds: readonly string[], reference: string, ok: boolean): Promise<void> {
    const { doc, version } = await this.load(id);
    for (const step of doc.graph.steps) {
      if (!stepIds.includes(step.id) || step.status === "settled" || step.status === "failed") continue;
      if (step.status === "blocked") step.status = "ready";
      if (step.status === "ready") transition(step, "awaiting-signature");
      if (step.status === "awaiting-signature") transition(step, "submitted");
      step.references = [reference as `0x${string}`];
      if (ok) {
        transition(step, "settled");
        step.settledAt = new Date(this.deps.clock.now()).toISOString();
        await this.recordSpend(doc.graph, step);
      } else {
        transition(step, "failed");
        step.failure = { code: "RECEIPT_REVERTED", message: "The batch transaction reverted on Arc.", retryable: false };
      }
    }
    await this.save(id, version, doc);
  }

  async stop(id: string): Promise<{ intent: IntentGraph; outrun: Outrun }> {
    const { doc, version } = await this.load(id);
    for (const step of doc.graph.steps) if (step.status === "blocked" || step.status === "ready" || step.status === "awaiting-signature") step.status = "stopped";
    await this.save(id, version, doc);
    return { intent: doc.graph, outrun: outrunOf(doc.graph) };
  }

  private async recordSpend(graph: IntentGraph, step: IntentStep): Promise<void> {
    const usd = step.inputs.reduce<bigint | null>((sum, a) => (sum === null || a.usd === null ? null : sum + usdMicros(a.usd)), 0n);
    if (usd === null || usd === 0n) return;
    const cents = Number((usd + 5_000n) / 10_000n);
    const now = this.deps.clock.now();
    const owner = graph.owner.toLowerCase();
    await Promise.all([
      this.spend().increment(`${graph.environment}:${owner}:d:${dayKey(now)}`, cents, { ttlMs: 2 * 24 * 3600_000 }),
      this.spend().increment(`${graph.environment}:${owner}:w:${weekKey(now)}`, cents, { ttlMs: 8 * 24 * 3600_000 }),
    ]).catch((error: unknown) => this.deps.log.warn("spend counter failed", { error: error instanceof Error ? error.message : String(error) }));
  }

  /** One pass over in-flight intents: late receipts and CCTP attestations. */
  async poll(): Promise<number> {
    let changed = 0;
    const docs = await this.intents().list({ limit: 200 });
    for (const entry of docs) {
      const doc = entry.value as unknown as StoredIntent;
      const pending = doc.graph.steps.filter((s) => s.status === "submitted" || s.status === "settling");
      if (pending.length === 0) continue;
      let dirty = false;
      for (const step of pending) {
        try {
          dirty = (await this.advance(doc, step)) || dirty;
        } catch (error) {
          this.deps.log.debug("poll step failed", { intent: doc.graph.id, step: step.id, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (dirty) {
        try {
          await this.save(entry.id, entry.version, doc);
          changed += 1;
        } catch {
          // Another writer moved it; the next pass sees the new version.
        }
      }
    }
    return changed;
  }

  private async advance(doc: StoredIntent, step: IntentStep): Promise<boolean> {
    const env = doc.graph.environment;
    if (step.status === "submitted") {
      const receipts = await Promise.all((step.references ?? []).map((h) => this.deps.chains.getTxReceipt(env, h)));
      if (receipts.some((r) => r === null)) return false;
      if (receipts.some((r) => r?.status !== "success")) {
        transition(step, "failed");
        step.failure = { code: "RECEIPT_REVERTED", message: "The transaction reverted on Arc, so nothing moved.", retryable: true };
        return true;
      }
      const batch = batchOf(doc, step.id);
      recordReceived(batch.members.length > 1 ? doc.graph.steps.filter((s) => batch.members.includes(s.id)) : [step], receipts as ReceiptLike[]);
      const next = step.settlement.kind === "cctp" ? "settling" : "settled";
      transition(step, next);
      if (next === "settled") {
        step.settledAt = new Date(this.deps.clock.now()).toISOString();
        await this.recordSpend(doc.graph, step);
        unlockSteps(doc.graph);
      }
      return true;
    }
    if (step.status === "settling" && step.settlement.kind === "cctp") {
      const hash = step.references?.[step.references.length - 1];
      if (!hash) return false;
      const response = await this.deps.fetch(`${IRIS_API[env]}/v2/messages/26?transactionHash=${hash}`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return false;
      const body = (await response.json()) as { messages?: Array<{ status?: string; attestation?: string; message?: string; forwardState?: string; destinationMintTxHash?: string }> };
      const message = body.messages?.[0];
      if (message?.status !== "complete") return false;
      // A forwarded burn is settled when Circle's Forwarding Service has minted on the destination (Iris forwardState COMPLETE).
      const forwarded = doc.plans[step.id]?.params.forward === "1";
      const forwardState = message.forwardState?.toUpperCase();
      if (forwarded && forwardState !== "COMPLETE" && !message.destinationMintTxHash) return false;
      (doc as { cctp?: StoredIntent["cctp"] }).cctp = { ...(doc.cctp ?? {}), [step.id]: { status: "complete", ...(message.attestation ? { attestation: message.attestation } : {}), ...(message.message ? { message: message.message } : {}), ...(forwarded ? { forwarded: true, ...(forwardState ? { forwardState } : {}), ...(message.destinationMintTxHash ? { destinationMintTxHash: message.destinationMintTxHash } : {}) } : {}) } };
      transition(step, "settled");
      step.settledAt = new Date(this.deps.clock.now()).toISOString();
      await this.recordSpend(doc.graph, step);
      unlockSteps(doc.graph);
      return true;
    }
    return false;
  }
}
