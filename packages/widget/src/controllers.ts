/**
 * Framework-free controllers behind the hooks. Each one is a tiny store
 * (get / subscribe) plus actions, so the logic is testable without a DOM
 * and the hooks stay thin (`useSyncExternalStore`).
 */
import type { Address, ArcEnvironment, Fence, FenceTemplateKey, FenceVerdict, IntentGraph, Outrun, PlanAction } from "@lykia/core";
import { FENCE_TEMPLATES } from "@lykia/core";
import { agentApi, ecosystemApi, fenceApi, intentsApi, packApi, type AgentProposal, type LykiaTransport, type PackAgentView } from "@lykia/sdk";
import type { LykiaSigner } from "./wallet.js";

export interface Store<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

export interface WritableStore<T> extends Store<T> {
  set(next: T | ((prev: T) => T)): void;
}

export function createStore<T>(initial: T): WritableStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const l of [...listeners]) l();
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------- plan */

export type PlanStatus = "idle" | "planning" | "planned" | "signing" | "settled" | "error";

export interface PlanState {
  readonly status: PlanStatus;
  readonly intent: IntentGraph | null;
  readonly outrun: Outrun | null;
  /** The step being signed, while signing. */
  readonly stepId: string | null;
  readonly hashes: readonly `0x${string}`[];
  readonly error: string | null;
}

export interface PlanInput {
  readonly text?: string;
  readonly actions?: readonly PlanAction[];
  readonly owner?: Address;
  readonly fence?: Fence;
  readonly dryRun?: boolean;
}

export interface PlanDeps {
  readonly transport: LykiaTransport;
  readonly environment?: ArcEnvironment;
  readonly signer: () => Promise<LykiaSigner | null>;
}

export const IDLE_PLAN: PlanState = Object.freeze({ status: "idle", intent: null, outrun: null, stepId: null, hashes: [], error: null });

export function createPlanController(deps: PlanDeps) {
  const store = createStore<PlanState>(IDLE_PLAN);
  const api = intentsApi(deps.transport);

  async function ownerOf(input: PlanInput): Promise<Address> {
    if (input.owner) return input.owner;
    const signer = await deps.signer();
    const address = signer ? await signer.address(true) : null;
    if (!address) throw new Error("Connect a wallet to plan.");
    return address;
  }

  return {
    ...(store as Store<PlanState>),
    async plan(input: PlanInput): Promise<IntentGraph | null> {
      store.set({ ...IDLE_PLAN, status: "planning" });
      try {
        const owner = await ownerOf(input);
        const created = await api.create({ owner, ...(input.text ? { text: input.text } : {}), ...(input.actions ? { actions: input.actions } : {}), ...(input.fence ? { fence: input.fence } : {}), ...(input.dryRun ? { dryRun: true } : {}), ...(deps.environment ? { environment: deps.environment } : {}) });
        store.set({ ...IDLE_PLAN, status: "planned", intent: created.intent, outrun: created.outrun });
        return created.intent;
      } catch (error) {
        store.set({ ...IDLE_PLAN, status: "error", error: message(error) });
        return null;
      }
    },
    /** Prepares, signs and submits every step in order. The Fence verdict must be signable. */
    async run(options: { confirm?: boolean } = {}): Promise<boolean> {
      const state = store.get();
      const intent = state.intent;
      if (!intent) return false;
      if (!intent.verdict.signable) {
        store.set({ ...state, status: "error", error: intent.verdict.decision === "deny" ? "The Fence denied this plan." : "This plan is a dry run and cannot be signed." });
        return false;
      }
      const signer = await deps.signer();
      if (!signer) {
        store.set({ ...state, status: "error", error: "Connect a wallet to sign." });
        return false;
      }
      const hashes: `0x${string}`[] = [];
      try {
        let outrun = state.outrun;
        for (const step of intent.steps) {
          store.set((s) => ({ ...s, status: "signing", stepId: step.id, error: null }));
          const prepared = await api.prepare(intent.id, step.id, { confirm: options.confirm ?? intent.verdict.decision === "confirm" });
          const stepHashes: `0x${string}`[] = [];
          for (const tx of prepared.transactions) stepHashes.push(await signer.send(tx));
          hashes.push(...stepHashes);
          const submitted = await api.submit(intent.id, step.id, stepHashes);
          outrun = submitted.outrun;
          store.set((s) => ({ ...s, outrun, hashes: [...hashes] }));
        }
        store.set((s) => ({ ...s, status: "settled", stepId: null }));
        return true;
      } catch (error) {
        store.set((s) => ({ ...s, status: "error", error: message(error), hashes: [...hashes] }));
        return false;
      }
    },
    reset() {
      store.set(IDLE_PLAN);
    },
  };
}

export type PlanController = ReturnType<typeof createPlanController>;

/* ------------------------------------------------------------- chat */

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface ChatState {
  readonly messages: readonly ChatMessage[];
  readonly proposals: readonly AgentProposal[];
  readonly threadId: string | null;
  readonly pending: boolean;
  readonly error: string | null;
}

export const EMPTY_CHAT: ChatState = Object.freeze({ messages: [], proposals: [], threadId: null, pending: false, error: null });

