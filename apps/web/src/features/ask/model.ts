/**
 * The conversation model (pure): folds chat events into messages, so the
 * store, the tests and the replay of a stored thread share one reducer.
 */
import type { AgentProposal, ChatEvent } from "@lykia/core/api/agents";

export interface TrailItem {
  readonly label: string;
  readonly ok: boolean;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly trail: readonly TrailItem[];
  readonly proposals: readonly AgentProposal[];
  readonly clarify: { readonly question: string; readonly options: readonly string[] } | null;
  readonly streaming: boolean;
  readonly error?: string;
}

export interface Conversation {
  readonly threadId: string | null;
  readonly mode: "llm" | "reader" | null;
  readonly messages: readonly ChatMessage[];
}

export const EMPTY: Conversation = { threadId: null, mode: null, messages: [] };

let seq = 0;
const nid = () => `m${Date.now().toString(36)}${(seq += 1)}`;

export function userMessage(text: string): ChatMessage {
  return { id: nid(), role: "user", text, trail: [], proposals: [], clarify: null, streaming: false };
}

export function assistantDraft(): ChatMessage {
  return { id: nid(), role: "assistant", text: "", trail: [], proposals: [], clarify: null, streaming: true };
}

function patchLast(c: Conversation, fn: (m: ChatMessage) => ChatMessage): Conversation {
  const messages = c.messages.slice();
  const i = messages.length - 1;
  if (i < 0 || messages[i]!.role !== "assistant") return c;
  messages[i] = fn(messages[i]!);
  return { ...c, messages };
}

export function reduce(c: Conversation, e: ChatEvent): Conversation {
  switch (e.event) {
    case "thread":
      return { ...c, threadId: e.data.threadId, mode: e.data.mode };
    case "reading":
      return patchLast(c, (m) => ({ ...m, trail: [...m.trail, { label: e.data.what, ok: e.data.ok }] }));
    case "task":
      return patchLast(c, (m) => ({ ...m, trail: [...m.trail, { label: `${e.data.agent}: ${e.data.task}`, ok: true }] }));
    case "tool":
      return patchLast(c, (m) => ({ ...m, trail: [...m.trail, { label: `${e.data.agent} · ${e.data.name}`, ok: e.data.ok }] }));
    case "thinking-summary":
      return patchLast(c, (m) => ({ ...m, trail: [...m.trail, { label: `${e.data.agent}: ${e.data.text}`, ok: true }] }));
    case "proposal":
      return patchLast(c, (m) => ({ ...m, proposals: [...m.proposals, e.data] }));
    case "clarify":
      return patchLast(c, (m) => ({ ...m, clarify: e.data }));
    case "text":
      return patchLast(c, (m) => ({ ...m, text: m.text + e.data.text }));
    case "error":
      return patchLast(c, (m) => ({ ...m, error: e.data.message, streaming: false }));
    case "done":
      return patchLast({ ...c, threadId: e.data.threadId ?? c.threadId }, (m) => ({ ...m, streaming: false }));
    default:
      return c;
  }
}

/** The latest proposal in the conversation (the artifact panel shows it). */
export function latestProposal(c: Conversation): AgentProposal | null {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const p = c.messages[i]!.proposals;
    if (p.length > 0) return p[p.length - 1]!;
  }
  return null;
}

/** A thread title from its first message. */
export function titleOf(text: string): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 46)}…` : clean || "New thread";
}
