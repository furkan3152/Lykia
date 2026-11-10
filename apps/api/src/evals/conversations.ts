/**
 * The conversation suite: what people actually type into Ask Lyko, in
 * English and Turkish, single and multi-turn, vague and precise, with the
 * outcome each one must end in:
 *
 *   sign     a plan to review and sign (a proposal)
 *   card     something drafted or found, on a card the owner confirms (an order, a leash, a watch, a running row)
 *   ask      one question with options
 *   read     a sourced answer: figures on a card with where and when they were read
 *   refuse   an honest no, with what is possible instead
 *
 * The same cases run two ways. Offline (`npm run eval:intents`): through the
 * real POST /v1/agent/chat of an in-process API on a fake Arc, on the reader
 * path. Live (`npm run eval:live`): over HTTP against a deployed API. Both
 * are scored by `scoreConversation` below, which also checks every answer's
 * structure: no placeholder phrase, no tool name, no fixture card in an Ask
 * answer, a labelled sample when no wallet is connected, and every figure in
 * the prose present on a card, in a plan step, in an option or in the
 * owner's own words.
 *
 * Turkish text is written with Unicode escapes: the repository is English only.
 */
import { AUTOPILOT_BETA, DEFAULT_BETA_CAP, DEFAULT_FEE_BPS, FENCE_PRESETS, LEASH_LIMITS, ALERT_LIMITS, STILE_BETA, ORDERS_MAX_EXECUTIONS } from "@lykia/core";
import type { AnswerBlock } from "@lykia/core/api/answer";
import { guardNumbers, visibleGround } from "../agents/numberGuard.js";
import { numbersIn } from "../agents/grounding.js";
import { PLACEHOLDER } from "../agents/prose.js";
import type { CaseScore, Check } from "./score.js";

export type Outcome = "sign" | "card" | "ask" | "read" | "refuse";

export interface Expect {
  /** The outcome class, or the classes that are all acceptable. */
  readonly outcome: Outcome | readonly Outcome[];
  /** A block kind that must ride on the answer. */
  readonly block?: AnswerBlock["kind"] | readonly AnswerBlock["kind"][];
  /** The answer must match. */
  readonly text?: RegExp;
  /** The answer must not match. */
  readonly notText?: RegExp;
  /** At least one option (chip) must match. */
  readonly option?: RegExp;
  /** A plan step must match. */
  readonly step?: RegExp;
  /** Figures (as written in prose or on a card) that must appear, from code constants. */
  readonly figures?: readonly string[];
}

export interface ConversationCase {
  readonly id: string;
  readonly category: "act" | "manage" | "follow-up" | "read" | "guest" | "fold" | "self";
  /** "owner": a signed-in wallet. "guest": no wallet connected (the sample address). */
  readonly who: "owner" | "guest";
  readonly origin?: "fold";
  /** State the offline runner prepares: a loan under the floor, things running. */
  readonly setup?: readonly ("loan" | "collateral" | "running" | "paused")[];
  /** Offline only: it depends on prepared state a deployed account will not have. */
  readonly offlineOnly?: boolean;
  /** Offline: answered by the drifting scripted model (driftingModel.ts) instead of the reader, to test the model path. */
  readonly model?: "drifting";
  readonly turns: readonly { readonly say: string; readonly expect: Expect }[];
}

const A1 = "0x1111111111111111111111111111111111111111";
const usd = (v: string) => `$${Number(v).toLocaleString("en-US")}`;
const careful = FENCE_PRESETS.careful.patch as { caps: { perStepUsd: string; dailyUsd: string } };
const bold = FENCE_PRESETS.bold.patch as { caps: { perStepUsd: string; dailyUsd: string } };
const FEE = `${Number((DEFAULT_FEE_BPS / 100).toFixed(2))}%`;

/** The owner's own sentence from the live test (Turkish): "fix the health of my at-risk lending and borrowing positions". */
const OWNER_FIX_TR = "riskte olan lending ve borrowing pozisyonlar\u0131m\u0131n sa\u011fl\u0131\u011f\u0131n\u0131 d\u00fczelt";