export function createChatController(deps: { readonly transport: LykiaTransport; readonly environment?: ArcEnvironment; readonly owner?: () => Promise<Address | null> }) {
  const store = createStore<ChatState>(EMPTY_CHAT);
  const api = agentApi(deps.transport);
  return {
    ...(store as Store<ChatState>),
    async send(text: string, fence?: Fence): Promise<void> {
      const trimmed = text.trim();
      if (!trimmed || store.get().pending) return;
      store.set((s) => ({ ...s, pending: true, error: null, messages: [...s.messages, { role: "user", text: trimmed }] }));
      try {
        const owner = deps.owner ? await deps.owner() : null;
        const threadId = store.get().threadId;
        const reply = await api.ask({ message: trimmed, ...(owner ? { owner } : {}), ...(threadId ? { threadId } : {}), ...(fence ? { fence } : {}), ...(deps.environment ? { environment: deps.environment } : {}) });
        store.set((s) => ({ ...s, pending: false, threadId: reply.threadId, proposals: reply.proposals, messages: reply.reply ? [...s.messages, { role: "assistant", text: reply.reply }] : s.messages }));
      } catch (error) {
        store.set((s) => ({ ...s, pending: false, error: message(error) }));
      }
    },
    reset() {
      store.set(EMPTY_CHAT);
    },
  };
}

export type ChatController = ReturnType<typeof createChatController>;

/* ------------------------------------------------------------ query */

export interface QueryState<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export function createQuery<A extends unknown[], T>(fetcher: (...args: A) => Promise<T>) {
  const store = createStore<QueryState<T>>({ data: null, loading: false, error: null });
  let seq = 0;
  return {
    ...(store as Store<QueryState<T>>),
    async load(...args: A): Promise<T | null> {
      const mine = ++seq;
      store.set((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fetcher(...args);
        if (mine === seq) store.set({ data, loading: false, error: null });
        return data;
      } catch (error) {
        if (mine === seq) store.set((s) => ({ ...s, loading: false, error: message(error) }));
        return null;
      }
    },
  };
}

export const scentQuery = (t: LykiaTransport, environment?: ArcEnvironment) => createQuery((token: Address) => ecosystemApi(t).scent(token, environment));
export const flockQuery = (t: LykiaTransport, environment?: ArcEnvironment) => createQuery((owner: Address) => ecosystemApi(t).flock(owner, environment));
export const outrunQuery = (t: LykiaTransport) => createQuery((intentId: string) => intentsApi(t).outrun(intentId));

export function createPackController(t: LykiaTransport, environment?: ArcEnvironment) {
  const query = createQuery((owner: Address) => packApi(t).list(owner, environment).then((r) => r.agents));
  return {
    ...query,
    async spawn(parentId: string, input: Parameters<ReturnType<typeof packApi>["spawn"]>[1]): Promise<PackAgentView> {
      return packApi(t).spawn(parentId, input);
    },
    async revoke(id: string): Promise<string[]> {
      return (await packApi(t).revoke(id)).revoked;
    },
  };
}

/* ------------------------------------------------------------ fence */

export interface FenceState {
  readonly template: FenceTemplateKey;
  readonly fence: Fence;
  readonly loosened: readonly string[];
  readonly issues: readonly unknown[];
  readonly verdict: FenceVerdict | null;
  readonly checking: boolean;
  readonly error: string | null;
}

export function createFenceController(t: LykiaTransport, initial: { template?: FenceTemplateKey; fence?: Fence } = {}) {
  const template = initial.template ?? "shepherd";
  const start = initial.fence ?? FENCE_TEMPLATES[template];
  const store = createStore<FenceState>({ template, fence: start, loosened: [], issues: [], verdict: null, checking: false, error: null });
  const api = fenceApi(t);
  const baseline = start;
  return {
    ...(store as Store<FenceState>),
    pickTemplate(key: FenceTemplateKey) {
      store.set((s) => ({ ...s, template: key, fence: FENCE_TEMPLATES[key], loosened: [], issues: [] }));
    },
    setCap(key: "perStepUsd" | "perIntentUsd" | "dailyUsd" | "weeklyUsd", value: string | undefined) {
      store.set((s) => {
        const caps = { ...(s.fence.caps ?? {}) } as Record<string, string | undefined>;
        if (value === undefined || value === "") delete caps[key];
        else caps[key] = value;
        return { ...s, fence: { ...s.fence, caps } };
      });
    },
    edit(next: Fence) {
      store.set((s) => ({ ...s, fence: next }));
    },
    /** Validates on the server; `loosened` lists every rule that is looser than the starting Fence. */
    async validate(): Promise<boolean> {
      store.set((s) => ({ ...s, checking: true, error: null }));
      try {
        const result = await api.validate(store.get().fence, baseline);
        store.set((s) => ({ ...s, checking: false, issues: result.issues ?? [], loosened: result.loosened ?? [] }));
        return result.ok;
      } catch (error) {
        store.set((s) => ({ ...s, checking: false, error: message(error) }));
        return false;
      }
    },
  };
}

export type FenceController = ReturnType<typeof createFenceController>;
