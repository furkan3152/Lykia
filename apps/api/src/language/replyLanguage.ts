/**
 * Lyko answers in the owner's interface language (the language picked in
 * the app), whatever language the owner writes in. Owners may write in any
 * language and are understood: the model reads it, and the deterministic
 * reader parses common English, Turkish, Spanish, Portuguese, French and
 * Chinese phrasings. Every model prompt carries the rule as a placeholder;
 * the model client fills it in with the request's language just before the
 * call, so one prompt serves every language.
 */
import { LOCALE_ENGLISH_NAMES, type Locale } from "@lykia/core";
import type { LlmClient } from "../agents/llm.js";

/** Stands in prompts for the reply-language rule of the request being served. */
export const REPLY_LANGUAGE = "[[lykia:reply-language]]";
/** Stands in prompts for the question-language rule (compiler questions). */
export const QUESTION_LANGUAGE = "[[lykia:question-language]]";

/** How each language writes 1234.56 and 4.05%, for the model's figures. */
const NUMBER_STYLE: Readonly<Record<Locale, string>> = {
  en: "1,234.56 and 4.05%",
  tr: "1.234,56 and %4,05",
  es: "1.234,56 and 4,05 %",
  "pt-BR": "1.234,56 and 4,05%",
  "zh-CN": "1,234.56 and 4.05%",
  fr: "1 234,56 and 4,05 %",
};

const KEEP = "Keep these names exactly as written, never translated: Lykia, Lyko, Ask Lyko, The Fold, The Forge, the Fence, Leash, Whistle, Stile, Autopilot, Herding, Flock, Trails, Pack, the League; token, protocol and chain names (USDC, EURC, cirBTC, Morpho, Aave V4, CCTP, Gateway, Arc, Base, Ethereum); addresses and transaction hashes.";

/** The rule for answers: the interface language only, never mixed. */
export function replyLanguageRule(locale: Locale): string {
  const name = LOCALE_ENGLISH_NAMES[locale];
  if (locale === "en") return `Always write your reply in English, the owner's interface language, whatever language the owner writes in. Understand input in any language, but never answer in another language and never mix languages in one answer. Tool results are in English data; say what they mean in English.`;
  return `Always write your whole reply in ${name}, the owner's interface language, whatever language the owner writes in (English, Turkish or any other). Understand input in any language, but every sentence, label, bullet and "**Next:**" line you write is in ${name}; never mix in English or another language, even when the owner writes in it. Tool results are English data: say what they mean in natural ${name}, as a ${name} finance app would. Write "**Next:**" as the ${name} word for next, in bold. ${KEEP} Write figures the ${name} way (${NUMBER_STYLE[locale]}) with the same value and the same digits.`;
}

/** The rule for questions a model writes for the owner (the compiler, /v1/ai/route). */
export function questionLanguageRule(locale: Locale): string {
  return `Write every question in ${LOCALE_ENGLISH_NAMES[locale]}, the owner's interface language, whatever language the owner wrote in.`;
}

/** Fills the language placeholders of a prompt for the request's language. */
export function withReplyLanguage(system: string, locale: Locale): string {
  if (typeof system !== "string") return system;
  return system.split(REPLY_LANGUAGE).join(replyLanguageRule(locale)).split(QUESTION_LANGUAGE).join(questionLanguageRule(locale));
}

/** The English rule, as English requests see it. */
export const ENGLISH_REPLY_RULE = replyLanguageRule("en");

/** A model client whose prompts get their language placeholders filled with the request's language (a no-op on prompts already filled). */
export function inReplyLanguage(client: LlmClient, locale: () => Locale): LlmClient {
  return { model: client.model, turn: (request) => client.turn({ ...request, system: withReplyLanguage(request.system, locale()) }) };
}