export const CONVERSATIONS: readonly ConversationCase[] = [
  /* ------------------------------------------------------------ acting */
  { id: "earn-precise", category: "act", who: "owner", turns: [{ say: "Put 100 USDC to work at the best yield", expect: { outcome: "sign", step: /100|USDC/u } }] },
  { id: "earn-vague", category: "act", who: "owner", turns: [{ say: "Put some money to work", expect: { outcome: ["ask", "sign"] } }] },
  { id: "earn-idle", category: "act", who: "owner", turns: [{ say: "Put my idle USDC to work", expect: { outcome: "sign", block: "facts", text: /idle/iu } }] },
  { id: "earn-idle-best-vault", category: "act", who: "owner", turns: [{ say: "Move all my idle money to the best vault", expect: { outcome: "sign", block: "facts" } }] },
  { id: "earn-idle-tr", category: "act", who: "owner", turns: [{ say: "bo\u015ftaki param\u0131 \u00e7al\u0131\u015ft\u0131r", expect: { outcome: "sign", block: "facts" } }] },
  { id: "send-precise", category: "act", who: "owner", turns: [{ say: `Send 20 USDC to ${A1} for invoice 12`, expect: { outcome: ["sign", "refuse"], text: /Fence|sign|confirm/iu } }] },
  { id: "send-no-recipient", category: "act", who: "owner", turns: [{ say: "Send 50 USDC", expect: { outcome: "ask" } }] },
  { id: "convert", category: "act", who: "owner", turns: [{ say: "Convert 200 USDC to EURC", expect: { outcome: "sign", step: /EURC/u } }] },
  { id: "convert-tr", category: "act", who: "owner", turns: [{ say: "200 USDC'yi EURC'ye \u00e7evir", expect: { outcome: "sign", step: /EURC/u } }] },
  { id: "swap-back", category: "act", who: "owner", turns: [{ say: "Swap 50 EURC to USDC", expect: { outcome: "sign", step: /USDC/u } }] },
  { id: "bridge", category: "act", who: "owner", turns: [{ say: "Bridge 50 USDC to Base", expect: { outcome: "sign", step: /Base/u } }] },
  { id: "bridge-no-chain", category: "act", who: "owner", turns: [{ say: "Bridge 50 USDC", expect: { outcome: "ask", option: /Base|Arbitrum|Ethereum/u } }] },
  { id: "bridge-solana", category: "act", who: "owner", turns: [{ say: "Bridge 50 USDC to Solana", expect: { outcome: "refuse", text: /can't bridge there/u } }] },
  { id: "borrow", category: "act", who: "owner", turns: [{ say: "Borrow 100 USDC against my cirBTC", expect: { outcome: ["sign", "ask", "refuse"] } }] },
  { id: "repay-amount", category: "act", who: "owner", turns: [{ say: "Repay 50 USDC on Aave", expect: { outcome: ["sign", "refuse"] } }] },
  { id: "withdraw", category: "act", who: "owner", turns: [{ say: "Withdraw 100 USDC from my vault", expect: { outcome: ["sign", "ask", "refuse"] } }] },
  { id: "gateway", category: "act", who: "owner", turns: [{ say: "Deposit 30 USDC into Gateway", expect: { outcome: ["sign", "refuse"] } }] },
  { id: "rebalance", category: "act", who: "owner", turns: [{ say: "Rebalance to 60% USDC and 40% EURC", expect: { outcome: ["sign", "ask"] } }] },
  { id: "multi-step", category: "act", who: "owner", turns: [{ say: "Swap 100 EURC to USDC, then deposit it into Morpho", expect: { outcome: ["sign", "ask"], step: /USDC/u } }] },
  { id: "goal-language", category: "act", who: "owner", turns: [{ say: "Keep 500 USDC liquid and earn the rest", expect: { outcome: ["sign", "ask"] } }] },
  { id: "fix-health", category: "act", who: "owner", setup: ["loan", "collateral"], offlineOnly: true, turns: [{ say: "Fix the health of my at-risk loans", expect: { outcome: "ask", block: "facts", option: /^Repay \d+(?:\.\d+)? USDC on aave-v4$/u, text: /under the 1\.5 floor/u, notText: /Ask Lyko/u } }] },
  { id: "fix-health-tr", category: "act", who: "owner", setup: ["loan", "collateral"], offlineOnly: true, turns: [{ say: OWNER_FIX_TR, expect: { outcome: "ask", block: "facts", option: /^Repay \d+(?:\.\d+)? USDC on aave-v4$/u, notText: /Ask Lyko|SAMPLE/u } }] },
  { id: "fix-health-one-move", category: "act", who: "owner", setup: ["loan"], offlineOnly: true, turns: [{ say: "My loan is at risk, fix it", expect: { outcome: "sign", block: "facts", step: /Repay \d+(?:\.\d+)? USDC/u } }] },
  { id: "fix-health-none", category: "act", who: "owner", turns: [{ say: "Fix my loan health", expect: { outcome: "read", block: "facts", text: /no loans|nothing (?:is at risk|to fix)/iu } }] },
  { id: "reduce-risk", category: "act", who: "owner", setup: ["loan", "collateral"], offlineOnly: true, turns: [{ say: "Reduce the risk on my borrowing", expect: { outcome: "ask", block: "facts", option: /Repay|collateral/u } }] },
  { id: "protect-loan", category: "act", who: "owner", setup: ["loan", "collateral"], offlineOnly: true, turns: [{ say: "Protect my loan from liquidation", expect: { outcome: "ask", block: "facts" } }] },
  { id: "is-my-loan-safe", category: "read", who: "owner", setup: ["loan", "collateral"], offlineOnly: true, turns: [{ say: "Is my loan safe?", expect: { outcome: ["ask", "read"], block: "facts", text: /floor/u } }] },
  { id: "repay-everything", category: "act", who: "owner", setup: ["loan"], offlineOnly: true, turns: [{ say: "Repay everything", expect: { outcome: "sign", block: "facts", step: /Repay/u } }] },
  { id: "repay-everything-none", category: "act", who: "owner", turns: [{ say: "Pay off all my loans", expect: { outcome: "read", text: /no loans/iu } }] },
  { id: "exit-everything", category: "act", who: "owner", turns: [{ say: "Exit everything to USDC", expect: { outcome: "sign", block: "facts", step: /USDC/u } }] },
  { id: "exit-everything-tr", category: "act", who: "owner", turns: [{ say: "her \u015feyi USDC'ye \u00e7evir", expect: { outcome: "sign", block: "facts" } }] },
  { id: "close-all", category: "act", who: "owner", turns: [{ say: "Close all my positions", expect: { outcome: ["sign", "read"], block: "facts" } }] },
  { id: "undo-last-swap", category: "act", who: "owner", turns: [{ say: "Undo my last swap", expect: { outcome: ["refuse", "sign", "read"], text: /final on Arc and cannot be undone/u } }] },
  { id: "watch-health", category: "act", who: "owner", turns: [{ say: "Tell me if my health factor drops below 1.5", expect: { outcome: "card", block: "herded" } }] },
  { id: "watch-price", category: "act", who: "owner", turns: [{ say: "Tell me if EURC falls below 1.05", expect: { outcome: ["card", "ask", "sign"] } }] },
  { id: "order-limit", category: "act", who: "owner", turns: [{ say: "Buy 100 USDC of EURC when EUR/USD is below 1.09", expect: { outcome: ["card", "refuse"], block: "order" } }] },
  { id: "order-dca", category: "act", who: "owner", turns: [{ say: "Buy EURC with 50 USDC every week for 4 weeks", expect: { outcome: ["card", "refuse"], block: "order" } }] },
  { id: "order-dca-how-long", category: "act", who: "owner", turns: [{ say: "Buy EURC with 50 USDC every week", expect: { outcome: "ask", option: /for 4 weeks/u } }, { say: "the first one", expect: { outcome: ["card", "refuse"], block: "order" } }] },
  { id: "recurring-payment", category: "act", who: "owner", turns: [{ say: `Every Friday pay ${A1} 5 USDC for rent`, expect: { outcome: "card", block: "herded", text: /^Saved/u } }] },
  { id: "leash", category: "act", who: "owner", turns: [{ say: "Give my bot $20 a day for 7 days to pay invoices", expect: { outcome: ["card", "ask"] } }] },
  { id: "leash-vague", category: "act", who: "owner", turns: [{ say: "My bot needs money", expect: { outcome: "ask", option: /\$20 a day/u } }] },
  { id: "autopilot-on", category: "act", who: "owner", turns: [{ say: "Turn on Autopilot with $50 a step and $150 a day for 30 days", expect: { outcome: "card", block: "autopilot-draft" } }] },
  { id: "autopilot-vague", category: "act", who: "owner", turns: [{ say: "Turn on Autopilot", expect: { outcome: "ask", option: /Autopilot/u } }] },
  { id: "autopilot-task", category: "act", who: "owner", turns: [{ say: "Have Autopilot repay 50 USDC on Aave when health drops below 1.5", expect: { outcome: "card", block: "autopilot-task" } }] },
  { id: "agent", category: "act", who: "owner", turns: [{ say: "Create a payroll agent with a 500 USDC daily budget", expect: { outcome: "card", block: "agent-draft" } }] },
  { id: "change-fence", category: "act", who: "owner", turns: [{ say: "Make my Fence more careful", expect: { outcome: "ask", option: /Careful/u } }] },
  { id: "stop-everything", category: "act", who: "owner", turns: [{ say: "Stop everything", expect: { outcome: "ask", option: /whistle/iu } }] },

  /* -------------------------------------------- managing running things */
  { id: "pause-by-name", category: "manage", who: "owner", setup: ["running"], offlineOnly: true, turns: [{ say: "Pause the Friday payment", expect: { outcome: "card", block: "running", text: /Pause/u } }] },
  { id: "stop-by-name", category: "manage", who: "owner", setup: ["running"], offlineOnly: true, turns: [{ say: "Stop the rent payment", expect: { outcome: "card", block: "running", text: /press Pause/u } }] },
  { id: "stop-by-name-tr", category: "manage", who: "owner", setup: ["running"], offlineOnly: true, turns: [{ say: "cuma \u00f6demesini durdur", expect: { outcome: "card", block: "running" } }] },
  { id: "resume-by-name", category: "manage", who: "owner", setup: ["running", "paused"], offlineOnly: true, turns: [{ say: "Resume the Friday payment", expect: { outcome: "card", block: "running", text: /Resume/u } }] },
  { id: "revoke-agent", category: "manage", who: "owner", setup: ["running"], offlineOnly: true, turns: [{ say: "Revoke the invoice bot", expect: { outcome: "card", block: "running", text: /Revoke/u } }] },
  { id: "cancel-watch", category: "manage", who: "owner", setup: ["running"], offlineOnly: true, turns: [{ say: "Remove the health watch", expect: { outcome: "card", block: "running" } }] },
  { id: "cancel-order-none", category: "manage", who: "owner", setup: ["running"], offlineOnly: true, turns: [{ say: "Cancel my cirBTC order", expect: { outcome: "card", block: "running", text: /nothing running by that name/iu } }] },
  { id: "what-is-running", category: "manage", who: "owner", setup: ["running"], offlineOnly: true, turns: [{ say: "What is running?", expect: { outcome: "card", block: "running" } }] },
  { id: "what-is-running-none", category: "manage", who: "owner", turns: [{ say: "Show me what is running", expect: { outcome: ["read", "ask", "refuse"], text: /Nothing is running/u } }] },
  { id: "manage-not-signed-in", category: "manage", who: "guest", turns: [{ say: "Stop the Friday payment", expect: { outcome: "refuse", block: "sample", text: /connect a wallet/iu } }] },

  /* ---------------------------------------------------------- follow-ups */
  { id: "follow-do-it", category: "follow-up", who: "owner", turns: [{ say: "Convert 100 USDC to EURC", expect: { outcome: "sign" } }, { say: "do it", expect: { outcome: "sign", text: /sign/iu } }] },
  { id: "follow-half", category: "follow-up", who: "owner", turns: [{ say: "Convert 100 USDC to EURC", expect: { outcome: "sign" } }, { say: "half of that", expect: { outcome: "sign", step: /\b49\.5 USDC\b/u } }] },
  { id: "follow-half-tr", category: "follow-up", who: "owner", turns: [{ say: "Convert 100 USDC to EURC", expect: { outcome: "sign" } }, { say: "yar\u0131s\u0131", expect: { outcome: "sign", step: /\b49\.5 USDC\b/u } }] },
  { id: "follow-double", category: "follow-up", who: "owner", turns: [{ say: "Convert 100 USDC to EURC", expect: { outcome: "sign" } }, { say: "double it", expect: { outcome: "sign", step: /\b198 USDC\b/u } }] },
  { id: "follow-same-to-base", category: "follow-up", who: "owner", turns: [{ say: "Bridge 50 USDC to Arbitrum", expect: { outcome: "sign", step: /Arbitrum/u } }, { say: "same but to Base", expect: { outcome: "sign", step: /Base/u } }] },
  { id: "follow-make-it", category: "follow-up", who: "owner", turns: [{ say: "Convert 100 USDC to EURC", expect: { outcome: "sign" } }, { say: "make it 150", expect: { outcome: "sign", step: /\b148\.5 USDC\b/u } }] },
  { id: "follow-second-one", category: "follow-up", who: "owner", turns: [{ say: "Bridge 50 USDC", expect: { outcome: "ask" } }, { say: "the second one", expect: { outcome: "sign", step: /Arbitrum/u } }] },
  { id: "follow-yes-picks", category: "follow-up", who: "owner", setup: ["loan", "collateral"], offlineOnly: true, turns: [{ say: "Fix my loan health", expect: { outcome: "ask" } }, { say: "do it", expect: { outcome: "ask", text: /Which one/u, option: /Repay/u } }] },
  { id: "follow-first-fix", category: "follow-up", who: "owner", setup: ["loan", "collateral"], offlineOnly: true, turns: [{ say: "Fix my loan health", expect: { outcome: "ask" } }, { say: "the first one", expect: { outcome: "sign", step: /Repay \d+(?:\.\d+)? USDC/u } }] },
  { id: "follow-nothing-before", category: "follow-up", who: "owner", turns: [{ say: "do it", expect: { outcome: ["ask", "refuse"] } }] },
  { id: "follow-next-step", category: "follow-up", who: "owner", turns: [{ say: "What is the EURC rate?", expect: { outcome: "read", block: "rate" } }, { say: "ok do it", expect: { outcome: "sign", step: /EURC/u } }] },

  /* --------------------------------------------------------------- reads */
  { id: "where-is-my-money", category: "read", who: "owner", turns: [{ say: "Where is my money?", expect: { outcome: "read", block: "positions" } }] },
  { id: "balance", category: "read", who: "owner", turns: [{ say: "What is my balance?", expect: { outcome: "read", block: "balance" } }] },
  { id: "gas", category: "read", who: "owner", turns: [{ say: "How is my gas?", expect: { outcome: "read", block: "gas" } }] },
  { id: "rate", category: "read", who: "owner", turns: [{ say: "What is the EURC rate?", expect: { outcome: "read", block: "rate" } }] },
  { id: "yields", category: "read", who: "owner", turns: [{ say: "Where can I earn on EURC?", expect: { outcome: ["read", "ask"], block: "yields" } }] },
  { id: "stress", category: "read", who: "owner", turns: [{ say: "What if EURC drops 5%?", expect: { outcome: ["read", "ask"], block: "stress" } }] },
  { id: "fees-paid", category: "read", who: "owner", turns: [{ say: "What did I pay in fees?", expect: { outcome: "read", block: "facts", text: /fees over the last 30 days/u } }] },
  { id: "why-failed", category: "read", who: "owner", turns: [{ say: "Why did my last plan fail?", expect: { outcome: ["read", "refuse"], text: /Nothing failed|failed|refused/u } }] },
  { id: "capabilities", category: "read", who: "owner", turns: [{ say: "What can you do?", expect: { outcome: ["read", "ask"], block: "capabilities", notText: /\b9\d mapped actions\b|dry-run/u } }] },
  { id: "bridge-destinations", category: "read", who: "owner", turns: [{ say: "Where can I bridge USDC to?", expect: { outcome: ["read", "ask"], block: "capabilities" } }] },

  /* ----------------------------------------------- no wallet: the sample */
  { id: "guest-balance", category: "guest", who: "guest", turns: [{ say: "What is my balance?", expect: { outcome: "read", block: ["balance", "sample"], text: /^\*\*Sample address, not your wallet\.\*\*/u, notText: /\byour wallet (?:holds|is)\b|\bYou hold\b/u } }] },
  { id: "guest-positions", category: "guest", who: "guest", turns: [{ say: "Where is my money?", expect: { outcome: "read", block: ["positions", "sample"], text: /^\*\*Sample address, not your wallet\.\*\*/u, notText: /\bYour money\b/u } }] },
  { id: "guest-plan", category: "guest", who: "guest", turns: [{ say: "Convert 100 USDC to EURC", expect: { outcome: "sign", block: "sample", text: /^\*\*Sample address, not your wallet\.\*\*/u } }] },
  { id: "guest-fix-health", category: "guest", who: "guest", turns: [{ say: OWNER_FIX_TR, expect: { outcome: ["read", "ask", "sign"], block: ["facts", "sample"], text: /^\*\*Sample address, not your wallet\.\*\*/u, notText: /Ask Lyko/u } }] },
  { id: "guest-fees", category: "guest", who: "guest", turns: [{ say: "What did I pay in fees?", expect: { outcome: "refuse", text: /connect a wallet/iu } }] },
  { id: "guest-capabilities", category: "guest", who: "guest", turns: [{ say: "What can you do?", expect: { outcome: ["read", "ask"], block: "capabilities", notText: /dry-run|mapped actions/u } }] },
  { id: "owner-three-turns", category: "guest", who: "guest", turns: [
    { say: "Where is my money and what is it doing?", expect: { outcome: "read", block: ["positions", "sample"], text: /^\*\*Sample address, not your wallet\.\*\*/u } },
    { say: OWNER_FIX_TR, expect: { outcome: ["read", "ask", "sign"], block: ["facts", "sample"], notText: /Ask Lyko|Correction|earlier reply/u } },
    { say: "What can you do?", expect: { outcome: ["read", "ask"], block: "capabilities", notText: /dry-run|mapped actions|Your mode/u } },
  ] },

  /* ------------------------------------------------- written in the Fold */
  { id: "fold-sample-read", category: "fold", who: "guest", origin: "fold", offlineOnly: true, turns: [{ say: "What is my Fold worth?", expect: { outcome: "read", block: ["facts", "sample"], text: /^\*\*Sample flock, not your wallet\.\*\*/u } }] },
  { id: "fold-sample-fix", category: "fold", who: "guest", origin: "fold", offlineOnly: true, turns: [{ say: OWNER_FIX_TR, expect: { outcome: "read", block: ["facts", "sample"], text: /connect a wallet/iu, notText: /Ask Lyko/u } }] },
  { id: "fold-sample-move", category: "fold", who: "guest", origin: "fold", offlineOnly: true, turns: [{ say: "Convert 100 USDC to EURC", expect: { outcome: "refuse", text: /sample flock/u, notText: /Ask Lyko/u } }] },
  { id: "fold-owner-acts", category: "fold", who: "owner", origin: "fold", turns: [{ say: "Convert 100 USDC to EURC", expect: { outcome: "sign", notText: /Ask Lyko/u } }] },
  { id: "fold-owner-reads", category: "fold", who: "owner", origin: "fold", turns: [{ say: "What is my Fold worth?", expect: { outcome: "read", block: "facts", notText: /Ask Lyko/u } }] },

  /* ------------------------------------------------------ self-knowledge */
  { id: "know-fees", category: "self", who: "guest", turns: [{ say: "What are the fees?", expect: { outcome: "read", block: "facts", figures: [FEE] } }] },
  { id: "know-fee-swap", category: "self", who: "guest", turns: [{ say: "How much does a swap cost?", expect: { outcome: "read", block: "facts", figures: [FEE] } }] },
  { id: "know-repay-free", category: "self", who: "guest", turns: [{ say: "Is repaying free?", expect: { outcome: "read", block: "facts", text: /never charged|free/iu } }] },
  { id: "know-bridge-cost", category: "self", who: "guest", turns: [{ say: "How much does bridging cost?", expect: { outcome: "read", block: "facts", text: /Circle/u } }] },
  { id: "know-gas", category: "self", who: "guest", turns: [{ say: "How does gas work on Arc?", expect: { outcome: "read", block: "facts", text: /USDC/u } }] },
  { id: "know-autopilot-limit", category: "self", who: "guest", turns: [{ say: "What is the most Autopilot can spend?", expect: { outcome: "read", block: "facts", figures: [usd(AUTOPILOT_BETA.perStepUsd), usd(AUTOPILOT_BETA.perDayUsd)] } }] },
  { id: "know-stile-limit", category: "self", who: "guest", turns: [{ say: "What is the Stile limit?", expect: { outcome: "read", block: "facts", figures: [usd(STILE_BETA.perStepUsd), usd(STILE_BETA.perDayUsd)] } }] },
  { id: "know-beta-limit", category: "self", who: "guest", turns: [{ say: "What is the beta limit?", expect: { outcome: "read", block: "facts", figures: [usd(DEFAULT_BETA_CAP.perStepUsd), usd(DEFAULT_BETA_CAP.perDayUsd)] } }] },
  { id: "know-max-move", category: "self", who: "guest", turns: [{ say: "How much can I move in one step?", expect: { outcome: "read", block: "facts", figures: [usd(DEFAULT_BETA_CAP.perStepUsd)] } }] },
  { id: "know-careful", category: "self", who: "guest", turns: [{ say: "What are the limits of the Careful Fence?", expect: { outcome: "read", block: "facts", figures: [usd(careful.caps.perStepUsd), usd(careful.caps.dailyUsd)] } }] },
  { id: "know-bold", category: "self", who: "guest", turns: [{ say: "What is the cap on the Bold preset?", expect: { outcome: "read", block: "facts", figures: [usd(bold.caps.perStepUsd), usd(bold.caps.dailyUsd)] } }] },
  { id: "know-leash-length", category: "self", who: "guest", turns: [{ say: "How long can a leash last at most?", expect: { outcome: "read", block: "facts", figures: [`${LEASH_LIMITS.maxDays} days`] } }] },
  { id: "know-watch-count", category: "self", who: "guest", turns: [{ say: "How many watches can I have?", expect: { outcome: "read", block: "facts", figures: [`${ALERT_LIMITS.perOwner} watches`] } }] },
  { id: "know-order-limit", category: "self", who: "guest", turns: [{ say: "What is the limit on DCA orders?", expect: { outcome: "read", block: "facts", figures: [ORDERS_MAX_EXECUTIONS.toLocaleString("en-US")] } }] },
  { id: "know-health-factor", category: "self", who: "guest", turns: [{ say: "What is a health factor?", expect: { outcome: "read", block: "facts", text: /loan/u } }] },
  { id: "know-slippage", category: "self", who: "guest", turns: [{ say: "What does slippage mean?", expect: { outcome: "read", block: "facts", text: /price/u } }] },
  { id: "know-apy", category: "self", who: "guest", turns: [{ say: "What is APY?", expect: { outcome: "read", block: "facts", text: /yearly/u } }] },
  { id: "know-finality", category: "self", who: "guest", turns: [{ say: "What is finality?", expect: { outcome: "read", block: "facts", text: /under a second/u } }] },
  { id: "know-fence", category: "self", who: "guest", turns: [{ say: "What is a Fence?", expect: { outcome: ["read", "ask"], text: /spending rules/u } }] },
  { id: "know-leash", category: "self", who: "guest", turns: [{ say: "What is a Leash?", expect: { outcome: ["read", "ask"], text: /budget/u } }] },
  { id: "know-whistle", category: "self", who: "guest", turns: [{ say: "What is the Whistle?", expect: { outcome: ["read", "ask"], text: /stop/iu } }] },
  { id: "know-what-is-lykia", category: "self", who: "guest", turns: [{ say: "What is Lykia?", expect: { outcome: "read", block: "facts", text: /Arc/u } }] },
  { id: "know-custody", category: "self", who: "guest", turns: [{ say: "Do you hold my money?", expect: { outcome: "read", block: "facts", text: /non-custodial|never holds/u } }] },
  { id: "know-who-signs", category: "self", who: "guest", turns: [{ say: "Can you sign for me?", expect: { outcome: "read", block: "facts", text: /Autopilot/u } }] },
  { id: "know-perps", category: "self", who: "guest", turns: [{ say: "Can you trade perps?", expect: { outcome: "refuse", text: /^No\./u, option: /./u } }] },
  { id: "know-leverage", category: "self", who: "guest", turns: [{ say: "Can I open a 10x long?", expect: { outcome: "refuse", text: /^No\./u } }] },
  { id: "know-launch", category: "self", who: "guest", turns: [{ say: "Can you launch a token for me?", expect: { outcome: "refuse", text: /^No\./u } }] },
  { id: "know-stablefx", category: "self", who: "guest", turns: [{ say: "Can you route through StableFX?", expect: { outcome: "refuse", text: /^No\..*not a route/su } }] },
  { id: "know-usyc", category: "self", who: "guest", turns: [{ say: "Can I mint USYC here?", expect: { outcome: "refuse", text: /^No\..*not a route/su } }] },
  { id: "know-x402", category: "self", who: "guest", turns: [{ say: "Can I pay through x402?", expect: { outcome: "refuse", text: /^No\./u } }] },
  { id: "know-bank", category: "self", who: "guest", turns: [{ say: "Can you send money to my bank account?", expect: { outcome: "refuse", text: /^No\./u } }] },
  { id: "know-solana", category: "self", who: "guest", turns: [{ say: "Can you bridge to Solana?", expect: { outcome: "refuse", text: /^No\./u, option: /bridge/iu } }] },
  { id: "know-why-no-undo", category: "self", who: "guest", turns: [{ say: "Why can't you undo a transaction?", expect: { outcome: "refuse", text: /final/u } }] },
  { id: "know-can-swap", category: "self", who: "guest", turns: [{ say: "Can you swap tokens?", expect: { outcome: ["read", "ask"], text: /^Yes|venue/u } }] },
  { id: "know-can-recurring", category: "self", who: "guest", turns: [{ say: "Can you set up recurring payments?", expect: { outcome: ["read", "ask"], text: /^Yes/u } }] },
  { id: "know-morpho-safe", category: "self", who: "guest", turns: [{ say: "Is Morpho safe?", expect: { outcome: "read", block: "facts", text: /never call anything safe/u, notText: /\bis safe\b|\bit is safe\b/u } }] },
  { id: "know-bridge-safe", category: "self", who: "guest", turns: [{ say: "Is bridging safe?", expect: { outcome: "read", block: "facts", text: /never call anything safe/u } }] },
  { id: "know-lykia-safe", category: "self", who: "guest", turns: [{ say: "Is Lykia audited?", expect: { outcome: "read", block: "facts", text: /not been audited/u } }] },
  { id: "know-liquidated", category: "self", who: "guest", turns: [{ say: "What happens if I get liquidated?", expect: { outcome: "read", block: "facts", text: /collateral/u } }] },
  { id: "know-step-fails", category: "self", who: "guest", turns: [{ say: "What happens if a step fails?", expect: { outcome: "read", block: "facts", text: /moves nothing/u } }] },
  { id: "know-price-forecast", category: "self", who: "guest", turns: [{ say: "Will EURC go up next week?", expect: { outcome: "refuse", text: /does not guess|Nobody knows/u } }] },
  { id: "know-tax", category: "self", who: "guest", turns: [{ say: "Should I pay tax on this?", expect: { outcome: "refuse", text: /not a tax/u } }] },
  { id: "know-need-wallet", category: "self", who: "guest", turns: [{ say: "Do I need to connect a wallet?", expect: { outcome: "read", block: "facts", text: /wallet/u } }] },
  { id: "know-needs-signature", category: "self", who: "guest", turns: [{ say: "What needs a signature?", expect: { outcome: "read", block: "facts", text: /signature/u } }] },
  { id: "know-cannot", category: "self", who: "guest", turns: [{ say: "What can't you do?", expect: { outcome: ["read", "ask"], block: "facts", text: /do not do/u } }] },
  { id: "know-where-running", category: "self", who: "guest", turns: [{ say: "Where do I see what I started?", expect: { outcome: "read", block: "facts", text: /Herding/u } }] },
  { id: "know-fees-tr", category: "self", who: "guest", turns: [{ say: "\u00dccretler ne kadar?", expect: { outcome: "read", block: "facts", figures: [FEE] } }] },
  { id: "know-fence-tr", category: "self", who: "guest", turns: [{ say: "Fence nedir?", expect: { outcome: ["read", "ask"], text: /spending rules/u } }] },
  { id: "know-health-tr", category: "self", who: "guest", turns: [{ say: "Sa\u011fl\u0131k fakt\u00f6r\u00fc nedir?", expect: { outcome: "read", block: "facts", text: /loan/u } }] },
  { id: "know-autopilot-limit-tr", category: "self", who: "guest", turns: [{ say: "Autopilot limiti nedir?", expect: { outcome: "read", block: "facts", figures: [usd(AUTOPILOT_BETA.perStepUsd), usd(AUTOPILOT_BETA.perDayUsd)] } }] },
  { id: "know-perps-tr", category: "self", who: "guest", turns: [{ say: "Perp i\u015flemi yapabilir misin?", expect: { outcome: "refuse", text: /^No\./u } }] },
  { id: "know-custody-tr", category: "self", who: "guest", turns: [{ say: "Param\u0131 sen mi tutuyorsun?", expect: { outcome: "read", block: "facts", text: /non-custodial|never holds/u } }] },
  { id: "know-bridge-safe-tr", category: "self", who: "guest", turns: [{ say: "K\u00f6pr\u00fc g\u00fcvenli mi?", expect: { outcome: "read", block: "facts", text: /never call anything safe/u } }] },
  { id: "know-capabilities-tr", category: "self", who: "guest", turns: [{ say: "Neler yapabilirsin?", expect: { outcome: ["read", "ask"], block: "capabilities" } }] },
  { id: "know-forecast-tr", category: "self", who: "guest", turns: [{ say: "EURC y\u00fckselecek mi?", expect: { outcome: "refuse", text: /does not guess|Nobody knows/u } }] },
  { id: "know-liquidated-tr", category: "self", who: "guest", turns: [{ say: "Likide olursam ne olur?", expect: { outcome: "read", block: "facts", text: /collateral/u } }] },
  /* ------------------------------ the model path, with a model that drifts */
  { id: "model-empty-clarify", category: "act", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "Do something nice with it", expect: { outcome: "ask", text: /^\*\*Sample address, not your wallet\.\*\* What should I do with it\?/u, option: /Put it to work/u, block: "sample" } }] },
  { id: "model-send-no-recipient", category: "act", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "Send 50 USDC", expect: { outcome: "ask", text: /Who should get the 50 USDC\?/u, block: "sample" } }] },
  { id: "model-bridge-no-chain", category: "act", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "Bridge 50 USDC", expect: { outcome: "ask", text: /Bridge 50 USDC to which chain\?/u, option: /^Bridge 50 USDC to Base$/u } }] },
  { id: "model-second-one", category: "follow-up", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "Bridge 50 USDC", expect: { outcome: "ask" } }, { say: "the second one", expect: { outcome: "sign", step: /Arbitrum/u } }] },
  { id: "model-fee-in-prose", category: "act", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "Convert 100 USDC to EURC", expect: { outcome: "sign", block: "facts", text: /Lykia fee is 1 USDC/u, notText: /12,345|1\.11923186/u } }] },
  { id: "model-fence-limits", category: "act", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "Walk me through my rules", expect: { outcome: ["read", "refuse", "ask"], block: "facts", text: /at most \$1000 a step, \$2500 a plan and \$5000 a day/u } }] },
  { id: "model-sample-wording", category: "guest", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "Tell me a story about this wallet?", expect: { outcome: ["read", "refuse"], text: /not your money\. Your EURC watch is not saved\. Connecting your wallet lets me save it to your account, and your Fence stays as it is\./u, notText: /sample wallet's money|Connecting the sample wallet|sample wallet's EURC watch|the default Fence/u } }] },
  { id: "model-change-fence", category: "act", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "Make my Fence more careful", expect: { outcome: "ask", option: /Careful/u, block: ["offer", "sample"] } }] },
  { id: "model-stop-everything", category: "act", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "Stop everything", expect: { outcome: "ask", option: /whistle/iu, block: ["offer", "sample"] } }] },
  { id: "model-do-it-alone", category: "follow-up", who: "guest", model: "drifting", offlineOnly: true, turns: [{ say: "do it", expect: { outcome: "ask", text: /Do what\?/u } }] },
  { id: "know-bank-tr", category: "self", who: "guest", turns: [{ say: "Bankama para g\u00f6nderebilir misin?", expect: { outcome: "refuse", text: /^No\./u } }] },
];

