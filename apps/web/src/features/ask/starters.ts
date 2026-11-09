/**
 * Ask Lyko's starting points and the composer's guidance (pure).
 *
 * A starter either asks a question as it is, or fills the composer with a
 * sentence that has blanks ("Send [amount] USDC to [who]"): the first blank
 * is selected so typing replaces it, Tab jumps to the next. While the user
 * types, `composerHint` names what a sentence still lacks (an amount, a
 * token, a destination) in plain words. Follow-ups after an answer are drawn
 * from what the answer showed. Nothing here invents a figure.
 */
import type { ChatMessage } from "./model";

export type StarterIcon = "earn" | "send" | "bridge" | "watch" | "have" | "can";

export interface Starter {
  readonly id: string;
  readonly label: string;
  readonly icon: StarterIcon;
  /** "fill" drops the sentence into the composer; "ask" sends it at once. */
  readonly kind: "fill" | "ask";
  readonly text: string;
  /** What the tile says it will do, in a few words. */
  readonly line: string;
}

/** Things to do: each fills the composer with blanks to finish. */
export const DO_STARTERS: readonly Starter[] = [
  { id: "earn", label: "Earn", icon: "earn", kind: "fill", text: "Put [amount] USDC to work at low risk", line: "Morpho or Aave V4 on Arc" },
  { id: "send", label: "Send", icon: "send", kind: "fill", text: "Send [amount] USDC to [who]", line: "Address, name or @contact" },
  { id: "bridge", label: "Bridge", icon: "bridge", kind: "fill", text: "Bridge [amount] USDC to [chain]", line: "CCTP to another chain" },
  { id: "watch", label: "Watch", icon: "watch", kind: "fill", text: "Tell me if EURC drops below [price]", line: "A price or a loan's health" },
];

/** Questions: one tap asks them. */
export const ASK_STARTERS: readonly Starter[] = [
  { id: "have", label: "What do I have?", icon: "have", kind: "ask", text: "Where is my money and what is it doing?", line: "Read live from Arc" },
  { id: "can", label: "What can you do?", icon: "can", kind: "ask", text: "What can you do?", line: "Everything, in one card" },
];

const BLANK = /\[[^\][]{1,24}\]/g;

/** The blanks still in a sentence, in order. */
export function blanks(text: string): { readonly start: number; readonly end: number; readonly name: string }[] {
  return [...text.matchAll(BLANK)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, name: m[0].slice(1, -1) }));
}

/** The next blank at or after `from`, wrapping to the first; null when none is left. */
export function nextBlank(text: string, from = 0): { readonly start: number; readonly end: number; readonly name: string } | null {
  const all = blanks(text);
  return all.find((b) => b.start >= from) ?? all[0] ?? null;
}

export interface ComposerHint {
  readonly tone: "todo" | "ready" | "question";
  readonly text: string;
}

const TOKEN = /\b(usdc|eurc|usyc|cirbtc|btc|bitcoin|eth|weth)\b/i;
const AMOUNT = /(\$\s?\d|\d[\d,.]*\s?(k|usdc|eurc|usd|dollars?|%)?|\b(all|half|idle|everything|the rest)\b)/i;
const ADDRESS = /0x[0-9a-f]{40}/i;
const QUESTION = /^(what|where|how|why|when|which|who|can|could|is|am|are|do|does|should|will|tell me about|explain|show)\b/i;
const CHAINS = /\b(base|arbitrum|ethereum|optimism|polygon|avalanche|solana|unichain|linea|sonic|world ?chain|sei|codex|ink|plume|hyperevm|mainnet)\b/i;

function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What the sentence still needs, in plain words, or a calm "ready" line.
 * Null for an empty box: the placeholder speaks then.
 */
