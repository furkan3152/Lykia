/**
 * The conversation model (pure): folds chat events into messages, so the
 * store, the tests and the replay of a stored thread share one reducer.
 */
import type { AgentProposal, AnswerBlock, ChatDraftLink, ChatEvent, ChatProgramView, ChatStep, ThreadMessage } from "@lykia/core/api/agents";
import { MAX_BLOCKS, parseAnswerBlock, parseAnswerBlocks, parseChatStep } from "@lykia/core/api/answer";

export interface TrailItem {
  readonly label: string;
  readonly ok: boolean;
  /** Why a step failed, in plain words (shown under the reply). */
  readonly detail?: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly trail: readonly TrailItem[];
  readonly proposals: readonly AgentProposal[];
  readonly clarify: { readonly question: string; readonly options: readonly string[] } | null;
  /** Alerts and automations Lyko saved, or links to their prefilled forms. */
  readonly drafts?: readonly ChatDraftLink[];
  /** A compiled program (goal language): Now, Scheduled, Assumptions and the why. */
  readonly program?: ChatProgramView;
  readonly streaming: boolean;
  readonly error?: string;
  /** Lyko at work: the server's steps, each upserted by id as it starts and ends. */
  readonly steps?: readonly ChatStep[];
  /** Typed cards for this answer (gas, Fence gate, balance, rate, herded, settled). */
  readonly blocks?: readonly AnswerBlock[];
  /** What Lyko said between tool calls (the model path), shown inside the opened trail. */
  readonly notes?: readonly string[];
  /** When the turn started and ended (client clock), for "Checked 4 things · 1.8s". */
  readonly startedAt?: number;
  readonly endedAt?: number;
  /** A hand-off between Lyko on watch and Ask Lyko this message carries (who sent what). */
  readonly instruction?: ThreadMessage["instruction"];
  /** Said about the Fold's sample flock (nobody signed in): shown in the Fold, never in the Ask thread. */
  readonly fixture?: boolean;
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

export function assistantDraft(now: number = Date.now()): ChatMessage {
  return { id: nid(), role: "assistant", text: "", trail: [], proposals: [], clarify: null, streaming: true, steps: [], blocks: [], notes: [], startedAt: now };
}

/** A message read back from a saved thread, shaped for the thread renderer (its cards are validated again). */
export function storedMessage(m: ThreadMessage, id: string): ChatMessage {
  return { id, role: m.role, text: m.text, trail: [], proposals: m.proposals ?? [], blocks: parseAnswerBlocks(m.blocks), clarify: null, streaming: false, ...(m.instruction ? { instruction: m.instruction } : {}) };
}

/** Upserts a step by id: a start adds it, its end replaces it in place. */
function upsertStep(steps: readonly ChatStep[], step: ChatStep): ChatStep[] {
  const i = steps.findIndex((x) => x.id === step.id);
  if (i < 0) return [...steps, step].slice(-40);
  const next = steps.slice();
  next[i] = step;
  return next;
}

/** Adds a block unless the same card is already there; at most MAX_BLOCKS. */
function addBlock(blocks: readonly AnswerBlock[], block: AnswerBlock): AnswerBlock[] {
  const key = JSON.stringify(block);
  if (blocks.some((b) => JSON.stringify(b) === key) || blocks.length >= MAX_BLOCKS) return blocks.slice();
  return [...blocks, block];
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
    case "thread": {
      // A turn about the Fold's sample flock keeps to the Fold: it is marked, and it does not move the Ask thread.
      if (e.data.fixture) return { ...c, mode: e.data.mode, messages: c.messages.map((m, i) => (i >= c.messages.length - 2 ? { ...m, fixture: true } : m)) };
      return { ...c, threadId: e.data.threadId, mode: e.data.mode };
    }
    case "reading":
      return patchLast(c, (m) => ({ ...m, trail: [...m.trail, { label: e.data.what, ok: e.data.ok }] }));
    case "task":
      return patchLast(c, (m) => ({ ...m, trail: [...m.trail, { label: `${e.data.agent}: ${e.data.task}`, ok: true }] }));
    case "tool":
      return patchLast(c, (m) => ({ ...m, trail: [...m.trail, { label: `${e.data.agent} · ${e.data.name}`, ok: e.data.ok, ...(e.data.ok || !e.data.summary ? {} : { detail: e.data.summary }) }] }));
    case "thinking-summary":
      return patchLast(c, (m) => ({ ...m, notes: [...(m.notes ?? []), e.data.text].slice(-8) }));
    case "step": {
      const step = parseChatStep(e.data);
      return step ? patchLast(c, (m) => ({ ...m, steps: upsertStep(m.steps ?? [], step) })) : c;
    }
    case "block": {
      const block = parseAnswerBlock(e.data);
      return block ? patchLast(c, (m) => ({ ...m, blocks: addBlock(m.blocks ?? [], block) })) : c;
    }
    case "proposal":
      return patchLast(c, (m) => ({ ...m, proposals: [...m.proposals, e.data] }));
    case "clarify":
      return patchLast(c, (m) => ({ ...m, clarify: e.data }));
    case "draft":
      return draftLinkOk(e.data) ? patchLast(c, (m) => ({ ...m, drafts: [...(m.drafts ?? []), e.data] })) : c;
    case "program":
      return programViewOk(e.data) ? patchLast(c, (m) => ({ ...m, program: e.data })) : c;
    case "text":
      return patchLast(c, (m) => ({ ...m, text: m.text + e.data.text }));
    case "error":
      return patchLast(c, (m) => ({ ...m, error: e.data.message, streaming: false, endedAt: m.endedAt ?? Date.now() }));
    case "done":
      return patchLast({ ...c, threadId: c.messages[c.messages.length - 1]?.fixture ? c.threadId : (e.data.threadId ?? c.threadId) }, (m) => ({ ...m, streaming: false, endedAt: m.endedAt ?? Date.now(), steps: (m.steps ?? []).map((st) => (st.state === "running" ? { ...st, state: "warn" as const, result: st.result ?? "Stopped before it finished" } : st)) }));
    default:
      return c;
  }
}