/* ---------------------------------------------------------------- scoring */

/** One answer as either transport returns it (the JSON form of POST /v1/agent/chat). */
export interface ChatAnswer {
  readonly reply: string;
  readonly stopReason: string;
  readonly mode?: string;
  readonly threadId?: string;
  readonly proposals: readonly { readonly steps?: readonly string[]; readonly decision?: string; readonly reasons?: readonly string[]; readonly title?: string }[];
  readonly events: readonly { readonly event: string; readonly data: unknown }[];
}

const DRAFT_CARDS = new Set(["order", "leash-draft", "autopilot-draft", "autopilot-task", "agent-draft", "herded", "running"]);
const READ_CARDS = new Set(["facts", "positions", "balance", "gas", "rate", "yields", "capabilities", "stress", "offer"]);
const TOOL_NAMES = /\b(?:plan_intent|show_card|ask_owner|compile_goal|draft_order|draft_automation|create_alert|create_leash|create_agent|turn_on_autopilot|add_autopilot_task|watch_position|read_instructions|get_insights|search_routes|stop_plan|tool_data|lykia-state)\b|`(?:yields|flock|positions|fence|prices|venues|knowledge|scent|outrun|capabilities|delegate)`/u;

export function blocksOf(a: ChatAnswer): AnswerBlock[] {
  return a.events.filter((e) => e.event === "block").map((e) => e.data as AnswerBlock);
}

