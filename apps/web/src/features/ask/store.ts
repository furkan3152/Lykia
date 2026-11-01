/**
 * Ask Lyko's state: the pending first message (handed from the landing
 * composer or ⌘K, so the composer can morph into the chat), the live
 * conversation, local thread history and the streaming status.
 */
import type { ArcEnvironment, Fence } from "@lykia/core";
import { create } from "zustand";

import { readStorage, writeStorage } from "../../app/state/storage";
import { streamChat } from "./client";
import { assistantDraft, EMPTY, reduce, titleOf, userMessage, type Conversation } from "./model";

export interface ThreadSummary {
  readonly id: string;
  readonly title: string;
  readonly at: number;
}

const THREADS_KEY = "lykia.threads";

function storedThreads(): ThreadSummary[] {
  try {
    const raw = readStorage(THREADS_KEY);
    const list = raw ? (JSON.parse(raw) as ThreadSummary[]) : [];
    return Array.isArray(list) ? list.slice(0, 40) : [];
  } catch {
    return [];
  }
}

interface AskState {
  readonly pending: string | null;
  readonly convo: Conversation;
  readonly status: "idle" | "streaming" | "error";
  readonly threads: readonly ThreadSummary[];
  readonly abort: AbortController | null;
  begin(text: string): void;
  takePending(): string | null;
  send(text: string, ctx: { owner?: `0x${string}`; environment: ArcEnvironment; fence?: Fence }): Promise<void>;
  stop(): void;
  fresh(): void;
  openThread(id: string): void;
}

export const useAsk = create<AskState>()((set, get) => ({
  pending: null,
  convo: EMPTY,
  status: "idle",
  threads: storedThreads(),
  abort: null,
  begin: (text) => set({ pending: text }),
  takePending: () => {
    const p = get().pending;
    if (p) set({ pending: null });
    return p;
  },
  send: async (text, ctx) => {
    get().abort?.abort();
    const controller = new AbortController();
    const start = get().convo;
    set({ convo: { ...start, messages: [...start.messages, userMessage(text), assistantDraft()] }, status: "streaming", abort: controller });
    try {
      await streamChat(
        { message: text, environment: ctx.environment, ...(ctx.owner ? { owner: ctx.owner } : {}), ...(start.threadId ? { threadId: start.threadId } : {}), ...(ctx.fence ? { fence: ctx.fence } : {}) },
        (event) => set({ convo: reduce(get().convo, event) }),
        controller.signal,
      );
      const convo = reduce(get().convo, { event: "done", data: { threadId: get().convo.threadId ?? "", stopReason: "end" } });
      set({ convo, status: "idle", abort: null });
      if (convo.threadId) {
        const firstUser = convo.messages.find((m) => m.role === "user");
        const entry: ThreadSummary = { id: convo.threadId, title: titleOf(firstUser?.text ?? text), at: Date.now() };
        const threads = [entry, ...get().threads.filter((t) => t.id !== entry.id)].slice(0, 40);
        writeStorage(THREADS_KEY, JSON.stringify(threads));
        set({ threads });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        set({ convo: reduce(get().convo, { event: "done", data: { threadId: get().convo.threadId ?? "", stopReason: "stopped" } }), status: "idle", abort: null });
        return;
      }
      set({ convo: reduce(get().convo, { event: "error", data: { code: "NETWORK", message: (error as Error).message || "Lyko could not be reached." } }), status: "error", abort: null });
    }
  },
  stop: () => get().abort?.abort(),
  fresh: () => {
    get().abort?.abort();
    set({ convo: EMPTY, status: "idle", abort: null });
  },
  openThread: (id) => {
    if (get().convo.threadId === id) return;
    get().abort?.abort();
    set({ convo: { ...EMPTY, threadId: id }, status: "idle" });
  },
}));