export function composerHint(raw: string): ComposerHint | null {
  const text = raw.trim();
  if (!text) return null;
  const open = blanks(text);
  if (open.length > 0) return { tone: "todo", text: `Fill in ${list(open.map((b) => b.name))}. Tab jumps to the next blank.` };
  if (text.endsWith("?") || QUESTION.test(text)) return { tone: "question", text: "A question: Lyko answers from live data. Nothing moves." };
  const missing: string[] = [];
  if (/\b(send|pay|transfer)\b/i.test(text)) {
    if (!AMOUNT.test(text)) missing.push("an amount");
    if (!TOKEN.test(text) && !/\$\s?\d/.test(text)) missing.push("a token (USDC or EURC)");
    if (!ADDRESS.test(text) && !/@\w/.test(text) && !/\bto\s+\S+/i.test(text)) missing.push("who gets it");
  } else if (/\bbridge\b/i.test(text)) {
    if (!AMOUNT.test(text)) missing.push("an amount");
    if (!CHAINS.test(text)) missing.push("the chain it goes to");
  } else if (/\b(convert|swap|exchange)\b/i.test(text)) {
    if (!AMOUNT.test(text)) missing.push("an amount");
    if (!/\b(to|into|for)\s+(usdc|eurc|usyc|cirbtc)\b/i.test(text)) missing.push("the token you want");
  } else if (/\b(earn|put .* to work|deposit|invest|lend|supply)\b/i.test(text)) {
    if (!AMOUNT.test(text)) missing.push("how much");
  } else if (/\b(tell me|alert|watch|let me know|notify)\b/i.test(text)) {
    if (!/\d/.test(text)) missing.push("the level to watch for");
  }
  if (missing.length > 0) return { tone: "todo", text: `Add ${list(missing)}, or plan it and Lyko will ask.` };
  return { tone: "ready", text: "Lyko plans it under your Fence. You review and sign; nothing moves before." };
}

/** The send button's word: "Ask" for a question, "Plan it" for something to do. */
export function sendWord(raw: string): string {
  const hint = composerHint(raw);
  return hint?.tone === "question" ? "ASK" : "PLAN IT";
}

/** The single next step an answer leads to. */
export type NextStep =
  | { readonly kind: "review"; readonly index: number }
  | { readonly kind: "choose" }
  | { readonly kind: "fold"; readonly href: string; readonly label: string }
  | { readonly kind: "none" };

export function nextStep(m: ChatMessage): NextStep {
  if (m.streaming || m.role !== "assistant") return { kind: "none" };
  const reviewable = m.proposals.findIndex((p) => Boolean(p.intentId));
  if (reviewable >= 0) return { kind: "review", index: reviewable };
  if (m.clarify && m.clarify.options.length > 0) return { kind: "choose" };
  const herded = (m.blocks ?? []).find((b) => b.kind === "herded");
  if (herded || (m.drafts ?? []).length > 0) return { kind: "fold", href: "/app/fold/herding", label: "See it in the Fold" };
  if ((m.blocks ?? []).some((b) => b.kind === "positions" || b.kind === "balance")) return { kind: "fold", href: "/app/fold/flock", label: "Manage it in the Fold" };
  return { kind: "none" };
}

/** Two or three follow-ups that fit what the answer showed; a starter fills, a question asks. */
export function followUps(m: ChatMessage): readonly Starter[] {
  if (m.streaming || m.role !== "assistant" || m.error) return [];
  const kinds = new Set((m.blocks ?? []).map((b) => b.kind));
  const pick = (...ids: string[]) => ids.map((id) => [...DO_STARTERS, ...ASK_STARTERS, ...EXTRA].find((s) => s.id === id)).filter((s): s is Starter => Boolean(s)).slice(0, 3);
  if (m.proposals.length > 0 || m.program) return pick("have", "watch-plan");
  if (kinds.has("yields")) {
    const token = (m.blocks ?? []).find((b) => b.kind === "yields");
    const sym = token && token.kind === "yields" ? token.token : "USDC";
    return [{ id: "earn-token", label: `Put ${sym} to work`, icon: "earn", kind: "fill", text: `Put [amount] ${sym} to work at low risk`, line: "" }, ...pick("have")];
  }
  if (kinds.has("positions") || kinds.has("balance")) return pick("earn", "stress", "watch-health");
  if (kinds.has("capabilities")) return pick("send", "earn", "have");
  if (kinds.has("stress")) return pick("watch-health", "have");
  return pick("have", "can");
}

const EXTRA: readonly Starter[] = [
  { id: "stress", label: "What if EURC drops 5%?", icon: "watch", kind: "ask", text: "What if EURC drops 5%?", line: "" },
  { id: "watch-health", label: "Watch my loan's health", icon: "watch", kind: "fill", text: "Tell me if my health factor drops below [level]", line: "" },
  { id: "watch-plan", label: "Watch a price", icon: "watch", kind: "fill", text: "Tell me if EURC drops below [price]", line: "" },
];
