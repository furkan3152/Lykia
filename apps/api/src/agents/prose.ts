/**
 * The last pass over anything Lyko says, in code. A model's prose is checked
 * and repaired sentence by sentence, never patched inside a sentence:
 *
 *   - a sentence that names a tool or an internal term is dropped;
 *   - a sentence that comments on an earlier answer's data ("Correction:",
 *     "my earlier reply was stale") is dropped: Lyko states the figure it
 *     read now, with its block, and nothing about what it said before;
 *   - "Ask Lyko to ..." becomes the plain next step: Lyko is the one answering;
 *   - for the sample address, "your wallet" and the like are rewritten, since
 *     nothing here belongs to the reader.
 *
 * PLACEHOLDER lists the phrases an earlier number guard used to leave inside
 * sentences. They can never appear in an answer (tested).
 */
import type { AnswerBlock } from "@lykia/core/api/answer";
import { dropSentences } from "./numberGuard.js";

/** Phrases that mean a figure was cut out of a sentence. Never valid output. */
export const PLACEHOLDER = /\b(?:an amount|a rate) \(see the card\)|\b(?:an amount|a rate) that is unavailable right now|\bthe an? (?:amount|rate)\b/iu;

/** Tool names that read as ordinary words: internal only when written as code or called a tool. */
const WORDY_TOOLS = ["yields", "flock", "positions", "fence", "prices", "venues", "knowledge", "scent", "outrun", "capabilities", "delegate"];
/** Tool names and identifiers that are never ordinary words. */
const INTERNAL = /\b(?:plan_intent|show_card|ask_owner|compile_goal|draft_order|draft_automation|create_alert|create_leash|create_agent|turn_on_autopilot|add_autopilot_task|watch_position|read_instructions|get_insights|search_routes|stop_plan|tool_data|tool[_ ]?(?:call|result|use)s?|lykia-state|system prompt|readOnly|read-only mode|fixture)\b/iu;
const WORDY = new RegExp(`\`(?:${WORDY_TOOLS.join("|")})\`|\\bthe (?:${WORDY_TOOLS.join("|")}) tool\\b|\\b(?:with|using|via|call(?:ing)?|run(?:ning)?) \`[a-z_]+\``, "iu");
/** The Fence's mode stated as if it were the owner's ("Your mode is dry-run"). */
const MODE = /\b(?:your|the) mode is\b|\bmode[ =:]+(?:dry-run|live|whistle)\b|\bin dry-run mode\b/iu;
/** Remarks about an earlier answer or its data source. */
const SELF_COMMENT = /^\s*(?:\*\*)?correction\b|\b(?:my|the) (?:earlier|previous|prior|last|first) (?:reply|answer|message|read|response|figures?|numbers?)\b|\b(?:earlier|previously|before) i (?:said|stated|told|reported|showed)\b|\bi (?:said|stated|reported) (?:earlier|before|previously)\b|\bone of the two (?:is|was) stale\b|\bdid not match this read\b|\bcontradict(?:s|ed)? (?:my|the) (?:earlier|previous)\b/iu;

export function namesInternals(sentence: string): boolean {
  return INTERNAL.test(sentence) || WORDY.test(sentence) || MODE.test(sentence);
}

export function commentsOnItself(sentence: string): boolean {
  return SELF_COMMENT.test(sentence);
}

/** "Ask Lyko to plan the repay." -> "say “plan the repay”." Lyko never sends the owner to itself. */
function selfReference(text: string): string {
  return text
    .replace(/\b(ask|tell) Lyko(?: on watch)? to ([^.\n]+?)([.\n]|$)/giu, (_m, verb: string, what: string, end: string) => `${/^[A-Z]/u.test(verb) ? "Say" : "say"} “${what.trim()}”${end}`)
    .replace(/\b(?:open|go to|use|press Open in) Ask Lyko(?: and| to)?\b/giu, "say it here")
    .replace(/\bAsk Lyko plans it\b/giu, "I plan it here");
}

