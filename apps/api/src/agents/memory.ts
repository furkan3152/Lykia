/** Thread memory: per-owner conversations in the store (last 40 messages kept, 30 days). */
import type { Address, ArcEnvironment } from "@lykia/core";
import type { AgentProposal, AnswerBlock, ThreadMessage, ThreadView } from "@lykia/core/api/agents";
import { parseAnswerBlocks } from "@lykia/core/api/answer";
import type { ThreadSummaryView } from "@lykia/core/api/fold";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "../platform/typed.js";
import { randomHex } from "../platform/crypto.js";

const MAX_THREAD_MESSAGES = 40;
const THREAD_TTL_MS = 30 * 86_400_000;

const threads = (ctx: AppContext) => typedCollection<ThreadView>(ctx, "agent_threads");

/** Thread ids carry the owner so listing is a prefix scan. Anonymous threads use "anon". */
function ownerKey(owner: Address | null): string {
  return owner ? owner.toLowerCase() : "anon";
}

export async function openThread(ctx: AppContext, owner: Address | null, environment: ArcEnvironment, threadId: string | undefined, firstMessage: string): Promise<ThreadView> {
  if (threadId) {
    const doc = await threads(ctx).get(threadId);
    if (!doc || !threadId.startsWith(`${ownerKey(owner)}:`)) throw new LykiaHttpError("NOT_FOUND", 404, "No such thread for this owner.");
    return doc.value;
  }
  const now = new Date(ctx.clock.now()).toISOString();
  const thread: ThreadView = { id: `${ownerKey(owner)}:thr_${randomHex(6)}`, owner: (owner ?? "0x0000000000000000000000000000000000000000") as Address, environment, title: firstMessage.slice(0, 80), createdAt: now, updatedAt: now, messages: [] };
  await threads(ctx).put(thread.id, thread, { ttlMs: THREAD_TTL_MS });
  return thread;
}

export async function appendMessages(ctx: AppContext, thread: ThreadView, entries: readonly { role: "user" | "assistant"; text: string; proposals?: readonly AgentProposal[]; blocks?: readonly AnswerBlock[]; origin?: "ask" | "fold" }[]): Promise<ThreadView> {
  const at = new Date(ctx.clock.now()).toISOString();
  // Ask Lyko and Lyko on watch write to the same thread; re-read it so neither drops the other's turn.
  const latest = (await threads(ctx).get(thread.id).catch(() => null))?.value ?? thread;
  const messages: ThreadMessage[] = [...latest.messages, ...entries.map((e) => ({ role: e.role, text: e.text.slice(0, 8_000), at, ...(e.proposals && e.proposals.length > 0 ? { proposals: e.proposals } : {}), ...(e.blocks && e.blocks.length > 0 ? { blocks: parseAnswerBlocks(e.blocks) } : {}), ...(e.origin === "fold" ? { origin: "fold" as const } : {}) }))].slice(-MAX_THREAD_MESSAGES);
  const next: ThreadView = { ...latest, messages, updatedAt: at };
  await threads(ctx).put(thread.id, next, { ttlMs: THREAD_TTL_MS });
  return next;
}

export async function listThreads(ctx: AppContext, owner: Address): Promise<Omit<ThreadView, "messages">[]> {
  return (await threads(ctx).list({ prefix: `${ownerKey(owner)}:`, limit: 200 }))
    .map(({ value: { messages: _m, ...rest } }) => rest)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The shared threads as the rail and the Fold list them: size, the last line and where it was written. */
export async function threadSummaries(ctx: AppContext, owner: Address, limit = 50): Promise<ThreadSummaryView[]> {
  return (await threads(ctx).list({ prefix: `${ownerKey(owner)}:`, limit: 200 }))
    .map(({ value: t }) => {
      const last = t.messages[t.messages.length - 1];
      return { id: t.id, title: t.title, environment: t.environment, createdAt: t.createdAt, updatedAt: t.updatedAt, messages: t.messages.length, last: last ? last.text.slice(0, 140) : null, origin: last?.origin === "fold" ? ("fold" as const) : ("ask" as const) };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export async function getThread(ctx: AppContext, owner: Address, id: string): Promise<ThreadView> {
  const doc = await threads(ctx).get(id);
  if (!doc || !id.startsWith(`${ownerKey(owner)}:`)) throw new LykiaHttpError("NOT_FOUND", 404, "No such thread for this owner.");
  return doc.value;
}
