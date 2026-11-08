/**
 * "How this works" for each area: three short bullets at most and the
 * question the "Ask Lyko about this" button puts in the composer. Pure, so
 * tests check every area has its explanation.
 */
import { LYKIA_TERMS } from "@lykia/core";

export const HELP_AREAS = ["fold", "flock", "trails", "herding", "pack", "fence", "leash", "lyko", "ask", "review", "you", "forge", "stress"] as const;
export type HelpArea = (typeof HELP_AREAS)[number];

export interface HelpEntry {
  readonly title: string;
  /** Three bullets at most, each one plain sentence. */
  readonly bullets: readonly string[];
  /** Prefilled in Ask Lyko by "Ask Lyko about this". */
  readonly ask: string;
}

export const HELP: Readonly<Record<HelpArea, HelpEntry>> = {
  fold: { title: "The Fold · everything you own", bullets: ["Everything you hold on Arc and everything in motion, in one place.", "Lyko on watch reads it all and tells you when something needs you.", "Nothing moves until you sign in your own wallet."], ask: "Walk me through my Fold" },
  flock: { title: `${LYKIA_TERMS.flock.word} · ${LYKIA_TERMS.flock.plain}`, bullets: ["Every position in every place Lykia reads: what it is, what it is worth, what it is doing.", "Tap a row for the details and one next step Lyko can draft.", "Anything that cannot be read is named and left out of the totals, never counted as zero."], ask: "Where is my money and what is it doing?" },
  trails: { title: `${LYKIA_TERMS.trails.word} · ${LYKIA_TERMS.trails.plain}`, bullets: ["Everything that happened: payments, plans, refusals and fees.", "Each line says why it was allowed or refused, in plain words.", "Every transaction links to the explorer."], ask: "What happened in my account this week?" },
  herding: { title: `${LYKIA_TERMS.herding.word} · ${LYKIA_TERMS.herding.plain}`, bullets: ["Rules that run on their own: recurring payments, orders, alerts and watches.", "Each one shows when it runs next and whether your Fence would allow it.", "Pause or remove any of them at any time."], ask: "What runs on its own this week?" },
  pack: { title: `${LYKIA_TERMS.pack.word} · ${LYKIA_TERMS.pack.plain}`, bullets: ["Bots that work for you, each with its own budget and rules.", "A Leash gives an outside bot a spending limit it cannot go past.", "Revoke or pause any of them with one tap."], ask: "My bot needs a budget" },
  fence: { title: `${LYKIA_TERMS.fence.word} · ${LYKIA_TERMS.fence.plain}`, bullets: ["Every move is checked against these rules before you sign; if one fails, nothing moves.", "Lykia's beta limit sits on top of your rules for everyone until the contracts are audited.", "Making rules stricter applies at once; loosening them needs your wallet."], ask: "Explain my Fence in plain words" },
  leash: { title: `${LYKIA_TERMS.leash.word} · ${LYKIA_TERMS.leash.plain}`, bullets: ["You set how much a bot may spend per step, per day and in total, and until when.", "The limits sit on chain: the bot cannot go past them even if Lykia is down.", "Revoke stops its key at once."], ask: "What is a Leash?" },
  lyko: { title: "Lyko on watch · your portfolio assistant", bullets: ["Reads everything in the Fold: positions, budgets, orders, payments and plans.", "Says when something is close to a limit, ready to claim, about to end or idle.", "Drafts the fix; you sign it."], ask: "What should I look at first?" },
  ask: { title: "Ask Lyko · say it in words", bullets: ["Say what your money should do; Lyko plans it across Arc.", "Your Fence checks every step, and you sign once in your wallet.", "If something is missing, Lyko asks one short question with choices."], ask: "What can you do?" },
  review: { title: "Review · before you sign", bullets: ["What leaves your wallet and what you get, with the least you can receive.", "Fees, the network fee and your Fence's verdict, each in one line.", "A simulation lists every balance change before your wallet opens."], ask: "How do I read this review?" },
  you: { title: "Your Lyko · your settings", bullets: ["How careful Lyko is, how much stays liquid in your wallet, and what it tells you.", "Every setting says what it changes, in one line.", "Your Fence still has the last word."], ask: "Which settings should I change?" },
  forge: { title: "The Forge · for developers", bullets: ["Keys, projects, webhooks and the API reference for building on Lykia.", "Test keys run on Arc testnet; live keys move real money under a Fence.", "Every example runs as written."], ask: "How do I start building with the Lykia API?" },
  stress: { title: "Stress test · what if prices move", bullets: ["Pick a scenario; Lyko re-prices everything you hold with the same model it answers with.", "You see your value before and after, and how far your closest loan is from liquidation.", "Nothing moves: it is a calculation only."], ask: "What if EURC drops 5%?" },
};
