/** Pure helpers behind the chat's cards (node tests load this file). */
import type { AnswerBlock, ChatDraftLink } from "@lykia/core/api/agents";
import { t } from "../../i18n";

export type HerdItem = Extract<AnswerBlock, { kind: "herded" }>["items"][number];

const RULE_NAMES: Readonly<Record<string, string>> = {
  "mode.whistle": t("ask.cardModel.theWhistle"),
  "mode.dry-run": t("ask.cardModel.dryRunMode"),
  fee: t("ask.cardModel.protocolFee"),
  environment: t("ask.cardModel.network"),
  signer: t("ask.cardModel.signer"),
  kinds: t("ask.cardModel.kindsOfMove"),
  venues: t("ask.cardModel.venues"),
  "tokens.allow": t("ask.cardModel.allowedTokens"),
  "tokens.unlisted": t("ask.cardModel.unlistedTokens"),
  scent: t("ask.cardModel.scent"),
  recipients: t("ask.cardModel.recipients"),
  bridges: t("ask.cardModel.bridges"),
  "caps.step": t("ask.cardModel.perStepCap"),
  "caps.intent": t("ask.cardModel.perPlanCap"),
  "caps.daily": t("ask.cardModel.dailyCap"),
  "caps.weekly": t("ask.cardModel.weeklyCap"),
  "limits.steps": t("ask.cardModel.stepLimit"),
  "limits.slippage": t("ask.cardModel.slippage"),
  "lending.health": t("ask.cardModel.healthFactor"),
  "fx.deviation": t("ask.cardModel.fxBand"),
  schedule: t("ask.cardModel.schedule"),
  "confirm.above": t("ask.cardModel.confirmAbove"),
  "confirm.external": t("ask.cardModel.externalRecipient"),
  "confirm.cross-chain": "Cross-chain",
  "confirm.agent": t("ask.cardModel.agentMove"),
  "confirm.unlisted": t("ask.cardModel.unlistedToken"),
  "beta.cap": t("ask.cardModel.betaCap"),
  "facts.unavailable": t("ask.cardModel.missingFacts"),
};

/** "caps.perStep" → "Per-step cap"; unknown rules keep their name, tidied. */
export function ruleName(rule: string): string {
  return RULE_NAMES[rule] ?? rule.replace(/[._-]+/gu, " ").replace(/^\w/u, (c) => c.toUpperCase());
}


/** Drafts from the stream (alerts, automations) as herded items. */
export function herdFromDrafts(drafts: readonly ChatDraftLink[]): HerdItem[] {
  return drafts.map((d) => ({ kind: d.kind, label: d.label, saved: d.saved, href: d.saved ? `/app/fold/herding?show=${d.kind === "alert" ? "watches" : "automations"}` : d.href, next: d.next ?? null }));
}


const VERB_WORD: Readonly<Record<string, string>> = { fx: t("ask.cardModel.convert"), swap: t("ask.cardModel.swap"), send: t("ask.cardModel.pay"), earn: t("ask.cardModel.earn"), supply: t("ask.cardModel.supply"), withdraw: t("ask.cardModel.withdraw"), reserve: t("ask.cardModel.keepLiquid"), bridge: t("ask.cardModel.bridge"), rebalance: t("ask.cardModel.rebalance"), borrow: t("ask.cardModel.borrow"), repay: t("ask.cardModel.repay") };

/** "fx + earn" (the reader's verbs) reads as "Convert, then earn"; other titles keep their words. */
export function planTitle(title: string): string {
  const verbs = title.split(/\s*(?:\+|then)\s*/u).map((v) => v.trim().toLowerCase());
  if (verbs.length > 0 && verbs.every((v) => VERB_WORD[v])) {
    const words = verbs.map((v, i) => (i === 0 ? VERB_WORD[v]! : VERB_WORD[v]!.toLowerCase()));
    return words.join(t("ask.cardModel.then"));
  }
  return title.replace(/^\w/u, (c) => c.toUpperCase());
}