const SAMPLE_REWRITES: readonly (readonly [RegExp, string])[] = [
  [/\byour (?:own )?wallet\b/gu, "the sample wallet"],
  [/\bYour (?:own )?wallet\b/gu, "The sample wallet"],
  [/\byour ((?:Fence|fence|rules|caps?|limits?|(?:\d+(?:\.\d+)? )?(?:(?:health|liquidity|gas|cash) )?floor)\b)/gu, "the default $1"],
  [/\bYour ((?:Fence|fence|rules|caps?|limits?|(?:\d+(?:\.\d+)? )?(?:(?:health|liquidity|gas|cash) )?floor)\b)/gu, "The default $1"],
  [/\byour (money|funds|balances?|holdings|positions?|loans?|debt|collateral|portfolio|net worth|flock|Flock|fold|Fold|USDC|EURC|cirBTC|idle [A-Za-z]+|gas|health factor|vaults?|deposits?|liquidity)\b/gu, "the sample wallet's $1"],
  [/\bYour (money|funds|balances?|holdings|positions?|loans?|debt|collateral|portfolio|net worth|flock|Flock|fold|Fold|USDC|EURC|cirBTC|idle [A-Za-z]+|gas|health factor|vaults?|deposits?|liquidity)\b/gu, "The sample wallet's $1"],
  [/\byou (hold|have|own|owe|earn|borrowed|supplied|deposited)\b/gu, "the sample wallet $1s"],
  [/\bYou (hold|have|own|owe|earn|borrowed|supplied|deposited)\b/gu, "The sample wallet $1s"],
];
const THIRD_PERSON: Readonly<Record<string, string>> = { haves: "has", borroweds: "borrowed", supplieds: "supplied", depositeds: "deposited" };

/** For the sample address: nothing in the answer is "yours". */
export function sampleWording(text: string): string {
  let out = text;
  for (const [re, to] of SAMPLE_REWRITES) out = out.replace(re, to);
  return out.replace(/\b(haves|borroweds|supplieds|depositeds)\b/gu, (w) => THIRD_PERSON[w] ?? w);
}

export interface ProseOptions {
  /** The answer is about the sample address (no wallet connected). */
  readonly sample?: boolean;
}

/** Cleans a model's prose: internals and self-comments dropped, self-references and sample wording rewritten. */
export function cleanProse(text: string, options: ProseOptions = {}): string {
  if (!text) return text;
  let out = dropSentences(text, (s) => namesInternals(s) || commentsOnItself(s));
  out = selfReference(out);
  if (options.sample) out = sampleWording(out);
  // A leftover placeholder (from text a model copied out of an old turn) takes its sentence with it.
  if (PLACEHOLDER.test(out)) out = dropSentences(out, (s) => PLACEHOLDER.test(s));
  return out.replace(/[ \t]+\n/gu, "\n").trim();
}

const dollars = (v: string) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A short answer written by code from the cards of a turn, for when a model's prose did not survive the checks. Every
 * figure here is copied from a card.
 */
export function summaryFromBlocks(blocks: readonly AnswerBlock[]): string {
  for (const b of blocks) {
    if (b.kind === "positions") return `${b.netUsd !== null ? `Net worth is ${dollars(b.netUsd)} across the positions on the card.` : "The positions are on the card; some have no price, so there is no total."}${b.lowestHealth ? `\n\n- **Lowest health:** ${Number(b.lowestHealth).toFixed(2)}` : ""}\n\n**Next:** say what the money should do, or ask about one position.`;
    if (b.kind === "balance") return `${b.totalUsd !== null ? `The holdings on the card are worth ${dollars(b.totalUsd)}.` : "The holdings are on the card; some have no price, so there is no total."}\n\n**Next:** say what the money should do.`;
    if (b.kind === "gas") return `Gas is ${b.balance} USDC against a floor of ${b.floor} USDC.\n\n**Next:** ${Number(b.balance) < Number(b.floor) ? "top it up before planning." : "nothing to do."}`;
    if (b.kind === "rate") return `1 ${b.base} buys ${b.rate} ${b.quote}.\n\n**Next:** say an amount to convert.`;
    if (b.kind === "facts" && b.rows[0]) return `${b.rows[0].label}: ${b.rows[0].value}. The card has the rest, each with its source.\n\n**Next:** ask about any line on the card.`;
    if (b.kind === "yields") return "The live rates are on the card, best first, each with its source.\n\n**Next:** say how much should go to work.";
  }
  return blocks.length > 0 ? "The figures are on the card below, each with its source.\n\n**Next:** ask about any line on it." : "I could not read a figure I can stand behind for that.\n\n**Next:** ask again in a moment, or ask it another way.";
}
