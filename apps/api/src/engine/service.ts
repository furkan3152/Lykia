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
} from "@lykia/core";
import type { CreateIntentResponse, PrepareStepResponse, SubmitStepResponse } from "@lykia/core/api/intents";
import type { EventBus } from "../bus.js";
import type { ArcChains } from "../chains/arc.js";
import type { Clock } from "../clock.js";
import type { FetchLike } from "../health/dependencies.js";
import { LykiaHttpError } from "../http/errors.js";
import type { Logger } from "../log.js";
import type { JsonValue, Store } from "../store/types.js";
import { buildCalls, IRIS_API, type StepPlan } from "./adapters.js";
import { shape } from "./calls.js";
import type { Planner } from "./planner.js";

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
  readonly cctp?: Record<string, { readonly attestation?: string; readonly message?: string; readonly status: string }>;
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
}

export const INTENT_TTL_MS = 30 * 24 * 3600_000;

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
      spent: await this.spent(input.environment, input.owner),
      ...(input.proposedByAgent ? { proposedByAgent: true } : {}),
    });
    const stored: StoredIntent = { ...result, account: input.account ?? "eoa", confirmed: false };
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

  async prepare(id: string, stepId: string, options: { readonly confirm?: boolean } = {}): Promise<PrepareStepResponse> {
    const { doc, version } = await this.load(id);
    const graph = doc.graph;
    if (!graph.verdict.signable) throw new LykiaHttpError("NOT_SIGNABLE", 409, graph.verdict.decision === "deny" ? "The Fence denies this plan." : "This plan is a dry run: nothing is signed.", { verdict: graph.verdict.digest });
    if (graph.verdict.decision === "confirm" && !doc.confirmed && !options.confirm) throw new LykiaHttpError("CONFIRMATION_REQUIRED", 409, "The Fence asks the owner to confirm this plan.", { reasons: graph.verdict.reasons.filter((r) => r.decision === "confirm").map((r) => r.message) });
    const step = graph.steps.find((s) => s.id === stepId);
    const plan = doc.plans[stepId];
    if (!step || !plan) throw new LykiaHttpError("NOT_FOUND", 404, "No such step.");
    if (step.status !== "ready" && step.status !== "awaiting-signature") throw new LykiaHttpError("STEP_NOT_READY", 409, `Step ${stepId} is ${step.status}.`);
    const network = networkFor(graph.environment);
    const memo: LykiaMemo = { intentId: graph.id, stepId, verdict: verdictTag(graph.verdict.digest), ...(plan.params.note ? { note: plan.params.note } : {}) };
    const { main, approval } = await buildCalls(plan, { environment: graph.environment, chains: this.deps.chains, account: step.account });
    const transactions = shape(main, approval, { environment: graph.environment, chainId: network.chainId, from: step.account, memo, account: doc.account });
    const binding = bindingOf(transactions);
    step.transactions = transactions;
    step.binding = binding as IntentStep["binding"];
    if (step.status === "ready") transition(step, "awaiting-signature");
    await this.save(id, version, { ...doc, graph, confirmed: doc.confirmed || options.confirm === true });
    const memoText = `lykia:1:${memo.intentId}:${memo.stepId}:${memo.verdict}${memo.note ? `|${memo.note}` : ""}`;
    return { stepId, transactions, binding, memo: memoText };
  }

  async submit(id: string, stepId: string, hashes: readonly string[]): Promise<SubmitStepResponse> {
    const { doc, version } = await this.load(id);
    const graph = doc.graph;
    const step = graph.steps.find((s) => s.id === stepId);
    if (!step) throw new LykiaHttpError("NOT_FOUND", 404, "No such step.");
    if (step.status !== "awaiting-signature" || !step.transactions) throw new LykiaHttpError("STEP_NOT_READY", 409, `Step ${stepId} is ${step.status}; prepare it first.`);
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
      const claim = await this.claims().compareAndSet(hash.toLowerCase(), null, { intent: id, step: stepId } as JsonValue, { ttlMs: INTENT_TTL_MS });
      if (!claim) {
        const existing = await this.claims().get(hash.toLowerCase());
        const owner = existing?.value as { intent?: string; step?: string } | undefined;
        if (owner?.intent !== id || owner.step !== stepId) throw new LykiaHttpError("REFERENCE_CLAIMED", 409, "That hash is attached to another step.", { hash });
      }
    }
    step.references = hashes as `0x${string}`[];
    transition(step, "submitted");
    const receipts = await Promise.all(hashes.map((h) => this.deps.chains.getTxReceipt(env, h)));
    if (receipts.every((r) => r !== null)) {
      if (receipts.some((r) => r?.status !== "success")) {
        transition(step, "failed");
        step.failure = { code: "RECEIPT_REVERTED", message: "The transaction reverted on Arc.", retryable: false };
      } else if (step.settlement.kind === "receipt" || step.settlement.kind === "gateway") {
        transition(step, "settled");
        step.settledAt = new Date(this.deps.clock.now()).toISOString();
        await this.recordSpend(graph, step);
        unlockSteps(graph);
      } else {
        transition(step, "settling");
      }
    }
    await this.save(id, version, { ...doc, graph });
    return { step, outrun: outrunOf(graph) };
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
        step.failure = { code: "RECEIPT_REVERTED", message: "The transaction reverted on Arc.", retryable: false };
        return true;
      }
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
      const body = (await response.json()) as { messages?: Array<{ status?: string; attestation?: string; message?: string }> };
      const message = body.messages?.[0];
      if (message?.status !== "complete") return false;
      (doc as { cctp?: StoredIntent["cctp"] }).cctp = { ...(doc.cctp ?? {}), [step.id]: { status: "complete", ...(message.attestation ? { attestation: message.attestation } : {}), ...(message.message ? { message: message.message } : {}) } };
      transition(step, "settled");
      step.settledAt = new Date(this.deps.clock.now()).toISOString();
      await this.recordSpend(doc.graph, step);
      unlockSteps(doc.graph);
      return true;
    }
    return false;
  }
}