/** A program view is shown only when its shape is sane and every link stays inside the app. */
export function programViewOk(v: ChatProgramView): boolean {
  if (!v || typeof v.programHash !== "string" || !Array.isArray(v.scheduled) || !Array.isArray(v.assumptions)) return false;
  return v.scheduled.every((s) => typeof s.href === "string" && IN_APP.test(s.href));
}

/** An in-app link: a page, optionally with one draft, filter or leash parameter. */
const IN_APP = /^\/app(?:\/[a-z-]+){0,2}(?:\?(?:draft|show|leash)=[A-Za-z0-9_-]+)?$/u;

/** Only in-app links are shown as buttons: Herding's Running list, or a draft link (it opens Ask Lyko with what it carried). */
function draftLinkOk(d: ChatDraftLink): boolean {
  if (!d || (d.kind !== "alert" && d.kind !== "automation") || typeof d.href !== "string" || typeof d.label !== "string") return false;
  return IN_APP.test(d.href);
}

/** "Lyko on watch → Ask Lyko · plan": the compact line over a hand-off message. */
export function handoffLine(i: NonNullable<ChatMessage["instruction"]>): string {
  const name = { watch: "Lyko on watch", ask: "Ask Lyko" } as const;
  return `${name[i.from]} → ${name[i.to]} · ${i.kind === "plan" ? "plan" : "watch task"}`;
}

/** Plain-language reasons from failed steps, de-duplicated, for the reply bubble. */
export function failureReasons(m: Pick<ChatMessage, "trail" | "text">): string[] {
  const seen = new Set<string>();
  for (const t of m.trail) {
    const d = t.detail?.trim();
    if (d && !t.ok && !m.text.includes(d)) seen.add(d);
  }
  return [...seen];
}

/** The conversation as Ask Lyko shows it: everything except what was said about the Fold's sample flock. */
export function askMessages(c: Conversation): readonly ChatMessage[] {
  return c.messages.some((m) => m.fixture) ? c.messages.filter((m) => !m.fixture) : c.messages;
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
