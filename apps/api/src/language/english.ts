/**
 * Lykia answers in English. Owners may write in any language and are
 * understood (the model reads it; the deterministic reader parses common
 * Turkish, Spanish, German and French phrasings), but every reply, question,
 * explanation and card is English. Every model prompt carries this rule.
 */
export const ENGLISH_REPLY_RULE =
  "Always write your reply in English, whatever language the owner writes in. Understand input in any language, but never answer in another language, even when the owner writes in it or asks for it.";

/** Text for prompts that produce owner-facing questions (the compiler, /v1/ai/route). */
export const ENGLISH_QUESTION_RULE = "Write every question in English, whatever language the owner wrote in.";
