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
import { intlTag } from "../i18n/format.js";
import type { AnswerBlock } from "@lykia/core/api/answer";
import { dropSentences } from "./numberGuard.js";

import { tx } from "@lykia/core";
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

/** Words that make "your wallet" a request ("connect your wallet"), a negation ("not your money") or a promise ("once your wallet ..."), never a claim. */
const NOT_A_CLAIM = /\b(?:connect(?:ing|ed|s)?|link(?:ing)?|sign(?:ing)? in with|switch(?:ing)?|open(?:ing)?|use|using|not|never|isn't|aren't|once|when|until|after|with|from|to)\s+(?:to\s+)?$/iu;
const HOLDINGS = "money|funds|balances?|holdings|positions?|loans?|debts?|collateral|portfolio|net worth";

/**
 * For the sample address: claims that the reader owns what was read are rewritten, and nothing else. "Your money is
 * in Aave" and "you hold 187 USDC" become the sample wallet's; "connect your wallet", "not your money", "your
 * account" and "your Fence" are left as they are.
 */
export function sampleWording(text: string): string {
  const claim = (re: RegExp, to: (m: string, ...g: string[]) => string) => (input: string) =>
    input.replace(re, (...args: unknown[]) => {
      const m = args[0] as string;
      const offset = args[args.length - 2] as number;
      const whole = args[args.length - 1] as string;
      const before = whole.slice(Math.max(0, offset - 40), offset);
      if (NOT_A_CLAIM.test(before)) return m;
      return to(m, ...(args.slice(1, -2) as string[]));
    });
  const cap = (s: string, like: string) => (/^[A-Z]/u.test(like) ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s);
  const steps = [
    // "Your wallet holds 187 USDC", "your wallet has", "your wallet is worth": the wallet is the sample's.
    claim(/\b[Yy]our wallet(?= (?:holds|has|contains|is worth|shows|carries|keeps))/gu, (m) => cap("the sample wallet", m)),
    // "in your wallet": money sitting there.
    claim(/\bin your wallet\b/gu, () => "in the sample wallet"),
    // "your money is in Aave", "your positions", "your loan".
    claim(new RegExp(`\\b[Yy]our (${HOLDINGS})\\b`, "gu"), (m, what) => cap(`the sample wallet's ${what}`, m)),
    // "your USDC sits idle": a token named as owned, followed by what it is doing.
    claim(/\b[Yy]our (USDC|EURC|cirBTC|WETH)(?= (?:sits|is|earns|has|was|balance))/gu, (m, what) => cap(`the sample wallet's ${what}`, m)),
    // "You hold 187 USDC", "you have 3 positions", "you owe 600 USDC".
    claim(/\b[Yy]ou (hold|own|owe|have)(?= (?:\$?\d|no |nothing|a loan|loans|positions?|an? \w+ position))/gu, (m, verb) => cap(`the sample wallet ${verb === "have" ? "has" : `${verb}s`}`, m)),
  ];
  return steps.reduce((out, step) => step(out), text);
}

export interface ProseOptions {
  /** The answer is about the sample address (no wallet connected). */
  readonly sample?: boolean;
}

/** Cleans a model's prose: internals and self-comments dropped, self-references and sample wording rewritten. */
/** A price shown with more decimals than anyone reads ("$1.11923186") is rounded: four places under $10, two above. */
export function roundPrices(text: string): string {
  return text.replace(/(\$\s?)(\d+)\.(\d{5,})(?!\d)/gu, (_m, sign: string, int: string, frac: string) => {
    const v = Number(`${int}.${frac}`);
    return `${sign}${v < 10 ? v.toFixed(4) : v.toFixed(2)}`;
  });
}

export function cleanProse(text: string, options: ProseOptions = {}): string {
  if (!text) return text;
  let out = dropSentences(roundPrices(text), (s) => namesInternals(s) || commentsOnItself(s));
  out = selfReference(out);
  if (options.sample) out = sampleWording(out);
  // A leftover placeholder (from text a model copied out of an old turn) takes its sentence with it.
  if (PLACEHOLDER.test(out)) out = dropSentences(out, (s) => PLACEHOLDER.test(s));
  return out.replace(/[ \t]+\n/gu, "\n").trim();
}

const dollars = (v: string) => `$${Number(v).toLocaleString(intlTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The answer code writes when a model's prose did not survive: the plan on screen first, then the cards. */
export function summaryOfTurn(blocks: readonly AnswerBlock[], proposals: readonly { readonly decision: string; readonly steps: readonly string[]; readonly reasons: readonly string[] }[]): string {
  const p = proposals[0];
  if (p) {
    if (p.decision === "deny") return tx("The Fence said no to this plan.\n\n{reasons}\n\n**Next:** ask for less, or change the rule in your Fence.", { reasons: p.reasons.slice(0, 2).map((r) => `- ${r}`).join("\n") }).replace(/\n\n\n/gu, "\n\n");
    const steps = proposals.flatMap((x) => x.steps);
    return tx("The plan is ready to review: {length, plural, one {# step} other {# steps}}, checked against your Fence.\n\n{value2}\n\n**Next:** review it on the card and sign it in your wallet.", { length: steps.length, value2: steps.slice(0, 3).map((st) => `- ${st}`).join("\n") });
  }
  return summaryFromBlocks(blocks);
}

/**
 * A short answer written by code from the cards of a turn, for when a model's prose did not survive the checks. Every
 * figure here is copied from a card.
 */
export function summaryFromBlocks(blocks: readonly AnswerBlock[]): string {
  for (const b of blocks) {
    if (b.kind === "positions") return tx("{value}{value2}\n\n**Next:** say what the money should do, or ask about one position.", { value: b.netUsd !== null ? tx("Net worth is {amount} across the positions on the card.", { amount: dollars(b.netUsd) }) : tx("The positions are on the card; some have no price, so there is no total."), value2: b.lowestHealth ? tx("\n\n- **Lowest health:** {value}", { value: Number(b.lowestHealth).toFixed(2) }) : "" });
    if (b.kind === "balance") return tx("{value}\n\n**Next:** say what the money should do.", { value: b.totalUsd !== null ? tx("The holdings on the card are worth {amount}.", { amount: dollars(b.totalUsd) }) : tx("The holdings are on the card; some have no price, so there is no total.") });
    if (b.kind === "gas") return tx("Gas is {balance} USDC against a floor of {floor} USDC.\n\n**Next:** {value}", { balance: b.balance, floor: b.floor, value: Number(b.balance) < Number(b.floor) ? tx("top it up before planning.") : tx("nothing to do.") });
    if (b.kind === "rate") return tx("1 {base} buys {rate} {quote}.\n\n**Next:** say an amount to convert.", { base: b.base, rate: b.rate, quote: b.quote });
    if (b.kind === "facts" && b.rows[0]) return tx("{label}: {value}. The card has the rest, each with its source.\n\n**Next:** ask about any line on the card.", { label: b.rows[0].label, value: b.rows[0].value });
    if (b.kind === "yields") return tx("The live rates are on the card, best first, each with its source.\n\n**Next:** say how much should go to work.");
  }
  return blocks.length > 0 ? tx("The figures are on the card below, each with its source.\n\n**Next:** ask about any line on it.") : tx("I could not read a figure I can stand behind for that.\n\n**Next:** ask again in a moment, or ask it another way.");
}