export function optionsOf(a: ChatAnswer): string[] {
  const last = [...a.events].reverse().find((e) => e.event === "clarify");
  return ((last?.data as { options?: string[] } | undefined)?.options ?? []).map(String);
}

/** The outcome class of an answer, from its structure alone. */
export function outcomeOf(a: ChatAnswer): Outcome {
  const blocks = blocksOf(a);
  const options = optionsOf(a);
  const drafts = a.events.filter((e) => e.event === "draft" || e.event === "program");
  if (a.proposals.some((p) => (p.steps ?? []).length > 0 && p.decision !== "deny")) return "sign";
  if (blocks.some((b) => DRAFT_CARDS.has(b.kind)) || drafts.length > 0) return "card";
  void options;
  // A question ends the turn as a question. An honest no starts with "No" (or says it cannot), whatever chips follow.
  if (a.stopReason === "clarify") return "ask";
  // A plan the Fence refused is a refusal, whatever cards explain it.
  if (a.proposals.length > 0 && a.proposals.every((p) => p.decision === "deny")) return "refuse";
  if (/^(?:\*\*Sample[^*]*\*\*\s*)?(?:No[.,:]|No wallet\b|I can't\b|I cannot\b|I couldn't\b|I won't\b)/u.test(a.reply)) return "refuse";
  if (blocks.some((b) => READ_CARDS.has(b.kind))) return "read";
  return "refuse";
}

const check = (name: string, ok: boolean, detail?: string): Check => ({ name, ok, ...(detail && !ok ? { detail: detail.slice(0, 300) } : {}) });

/** Every figure in the prose is on a card, in a plan step, in an option, in a work step or in the owner's own words. */
function unsourcedFigures(a: ChatAnswer, said: readonly string[]): string[] {
  const blocks = blocksOf(a);
  // The same evidence the server's guard uses: what the owner wrote and what is on screen (cards, plans, options,
  // work-step results, programs and drafts). A figure only a tool saw does not count.
  const other = a.events.filter((e) => e.event === "step" || e.event === "draft" || e.event === "program").map((e) => (e.event === "step" ? [(e.data as { result?: string }).result ?? "", (e.data as { detail?: string }).detail ?? ""] : e.data));
  const ground = visibleGround({ ownerText: said.join("\n"), ownerNumbers: numbersIn(said.join("\n")), toolNumbers: new Set(), toolAddresses: new Set(), question: null }, { proposals: a.proposals as never, options: optionsOf(a), other });
  // A quoted sentence ("say “convert 100 USDC to EURC”") is something the owner could say, not a claim about their money.
  const claims = a.reply.replace(/“[^”\n]*”/gu, "“…”");
  return [...guardNumbers(claims, ground, blocks).removed];
}

/** The structural checks every answer must pass, on either path. */
export function structureChecks(c: ConversationCase, a: ChatAnswer, said: readonly string[]): Check[] {
  const blocks = blocksOf(a);
  const fixture = blocks.some((b) => JSON.stringify(b).includes('"source":"sample"'));
  const bullets = a.reply.split("\n").filter((l) => /^\s*[-*•]\s/u.test(l)).length;
  const unsourced = unsourcedFigures(a, said);
  const errored = a.events.find((e) => e.event === "error");
  return [
    check("an answer", a.reply.trim().length > 0 && !errored, errored ? JSON.stringify(errored.data) : a.reply),
    check("no placeholder phrase", !PLACEHOLDER.test(a.reply), a.reply),
    check("no tool name or internal term", !TOOL_NAMES.test(a.reply) && !/\b(?:your|the) mode is\b/iu.test(a.reply), a.reply),
    check("Lyko does not send the owner to Ask Lyko", !/\bask Lyko to\b|\bAsk Lyko plans\b|\bOpen in Ask Lyko\b/iu.test(a.reply), a.reply),
    check("no comment on an earlier answer", !/^\s*(?:\*\*)?Correction\b|\bmy earlier (?:reply|answer)\b/imu.test(a.reply), a.reply),
    check("no fixture card in an Ask answer", c.origin === "fold" || !fixture, blocks.map((b) => b.kind).join(",")),
    check("every figure in the prose has a source", unsourced.length === 0, `${unsourced.join(", ")} in: ${a.reply}`),
    check("at most three bullets", bullets <= 3, String(bullets)),
    check("prices are rounded", !/\$\s?\d+\.\d{5,}/u.test(a.reply), a.reply),
    check("English only", !/[\u00e7\u011f\u0131\u015f\u00f6\u00fc\u00c7\u011e\u0130\u015e\u00d6\u00dc]/u.test(a.reply), a.reply),
  ];
}

/** Scores one conversation: each turn's structure, then what the case expects of it. `guest` says the transport had no wallet. */
export function scoreConversation(c: ConversationCase, answers: readonly ChatAnswer[], guest: boolean): CaseScore {
  const checks: Check[] = [];
  const said: string[] = [];
  c.turns.forEach((turn, i) => {
    const a = answers[i];
    const tag = c.turns.length > 1 ? `turn ${i + 1}: ` : "";
    said.push(turn.say);
    if (!a) {
      checks.push(check(`${tag}answered`, false, "no answer"));
      return;
    }
    for (const s of structureChecks(c, a, said)) checks.push({ ...s, name: `${tag}${s.name}` });
    const e = turn.expect;
    const blocks = blocksOf(a);
    const got = outcomeOf(a);
    const want = (Array.isArray(e.outcome) ? e.outcome : [e.outcome]) as readonly Outcome[];
    checks.push(check(`${tag}outcome ${want.join(" or ")}`, want.includes(got), `${got}: ${a.reply}`));
    for (const kind of e.block ? ((Array.isArray(e.block) ? e.block : [e.block]) as readonly string[]) : []) checks.push(check(`${tag}a ${kind} card`, blocks.some((b) => b.kind === kind), blocks.map((b) => b.kind).join(",") || "no cards"));
    if (e.text) checks.push(check(`${tag}says ${e.text.source.slice(0, 40)}`, e.text.test(a.reply), a.reply));
    if (e.notText) checks.push(check(`${tag}never says ${e.notText.source.slice(0, 40)}`, !e.notText.test(a.reply), a.reply));
    if (e.option) checks.push(check(`${tag}offers ${e.option.source.slice(0, 40)}`, optionsOf(a).some((o) => e.option!.test(o)), optionsOf(a).join(" | ") || "no options"));
    if (e.step) checks.push(check(`${tag}plans ${e.step.source.slice(0, 40)}`, a.proposals.some((p) => (p.steps ?? []).some((s) => e.step!.test(s))), JSON.stringify(a.proposals.map((p) => p.steps))));
    for (const f of e.figures ?? []) checks.push(check(`${tag}states ${f} from the code`, `${a.reply} ${JSON.stringify(blocks)}`.includes(f), a.reply));
    // With no wallet, an answer that shows or plans money is labelled as a sample, in its first line and on a card.
    if (guest && (a.proposals.length > 0 || blocks.some((b) => ["gas", "balance", "positions", "stress"].includes(b.kind)))) {
      checks.push(check(`${tag}first line says it is a sample`, /^\*\*Sample (?:address|flock), not your wallet\.\*\*/u.test(a.reply), a.reply));
      checks.push(check(`${tag}a sample card with a Connect action`, blocks.some((b) => b.kind === "sample" && /connect/iu.test(b.cta)), blocks.map((b) => b.kind).join(",")));
      checks.push(check(`${tag}never "your wallet" for the sample`, !/\byour (?:own )?wallet (?:holds|has|is)\b|\bin your wallet\b|\bYou hold\b|\bYour money\b/u.test(a.reply.replace(/^\*\*Sample[^*]+\*\*/u, "")), a.reply));
    }
  });
  return { id: c.id, category: `talk:${c.category}`, passed: checks.every((x) => x.ok), checks, score: checks.filter((x) => x.ok).length / Math.max(1, checks.length) };
}
