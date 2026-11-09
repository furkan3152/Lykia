/** Pure helpers behind the chat's cards (node tests load this file). */
import type { AnswerBlock, ChatDraftLink } from "@lykia/core/api/agents";

export type HerdItem = Extract<AnswerBlock, { kind: "herded" }>["items"][number];

const RULE_NAMES: Readonly<Record<string, string>> = {
  "mode.whistle": "The Whistle",
  "mode.dry-run": "Dry-run mode",
  fee: "Protocol fee",
  environment: "Network",
  signer: "Signer",
  kinds: "Kinds of move",
  venues: "Venues",
  "tokens.allow": "Allowed tokens",
  "tokens.unlisted": "Unlisted tokens",
  scent: "Scent",
  recipients: "Recipients",
  bridges: "Bridges",
  "caps.step": "Per-step cap",
  "caps.intent": "Per-plan cap",
  "caps.daily": "Daily cap",
  "caps.weekly": "Weekly cap",
  "limits.steps": "Step limit",
  "limits.slippage": "Slippage",
  "lending.health": "Health factor",
  "fx.deviation": "FX band",
  schedule: "Schedule",
  "confirm.above": "Confirm above",
  "confirm.external": "External recipient",
  "confirm.cross-chain": "Cross-chain",
  "confirm.agent": "Agent move",
  "confirm.unlisted": "Unlisted token",
  "beta.cap": "Beta cap",
  "facts.unavailable": "Missing facts",
};

/** "caps.perStep" → "Per-step cap"; unknown rules keep their name, tidied. */
export function ruleName(rule: string): string {
  return RULE_NAMES[rule] ?? rule.replace(/[._-]+/gu, " ").replace(/^\w/u, (c) => c.toUpperCase());
}


/** Drafts from the stream (alerts, automations) as herded items. */
export function herdFromDrafts(drafts: readonly ChatDraftLink[]): HerdItem[] {
  return drafts.map((d) => ({ kind: d.kind, label: d.label, saved: d.saved, href: d.saved ? `/app/fold/herding?show=${d.kind === "alert" ? "watches" : "automations"}` : d.href, next: d.next ?? null }));
}


const VERB_WORD: Readonly<Record<string, string>> = { fx: "Convert", swap: "Swap", send: "Pay", earn: "Earn", supply: "Supply", withdraw: "Withdraw", reserve: "Keep liquid", bridge: "Bridge", rebalance: "Rebalance", borrow: "Borrow", repay: "Repay" };

/** "fx + earn" (the reader's verbs) reads as "Convert, then earn"; other titles keep their words. */
export function planTitle(title: string): string {
  const verbs = title.split(/\s*(?:\+|then)\s*/u).map((v) => v.trim().toLowerCase());
  if (verbs.length > 0 && verbs.every((v) => VERB_WORD[v])) {
    const words = verbs.map((v, i) => (i === 0 ? VERB_WORD[v]! : VERB_WORD[v]!.toLowerCase()));
    return words.join(", then ");
  }
  return title.replace(/^\w/u, (c) => c.toUpperCase());
}

