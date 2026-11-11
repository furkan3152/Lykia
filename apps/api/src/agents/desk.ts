/**
 * Lyko's desk: the requests code answers before any model is asked, on both
 * paths (with a model and without one). Each one is decided and computed
 * here and every figure travels in a card:
 *
 *   fix my loan health      the repay or the added collateral that brings each loan under the floor back above it
 *   repay everything        every loan, limited by what the wallet holds
 *   exit everything         withdraw what earns, convert the rest to USDC
 *   put idle money to work  the wallet's USDC above the liquidity floor, through the route search
 *   undo my last swap       the opposite swap at today's price (a settled swap is final)
 *   pause / stop / cancel   a running thing by name, with the control Herding offers for it
 *   what did I pay in fees  from Trails
 *   why did X fail          from Trails
 *   questions about Lykia   limits, fees, plain meanings, what it cannot do (the capability map's self-knowledge)
 *
 * A request to act always ends in a sign card, a question with options, or
 * an honest "no" with what is possible instead. Nothing here signs.
 */
import { intlTag } from "../i18n/format.js";
import { count } from "../i18n/count.js";
import { canTargets, CCTP_DESTINATIONS, isSampleOwner, readKnowledge, TRAIL_FEE_WINDOW_DAYS, type Address, type CapabilityMap, type KnowledgeEntry, type KnowledgeReading, type PlanAction, type PositionsResponse } from "@lykia/core";
import type { AgentProposal } from "@lykia/core/api/agents";
import type { AnswerBlock, BlockSource, FactRow, RunningItem } from "@lykia/core/api/answer";
import type { FoldInstruction } from "@lykia/core/api/fold";
import { preflightLead } from "@lykia/core";
import { liveCapabilityMap } from "../capabilities/map.js";
import { foldPositions, type FixtureScope } from "../fold/sample.js";
import { instructionsView } from "../fold/instructions.js";
import { ownerIntents, trailsFor } from "../fold/trails.js";
import { fromBaseUnits } from "@lykia/core";
import { intentEnglish } from "../language/vocabulary.js";
import { blockOf, emitBlock, fenceCard, isoOf, planFactsCard, stepsFor } from "./cards.js";
import type { DeterministicInput } from "./deterministic.js";
import { planActions, preflightOf } from "./engine.js";
import { idleAboveFloor, newGround } from "./grounding.js";
import { runTool, type ToolContext } from "./tools.js";
import { healthReport, walletBalances, type HealthFix } from "./health.js";
import type { TurnResult } from "./orchestrator.js";

import { tx, txKnown } from "@lykia/core";
export interface DeskInput extends DeterministicInput {
  /** "fold": Lyko on watch in the Fold. Its reads may use the Fold's sample fixture when nobody is signed in. */
  readonly origin?: "ask" | "fold";
}

const usd = (v: string | number) => `$${Number(v).toLocaleString(intlTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = count;
const lower = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

/* ---------------------------------------------------------------- intents */

export type DeskIntent =
  | { readonly kind: "fix-health" }
  | { readonly kind: "repay-all" }
  | { readonly kind: "exit-all" }
  | { readonly kind: "idle-to-work"; readonly token: "USDC" | "EURC" }
  | { readonly kind: "undo-swap" }
  | { readonly kind: "running"; readonly action: "pause" | "resume" | "stop" | "cancel" | "list"; readonly words: readonly string[] }
  | { readonly kind: "order"; readonly input: OrderInput; readonly missing: "executions" | null }
  | { readonly kind: "fees-paid" }
  | { readonly kind: "why-failed"; readonly words: readonly string[] };

export interface OrderInput {
  readonly kind: "limit" | "dca";
  readonly sell: string;
  readonly buy: string;
  readonly amount: string;
  readonly executions?: number;
  readonly intervalSeconds?: number;
  readonly triggerPrice?: string;
  readonly triggerAbove?: boolean;
}

const SYMBOL: Readonly<Record<string, string>> = { usdc: "USDC", eurc: "EURC", cirbtc: "cirBTC", weth: "WETH", btc: "cirBTC", bitcoin: "cirBTC", euro: "EURC", euros: "EURC" };
const EVERY: Readonly<Record<string, number>> = { hour: 3_600, day: 86_400, week: 604_800, month: 2_592_000 };

/** "Buy EURC with 50 USDC every week for 4 weeks" and "buy 100 USDC of EURC when EUR/USD is below 1.09": orders, not plans for now. */
export function readOrder(t: string): { input: OrderInput; missing: "executions" | null } | null {
  const dca = /\b(?:buy|dca(?: into)?)\s+(eurc|cirbtc|weth|btc|bitcoin|euros?)\s+(?:with|using|for)\s+\$?(\d+(?:\.\d+)?)\s*(usdc|eurc)\s+(?:every|each|per)\s+(hour|day|week|month)(?:\s+(?:for|over)\s+(\d{1,4})\s+(?:hours?|days?|weeks?|months?))?/u.exec(t) ?? null;
  if (dca) {
    const executions = dca[5] ? Number(dca[5]) : undefined;
    return { input: { kind: "dca", sell: SYMBOL[dca[3]!]!, buy: SYMBOL[dca[1]!]!, amount: dca[2]!, intervalSeconds: EVERY[dca[4]!]!, ...(executions ? { executions } : {}) }, missing: executions ? null : "executions" };
  }
  const limit = /\b(buy|sell)\s+\$?(\d+(?:\.\d+)?)\s*(usdc|eurc|cirbtc|weth)\s+(?:of|for|into|to|worth of)\s+(eurc|usdc|cirbtc|weth|btc|bitcoin|euros?)\s+(?:when|if|once)\b.*?\b(below|under|above|over)\s+\$?(\d+(?:\.\d+)?)/u.exec(t);
  if (limit) return { input: { kind: "limit", sell: SYMBOL[limit[3]!]!, buy: SYMBOL[limit[4]!]!, amount: limit[2]!, triggerPrice: limit[6]!, triggerAbove: limit[5] === "above" || limit[5] === "over" }, missing: null };
  return null;
}

const STOP_WORDS = new Set(["the", "my", "a", "an", "that", "this", "it", "please", "for", "of", "to", "on", "in", "me", "can", "you", "could", "would", "now", "one", "and", "is", "was", "did", "do", "why", "with", "from", "all", "running", "thing", "things", "lyko", "i", "want", "need", "running?"]);
const targetWords = (t: string, drop: RegExp) => t.replace(drop, " ").replace(/[^\p{L}\p{N}$.@ -]+/gu, " ").split(/\s+/u).map((w) => w.replace(/^[.-]+|[.-]+$/gu, "")).filter((w) => w.length > 1 && !STOP_WORDS.has(w));

/** Words that make a sentence a request to act, in the reader's English (Turkish is rewritten first). */
const ACTION = /\b(?:fix|improve|repair|restore|protect|rescue|rebalance|close|exit|unwind|top up|top-up|reduce|de-?risk|put|send|pay|swap|convert|bridge|deposit|withdraw|borrow|repay|lend|supply|buy|sell|move|sweep|invest|earn|stake|stop|pause|resume|cancel|revoke|create|set up|turn on|turn off|undo|reverse|plan|draft|give|fund|hedge|allocate|transfer|redeem|liquidate)\b/iu;

/** True when the words ask Lyko to do something (not only to explain or read). */
export function isActionRequest(message: string): boolean {
  const t = intentEnglish(message).trim().toLowerCase();
  if (!ACTION.test(t)) return false;
  // "What does repay cost?" asks; "can you repay my loan?" and "repay my loan" act.
  return !/^(?:what|which|where|why|how|is|are|does|do|did|when|who|will|should)\b/u.test(t);
}

/** Reads the requests the desk answers. Null for everything else. */
export function readDesk(message: string): DeskIntent | null {
  const t = intentEnglish(message).trim().toLowerCase().replace(/[’']/gu, "'").replace(/\s+/gu, " ");
  if (t.length === 0 || t.length > 300) return null;
  const amount = /\d/u.test(t);

  const order = readOrder(t);
  if (order) return { kind: "order", ...order };

  // What was paid, and what went wrong: reads from Trails.
  if (/\b(?:what|how much)\b.*\b(?:did i pay|have i paid|i paid|i've paid|i spent|have i spent|did i spend)\b.*\bfees?\b|\bfees?\b.*\b(?:i paid|i've paid|have i paid|did i pay)\b|\bmy fees\b|\bhow much\b.*\bfees?\b.*\b(?:so far|this month|in total|paid)\b/u.test(t)) return { kind: "fees-paid" };
  if (/\bwhy (?:did|has|was|is|didn't|did not)\b.*\b(?:fail\w*|refus\w+|den(?:y|ied)|reject\w*|block\w*|not go through|stop\w*|revert\w*|go through|work)\b|\bwhat went wrong\b|\bwhy (?:can't|couldn't) (?:i|you) (?:sign|send|swap|bridge)\b.*\b(?:last|that|it)\b/u.test(t)) return { kind: "why-failed", words: targetWords(t, /\b(?:why|did|has|was|is|didn't|not|fail\w*|refus\w+|denied|deny|reject\w*|block\w*|go|through|stop\w*|revert\w*|what|went|wrong|last|work|plan|step)\b/gu) };

  // A settled swap is final: "undo" plans the opposite swap.
  if (/\b(?:undo|reverse|revert|take back)\b.*\b(?:swap|conversion|convert|trade|exchange|last (?:one|move|plan|thing))\b|\b(?:swap|convert|trade) (?:it|that) back\b/u.test(t)) return { kind: "undo-swap" };

  // Loan health.
  const healthWord = /\b(?:health(?: factor)?|loans?|borrow\w*|lending|debt|liquidat\w+|at[- ]risk|risky|risk)\b/u.test(t);
  // "Is my loan safe?", "am I at risk of liquidation?": the same read, and the fix when there is one.
  if (!amount && /\b(?:my|i|am i)\b/u.test(t) && /\b(?:loans?|borrow\w*|debt|health factor|liquidat\w+)\b/u.test(t) && /\b(?:safe|ok|okay|fine|healthy|in danger|at risk|risky|get liquidated|be liquidated|close to liquidation)\b/u.test(t) && /\?|^(?:is|are|am|will|how)\b/u.test(t) && !/\bwhat (?:happens|if)\b/u.test(t)) return { kind: "fix-health" };
  if (healthWord && !amount && /\b(?:fix|improve|repair|restore|raise|lift|protect|rescue|heal|sort out|bring .* back|reduce|lower|de-?risk|safer|make .* safe|save)\b/u.test(t) && !/\b(?:tell me|let me know|alert|notify|watch|warn)\b/u.test(t)) return { kind: "fix-health" };

  // Everything at once.
  if (!amount && (/\brepay\b.*\b(?:everything|all|every|whole|entire|in full)\b|\bpay (?:off|back) (?:all|every|everything|my (?:whole|entire))\b|\bclose (?:all (?:of )?)?my loans?\b|\b(?:clear|settle) (?:all )?my debts?\b/u.test(t))) return { kind: "repay-all" };
  if (!amount && (/\b(?:exit|close|unwind|liquidate|cash out|get out of|pull out of|sell)\b.*\b(?:everything|all (?:of )?(?:my |the )?positions?|it all|all of it|every position|all my (?:money|funds))\b|\b(?:everything|all (?:of it|my (?:money|funds|positions?))?) (?:to|into|in|back to) usdc\b|\bgo (?:all )?(?:to )?(?:cash|usdc)\b/u.test(t))) return { kind: "exit-all" };
  if (!amount && /\b(?:move|put|sweep|deploy|send|invest|park)\b.*\b(?:all )?(?:my |the )?idle\b/u.test(t) && !/\b(?:every|each|when|if|autopilot)\b/u.test(t)) return { kind: "idle-to-work", token: /\beurc\b/u.test(t) ? "EURC" : "USDC" };
  if (!amount && /\bput\b.*\b(?:my )?(?:money|cash|funds|usdc|eurc|savings)\b.*\bto work\b/u.test(t) && !/\b(?:half|third|quarter|some|part|%|every|each|when|if|low|medium|high|risk)\b/u.test(t)) return { kind: "idle-to-work", token: /\beurc\b/u.test(t) ? "EURC" : "USDC" };

  // Running things, by name. The Whistle, a new stop-loss and a new watch have their own readers.
  if (/\b(?:what(?:'s| is) running|what do i have running|show (?:me )?(?:what(?:'s| is) running|everything running|my (?:automations|orders|watches|leashes|running things))|list (?:what(?:'s| is) running|my (?:automations|orders|watches|leashes)))\b/u.test(t)) return { kind: "running", action: "list", words: targetWords(t, /\b(?:what's|what|is|show|list|running|everything|have)\b/gu) };
  const verb = /^(?:please |can you |could you |lyko,? )?(pause|resume|unpause|restart|stop|cancel|revoke|remove|delete|turn off|switch off|kill|end|disable)\b/u.exec(t);
  if (verb && !/\b(?:everything|it all|all of (?:it|them)|stop[- ]loss|autopilot)\b/u.test(t) && !/\b(?:if|when|below|above|drops?|falls?)\b/u.test(t)) {
    const v = verb[1]!;
    const action = v === "pause" || v === "disable" || v === "turn off" || v === "switch off" ? "pause" : v === "resume" || v === "unpause" || v === "restart" ? "resume" : v === "cancel" || v === "remove" || v === "delete" ? "cancel" : "stop";
    return { kind: "running", action, words: targetWords(t.slice(verb[0].length), /\b(?:watching|running)\b/gu) };
  }
  return null;
}

/* ---------------------------------------------------------------- helpers */

function end(input: DeskInput, text: string, options: readonly string[] = [], question?: string, proposals: AgentProposal[] = []): TurnResult {
  for (const p of proposals) input.emit("proposal", p);
  if (options.length > 0) input.emit("clarify", { question: question ?? "Pick one, or say it your way:", options: [...options].slice(0, 4) });
  input.emit("text", { text });
  return { text, proposals, stopReason: options.length > 0 && question ? "clarify" : "end_turn", delegations: 0, modelCalls: 0 };
}

const scopeOf = (input: DeskInput): FixtureScope => (input.origin === "fold" ? "fold" : "chain");
const sampleOf = (input: DeskInput): boolean => !input.owner || isSampleOwner(input.owner);
const whose = (input: DeskInput) => (sampleOf(input) ? tx("the sample address") : "you");

function sourceOf(res: PositionsResponse, input: DeskInput, venue?: { readAt: string; block: string | null; name?: string }): BlockSource {
  if (sampleOf(input) && input.origin === "fold") return { source: "sample", readAt: isoOf(res.at), block: null };
  return { source: venue?.name ? `${venue.name} on Arc`.slice(0, 80) : "Arc chain and venue APIs", readAt: isoOf(venue?.readAt ?? res.at), block: blockOf(venue?.block ?? res.block) };
}

/** Plans typed actions and returns the sign card (or the reason there is none). */
async function plan(input: DeskInput, actions: readonly PlanAction[], title: string): Promise<{ proposal: AgentProposal | null; refused: string | null }> {
  const steps = stepsFor(input.emit);
  const routing = steps.start("route", tx("Planning the route under the Fence"));
  const owner = input.owner as Address;
  const outcome = await planActions(input.ctx, actions, title, { environment: input.environment, owner, fence: input.fence, proposedByAgent: false });
  if (outcome.kind !== "planned") {
    const why = outcome.kind === "refused" ? outcome.message : outcome.reply;
    routing.end("fail", tx("No route"), why);
    return { proposal: null, refused: why };
  }
  const { intent } = outcome.result;
  routing.end(intent.verdict.decision === "deny" ? "fail" : intent.verdict.decision === "confirm" ? "warn" : "ok", `${plural(intent.steps.length, "step")} · ${intent.verdict.decision === "deny" ? tx("refused by the Fence") : intent.verdict.decision === "confirm" ? tx("needs your confirmation") : tx("inside the Fence")}`, intent.steps.map((st) => st.summary).join(" → "));
  emitBlock(input.emit, fenceCard(intent, input.fence));
  emitBlock(input.emit, planFactsCard(intent));
  return {
    proposal: { intentId: outcome.result.stored ? intent.id : null, title, steps: intent.steps.map((st) => st.summary), decision: intent.verdict.decision, reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message), warnings: intent.warnings, ...preflightOf(intent), attribution: [{ agent: "Lyko", role: "orchestrator", part: title }], rationale: "" },
    refused: null,
  };
}

/** The line that closes a planned answer: what the Fence said, and the one next step. */
function planClose(input: DeskInput, p: AgentProposal): { lead: string | null; next: string } {
  const lead = preflightLead(p.preflight ?? []);
  const blocked = (p.preflight ?? []).some((f) => f.severity === "block");
  if (p.decision === "deny") return { lead: tx("The Fence said no: {value}", { value: p.reasons[0] ?? tx("a rule refused it") }), next: tx("ask for less, or change the rule in your Fence.") };
  if (lead) return { lead, next: blocked ? tx("pick a fix below; this can't be signed as it is.") : tx("pick a fix below, or review and sign it as it is.") };
  if (sampleOf(input)) return { lead: null, next: tx("connect a wallet to plan this for your own money; this is a dry run for the sample address.") };
  if (input.fence.mode === "dry-run") return { lead: null, next: tx("this is a dry run; switch your Fence to live to sign it.") };
  return { lead: null, next: p.decision === "confirm" ? tx("review the route, confirm, and sign it in your wallet.") : tx("review the route and sign it in your wallet.") };
}

async function readMap(input: DeskInput, label: string): Promise<PositionsResponse | null> {
  if (!input.owner) return null;
  const reading = stepsFor(input.emit).start("wallet", label);
  const res = await foldPositions(input.ctx, input.environment, input.owner, { personal: input.ownerVerified === true, fixture: scopeOf(input) }).catch(() => null);
  if (!res) reading.end("fail", tx("The venues could not be read"));
  else reading.end(res.summary.unavailable.length > 0 ? "warn" : "ok", `${plural(res.summary.positions, "position")} read`, res.summary.unavailable.length > 0 ? tx("Not read: {value}.", { value: res.summary.unavailable.join(", ") }) : undefined);
  return res;
}

/** The Fold's sample is a picture, not money: nothing is planned on it. */
function sampleFoldOnly(input: DeskInput): boolean {
  return input.origin === "fold" && sampleOf(input);
}

/* ------------------------------------------------------------ loan health */

function fixRows(fix: HealthFix, from: BlockSource): FactRow[] {
  return [
    { label: tx("Health on {account}", { account: fix.account }), value: fix.health, note: tx("the floor is {floor}; liquidation starts at 1.00", { floor: fix.floor }), from },
    { label: tx("Debt"), value: `${fix.debt.amount} ${fix.debt.symbol}`, note: usd(fix.debt.usd), from },
    ...(fix.repay ? [{ label: fix.repay.capped ? tx("Most the wallet can repay") : tx("Repay to reach {target}", { target: fix.target }), value: `${fix.repay.amount} ${fix.repay.symbol}`, note: tx("health after: {reaches}{value}", { reaches: fix.repay.reaches, value: fix.repay.capped ? tx(" (the wallet holds no more)") : "" }), from }] : []),
    ...(fix.collateral ? [{ label: fix.collateral.capped ? tx("Most collateral the wallet can add") : tx("Or add collateral to reach {target}", { target: fix.target }), value: `${fix.collateral.amount} ${fix.collateral.symbol}`, note: tx("{amount}; health after: {reaches}", { amount: usd(fix.collateral.usd), reaches: fix.collateral.reaches }), from }] : []),
  ];
}

const repaySentence = (f: HealthFix) => tx("Repay {amount} {symbol} on {venue}", { amount: f.repay!.amount, symbol: f.repay!.symbol, venue: f.venue });
const collateralSentence = (f: HealthFix) => tx("Supply {amount} {symbol} as collateral on {venue}", { amount: f.collateral!.amount, symbol: f.collateral!.symbol, venue: f.venue });

async function fixHealth(input: DeskInput): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  steps.start("intent", tx("Reading your request")).end("ok", tx("Fix the loans under the floor"));
  if (!input.owner) return end(input, tx("Connect a wallet so I can read its loans."));
  const res = await readMap(input, tx("Reading every loan"));
  if (!res) return end(input, tx("I couldn't read the lending venues just now, so I won't guess a fix.\n\n**Next:** try again in a moment."));
  const floor = input.fence.lending?.minHealthFactor ?? res.healthFloor;
  const report = healthReport(res, floor);
  const computing = steps.start("fence", tx("Computing the fix"));
  const who = sampleOf(input) ? tx("The sample address has") : tx("You have");
  if (report.atRisk.length === 0) {
    computing.end("ok", report.lowest ? tx("Lowest health {health}", { health: report.lowest.health }) : tx("No loans"));
    const from = sourceOf(res, input, report.lowest ? { readAt: report.lowest.readAt, block: report.lowest.block } : undefined);
    const unread = report.unread.length > 0 ? tx("\n- **Not read:** {value} (unknown, not assumed fine)", { value: report.unread.join(", ") }) : "";
    if (!report.lowest) {
      emitBlock(input.emit, { kind: "facts", title: tx("Loan health, read now"), rows: [{ label: tx("Loans"), value: tx("none"), note: tx("nothing can be liquidated"), from }, ...(report.unread.length > 0 ? [{ label: tx("Not read"), value: plural(report.unread.length, "venue"), note: report.unread.join(", ").slice(0, 200), from }] : [])], note: null });
      return end(input, tx("{who} no loans on Arc, so nothing is at risk.{value}\n\n**Next:** nothing to fix.", { who, value: unread ? `\n${unread}` : "" }), sampleOf(input) ? [] : [tx("Tell me if my health factor drops below 1.5")]);
    }
    emitBlock(input.emit, { kind: "facts", title: tx("Loan health, read now"), rows: [{ label: tx("Lowest health factor"), value: report.lowest.health, note: tx("{account}; the floor is {floor}", { account: report.lowest.account, floor: report.floor }), from }, { label: tx("Loans"), value: String(report.loans), note: tx("all above the floor"), from }], note: null });
    return end(input, tx("No loan is under the {floor} floor, so there is nothing to fix.\n\n- **Lowest health:** {health} on {account}\n- **Loans read:** {loans}{unread}\n\n**Next:** nothing to do; I can watch it for you.", { floor: report.floor, health: report.lowest.health, account: report.lowest.account, loans: report.loans, unread }), sampleOf(input) ? [] : [tx("Tell me if my health factor drops below {floor}", { floor: report.floor })]);
  }
  computing.end("warn", `${plural(report.atRisk.length, "loan")} under ${report.floor}`, report.atRisk.map((f) => `${f.account}: ${f.health}`).join("; "));
  const rows = report.atRisk.slice(0, 2).flatMap((f) => fixRows(f, sourceOf(res, input, { readAt: f.readAt, block: f.block })));
  emitBlock(input.emit, { kind: "facts", title: tx("Loans under the floor, with the fix computed"), rows: rows.slice(0, 8), note: tx("Amounts are computed from the health factor read on Arc: enough to pass the floor with a small buffer, never more than the wallet holds.") });
  const first = report.atRisk[0]!;
  const lead = tx("{value} under the {floor} floor{value2}.", { value: report.atRisk.length === 1 ? tx("The {account} loan is", { account: first.account }) : tx("{length} loans are", { length: report.atRisk.length }), floor: report.floor, value2: report.atRisk.length === 1 ? tx(" at health {health}", { health: first.health }) : "" });
  const options = report.atRisk.slice(0, 2).flatMap((f) => [...(f.repay ? [repaySentence(f)] : []), ...(f.collateral ? [collateralSentence(f)] : [])]).slice(0, 4);
  const bullets = [
    ...(first.repay ? [tx("- **Repay:** {amount} {symbol} lifts health to {reaches}{value}", { amount: first.repay.amount, symbol: first.repay.symbol, reaches: first.repay.reaches, value: first.repay.capped ? tx(", the most the wallet holds") : "" })] : []),
    ...(first.collateral ? [tx("- **Or add collateral:** {amount} {symbol} lifts it to {reaches}", { amount: first.collateral.amount, symbol: first.collateral.symbol, reaches: first.collateral.reaches })] : []),
    ...(report.atRisk.length > 1 ? [tx("- **Also under the floor:** {value}", { value: report.atRisk.slice(1, 3).map((f) => `${f.account} at ${f.health}`).join(", ") })] : first.notes.slice(0, 1).map((n) => tx("- **Note:** {n}", { n }))),
  ].slice(0, 3);
  if (options.length === 0) {
    return end(input, tx("{lead} The wallet holds nothing to repay with or to add as collateral.\n\n- **Debt:** {amount} {symbol}\n- **Needed:** {symbol} to repay, or more collateral\n\n**Next:** fund the wallet, then say “fix my loan health” again.", { lead, amount: first.debt.amount, symbol: first.debt.symbol }));
  }
  if (sampleFoldOnly(input)) return end(input, tx("{lead}\n\n{value}\n\n**Next:** this is the sample flock; connect a wallet and I compute and plan this for your own loans.", { lead, value: bullets.join("\n") }));
  // One loan, one possible move: plan it now. Several possible moves: the owner picks.
  if (options.length === 1) {
    const f = first;
    const action: PlanAction = f.repay ? { verb: "repay", token: f.repay.symbol, amount: { exact: f.repay.amount }, venue: f.venue } : { verb: "supply", token: f.collateral!.symbol, amount: { exact: f.collateral!.amount }, venue: f.venue };
    const planned = await plan(input, [action], f.repay ? tx("Repay {amount} {symbol} on {account}", { amount: f.repay.amount, symbol: f.repay.symbol, account: f.account }) : tx("Add {amount} {symbol} as collateral on {account}", { amount: f.collateral!.amount, symbol: f.collateral!.symbol, account: f.account }));
    if (!planned.proposal) return end(input, tx("{lead}\n\n{value}\n- **Not planned:** {refused}\n\n**Next:** say “{value2}” to try it again.", { lead, value: bullets.join("\n"), refused: planned.refused, value2: options[0] }), [options[0]!]);
    const close = planClose(input, planned.proposal);
    return end(input, `${close.lead ?? tx("{lead} Here is the fix, ready to review.", { lead })}\n\n${bullets.join("\n")}\n\n**Next:** ${close.next}`, [], undefined, [planned.proposal]);
  }
  return end(input, tx("{lead}\n\n{value}\n\n**Next:** pick the fix; I plan it under your Fence and you sign once.", { lead, value: bullets.join("\n") }), options, tx("Which fix should I plan?"));
}

/* ------------------------------------------------------- everything moves */

async function repayAll(input: DeskInput): Promise<TurnResult> {
  stepsFor(input.emit).start("intent", tx("Reading your request")).end("ok", tx("Repay every loan"));
  if (!input.owner) return end(input, tx("Connect a wallet so I can read its loans."));
  const res = await readMap(input, tx("Reading every loan"));
  if (!res) return end(input, tx("I couldn't read the lending venues just now.\n\n**Next:** try again in a moment."));
  const wallet = walletBalances(res);
  const debts = res.venues.flatMap((v) => v.positions.filter((p) => Number(p.valueUsd ?? 0) < 0 || p.assets.some((a) => a.role === "borrowed")).map((p) => ({ p, v })));
  if (debts.length === 0) {
    emitBlock(input.emit, { kind: "facts", title: tx("Loans, read now"), rows: [{ label: tx("Loans"), value: tx("none"), note: tx("nothing to repay"), from: sourceOf(res, input) }], note: null });
    return end(input, tx("{value} no loans on Arc, so there is nothing to repay.\n\n**Next:** nothing to do.", { value: sampleOf(input) ? tx("The sample address has") : tx("You have") }));
  }
  const left = new Map(wallet);
  const actions: PlanAction[] = [];
  const rows: FactRow[] = [];
  const lines: string[] = [];
  for (const { p, v } of debts.slice(0, 4)) {
    const owed = Math.abs(Number(p.amount));
    const held = left.get(p.symbol.toUpperCase()) ?? 0;
    const pay = Math.min(owed, held);
    const from = sourceOf(res, input, { readAt: v.readAt, block: v.block, name: v.venueName });
    const amount = pay >= owed ? null : String(Math.floor(pay * 100) / 100);
    rows.push({ label: tx("Owed on {value}", { value: p.label.split(" · ")[0] ?? v.venueName }), value: `${p.amount} ${p.symbol}`, note: pay <= 0 ? tx("no {symbol} in the wallet to repay with", { symbol: p.symbol }) : amount ? tx("the wallet covers {amount} {symbol}", { amount, symbol: p.symbol }) : tx("repaid in full"), from });
    if (pay <= 0 || (amount !== null && Number(amount) <= 0)) continue;
    left.set(p.symbol.toUpperCase(), held - pay);
    actions.push({ verb: "repay", token: p.symbol, amount: amount ? { exact: amount } : { all: true }, venue: p.venue });
    lines.push(`- **${p.label.split(" · ")[0] ?? v.venueName}:** ${amount ? tx("{amount} of {amount2} {symbol} (all the wallet holds)", { amount, amount2: p.amount, symbol: p.symbol }) : tx("all {amount} {symbol}", { amount: p.amount, symbol: p.symbol })}`);
  }
  emitBlock(input.emit, { kind: "facts", title: tx("Loans, read now"), rows: rows.slice(0, 8), note: tx("Repaying is free of Lykia's fee.") });
  if (actions.length === 0) return end(input, tx("The wallet holds nothing to repay with.\n\n{value}\n\n**Next:** fund the wallet with the borrowed token, then ask again.", { value: rows.slice(0, 3).map((r) => `- **${r.label}:** ${r.value}`).join("\n") }));
  if (sampleFoldOnly(input)) return end(input, tx("{length, plural, one {# loan} other {# loans}} on the sample flock.\n\n{value}\n\n**Next:** connect a wallet and I plan this for your own loans.", { length: debts.length, value: lines.slice(0, 3).join("\n") }));
  const planned = await plan(input, actions, tx("Repay every loan"));
  if (!planned.proposal) return end(input, tx("I couldn't build the repayment.\n\n- {refused}\n\n**Next:** name one loan and an amount, and I plan that one.", { refused: planned.refused }));
  const close = planClose(input, planned.proposal);
  return end(input, `${close.lead ?? tx("Repaying {length, plural, one {# loan} other {# loans}}, ready to review.", { length: actions.length })}\n\n${lines.slice(0, 3).join("\n")}\n\n**Next:** ${close.next}`, [], undefined, [planned.proposal]);
}

async function exitAll(input: DeskInput): Promise<TurnResult> {
  stepsFor(input.emit).start("intent", tx("Reading your request")).end("ok", tx("Bring everything back to USDC"));
  if (!input.owner) return end(input, tx("Connect a wallet so I can read what it holds."));
  const res = await readMap(input, tx("Reading every venue"));
  if (!res) return end(input, tx("I couldn't read your positions just now.\n\n**Next:** try again in a moment."));
  const all = res.venues.flatMap((v) => v.positions.map((p) => ({ p, v })));
  const hasDebt = all.some(({ p }) => Number(p.valueUsd ?? 0) < 0);
  const earning = all.filter(({ p }) => (p.venueKind === "vault" || p.venueKind === "lending" || p.venueKind === "market") && Number(p.valueUsd ?? 0) > 0.05 && p.collateral !== true && !p.assets.some((a) => a.role === "collateral" || a.role === "borrowed"));
  const tokens = all.filter(({ p }) => p.venueKind === "wallet" && p.symbol.toUpperCase() !== "USDC" && Number(p.valueUsd ?? 0) > 0.05 && /^(?:EURC|cirBTC|WETH)$/iu.test(p.symbol));
  const other = all.filter(({ p }) => p.venueKind === "lp" || p.venueKind === "gateway" || p.venueKind === "treasury").filter(({ p }) => Number(p.valueUsd ?? 0) > 0.05);
  const from = sourceOf(res, input);
  const actions: PlanAction[] = [
    ...earning.slice(0, 4).map(({ p }): PlanAction => ({ verb: "withdraw", token: p.symbol, amount: { all: true }, venue: p.venue })),
    ...tokens.slice(0, 3).map(({ p }): PlanAction => (p.symbol.toUpperCase() === "EURC" ? { verb: "fx", from: "EURC", to: "USDC", amount: { all: true } } : { verb: "swap", from: p.symbol, to: "USDC", amount: { all: true } })),
  ];
  const rows: FactRow[] = [
    ...earning.slice(0, 4).map(({ p }) => ({ label: tx("Withdraw from {value}", { value: p.label.split(" · ")[0] ?? p.venueName }), value: `${p.amount} ${p.symbol}`, note: p.valueUsd ? usd(p.valueUsd) : null, from })),
    ...tokens.slice(0, 3).map(({ p }) => ({ label: tx("Convert {symbol} to USDC", { symbol: p.symbol }), value: `${p.amount} ${p.symbol}`, note: p.valueUsd ? usd(p.valueUsd) : null, from })),
    ...(hasDebt ? [{ label: tx("Left as it is"), value: tx("loans and their collateral"), note: tx("collateral cannot leave while a loan is open; repay first"), from }] : []),
    ...(other.length > 0 ? [{ label: tx("Left as it is"), value: plural(other.length, "position"), note: tx("liquidity positions, Gateway and fund balances are not closed in a plan"), from }] : []),
  ];
  if (actions.length === 0) {
    return end(input, tx("Nothing to exit: {value}.{value2}\n\n**Next:** {value3}", { value: whose(input) === "you" ? tx("your money on Arc is already in USDC or in the wallet") : tx("the sample address holds nothing that earns or needs converting"), value2: hasDebt ? tx("\n\n- **Loans:** still open; repaying comes first") : "", value3: hasDebt ? tx("say “repay everything”.") : tx("nothing to do.") }), hasDebt ? [tx("Repay everything")] : []);
  }
  emitBlock(input.emit, { kind: "facts", title: tx("Back to USDC, read now"), rows: rows.slice(0, 8), note: tx("Withdrawing is free of Lykia's fee; conversions pay it.") });
  const bullets = [...(earning.length > 0 ? [tx("- **Withdraw:** {value}", { value: earning.slice(0, 3).map(({ p }) => `${p.amount} ${p.symbol} from ${p.label.split(" · ")[0] ?? p.venueName}`).join(", ") })] : []), ...(tokens.length > 0 ? [tx("- **Convert to USDC:** {value}", { value: tokens.slice(0, 3).map(({ p }) => `${p.amount} ${p.symbol}`).join(", ") })] : []), ...(hasDebt || other.length > 0 ? [tx("- **Left as it is:** {value}", { value: [hasDebt ? "loans and their collateral" : null, other.length > 0 ? plural(other.length, "liquidity or Gateway position") : null].filter(Boolean).join(", ") })] : [])].slice(0, 3);
  if (sampleFoldOnly(input)) return end(input, tx("Here is what leaving every position would move on the sample flock.\n\n{value}\n\n**Next:** connect a wallet and I plan this for your own money.", { value: bullets.join("\n") }));
  const planned = await plan(input, actions, tx("Exit everything to USDC"));
  if (!planned.proposal) return end(input, tx("I couldn't build the whole exit in one plan.\n\n- {refused}\n\n**Next:** exit one position at a time; pick one below.", { refused: planned.refused }), earning.slice(0, 3).map(({ p }) => tx("Withdraw all my {symbol} from {venue}", { symbol: p.symbol, venue: p.venue })));
  const close = planClose(input, planned.proposal);
  return end(input, `${close.lead ?? tx("Everything back to USDC: {length, plural, one {# step} other {# steps}}, ready to review.", { length: planned.proposal.steps.length })}\n\n${bullets.join("\n")}\n\n**Next:** ${close.next}`, hasDebt ? [tx("Repay everything")] : [], undefined, [planned.proposal]);
}

async function idleToWork(input: DeskInput, token: "USDC" | "EURC"): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  steps.start("intent", tx("Reading your request")).end("ok", tx("Put idle {token} to work", { token }));
  if (!input.owner) return end(input, tx("Connect a wallet so I can read what sits idle."));
  if (sampleFoldOnly(input)) return end(input, tx("This is the sample flock, so there is nothing of yours to move.\n\n**Next:** connect a wallet and I put your own idle money to work."));
  const reading = steps.start("wallet", tx("Reading the wallet"));
  const idle = await idleAboveFloor(input.ctx, input.environment, input.owner, token, input.ownerVerified === true);
  if (!idle) {
    reading.end("fail", tx("The wallet could not be read"));
    return end(input, tx("I couldn't read the wallet just now, so I won't guess what is idle.\n\n**Next:** try again in a moment."));
  }
  reading.end("ok", `${idle.amount} ${token} idle`, tx("Wallet {walletAmount} {token}; floor {floorUsd}.", { walletAmount: idle.walletAmount, token, floorUsd: idle.floorUsd }));
  const now = new Date(input.ctx.clock.now()).toISOString();
  const from: BlockSource = { source: "Arc chain · wallet balance", readAt: now, block: null };
  emitBlock(input.emit, { kind: "facts", title: tx("Idle {token}, read now", { token }), rows: [{ label: tx("In the wallet"), value: `${idle.walletAmount} ${token}`, note: null, from }, { label: tx("Kept at hand"), value: `${idle.floorUsd} ${token}`, note: token === "USDC" ? tx("your liquidity floor") : tx("no floor for this token"), from: { source: "Your Fold preferences", readAt: now, block: null } }, { label: tx("Idle above it"), value: `${idle.amount} ${token}`, note: tx("computed by Lykia"), from }], note: null });
  if (Number(idle.amount) <= 0) return end(input, tx("Nothing is idle: the wallet holds {walletAmount} {token} and {floorUsd} stays at hand.\n\n- **In the wallet:** {walletAmount} {token}\n- **Floor:** {floorUsd} {token}\n\n**Next:** say an amount if you want to go under the floor.", { walletAmount: idle.walletAmount, token, floorUsd: idle.floorUsd }), [tx("Put 10 {token} to work", { token })]);
  const planned = await plan(input, [{ verb: "earn", token, amount: { exact: idle.amount } }], tx("Put {amount} {token} to work", { amount: idle.amount, token }));
  if (!planned.proposal) return end(input, tx("{amount} {token} is idle, but I couldn't route it.\n\n- {refused}\n\n**Next:** ask where {token} earns to see the venues.", { amount: idle.amount, token, refused: planned.refused }), [tx("Where can I earn on {token}?", { token })]);
  const close = planClose(input, planned.proposal);
  return end(input, tx("{value}\n\n- **Idle:** {amount} {token}, above the {floorUsd} floor\n- **Route:** {value2}\n\n**Next:** {next}", { value: close.lead ?? tx("{amount} {token} is idle; here it is going to work.", { amount: idle.amount, token }), amount: idle.amount, token, floorUsd: idle.floorUsd, value2: planned.proposal.steps.slice(-1)[0] ?? tx("the best venue by rate and risk"), next: close.next }), [], undefined, [planned.proposal]);
}

async function undoSwap(input: DeskInput): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  steps.start("intent", tx("Reading your request")).end("ok", tx("The opposite of your last swap"));
  const honest = tx("A settled swap is final on Arc and cannot be undone.");
  if (sampleOf(input)) return end(input, tx("{honest} With a wallet connected I can plan the opposite swap at today's price.\n\n**Next:** connect a wallet, then ask again.", { honest }));
  if (input.ownerVerified !== true) return end(input, tx("{honest} I can plan the opposite swap, but your history is private until you sign in.\n\n**Next:** sign in with your wallet (one message, no transaction) and ask again.", { honest }));
  const reading = steps.start("read", tx("Reading your Trails"));
  const graphs = (await ownerIntents(input.ctx, input.owner as Address).catch(() => [])).filter((g) => g.environment === input.environment);
  let found: { inSym: string; outSym: string; outAmount: string; inAmount: string; at: string } | null = null;
  for (const g of graphs) {
    const st = [...g.steps].reverse().find((s) => s.status === "settled" && (s.kind === "swap" || s.kind === "fx") && s.inputs[0] && s.outputs[0]);
    if (st) {
      found = { inSym: st.inputs[0]!.symbol, outSym: st.outputs[0]!.symbol, inAmount: fromBaseUnits(st.inputs[0]!.amount, st.inputs[0]!.decimals), outAmount: fromBaseUnits(st.outputs[0]!.amount, st.outputs[0]!.decimals), at: st.settledAt ?? g.createdAt };
      break;
    }
  }
  if (!found) {
    reading.end("warn", tx("No settled swap"));
    return end(input, tx("{honest} There is also no settled swap in your Trails on Arc {environment} to reverse.\n\n**Next:** say the swap you want, with an amount.", { honest, environment: input.environment }), [tx("Convert 100 EURC to USDC")]);
  }
  reading.end("ok", `${found.inAmount} ${found.inSym} → ${found.outAmount} ${found.outSym}`);
  const from: BlockSource = { source: "Your Trails · settled steps", readAt: isoOf(found.at), block: null };
  emitBlock(input.emit, { kind: "facts", title: tx("Your last swap"), rows: [{ label: tx("You sold"), value: `${found.inAmount} ${found.inSym}`, note: null, from }, { label: tx("You received"), value: `${found.outAmount} ${found.outSym}`, note: null, from }], note: tx("The opposite swap runs at today's price and pays Lykia's fee again, so it returns a little less than you started with.") });
  const fx = [found.inSym, found.outSym].every((s) => /^(?:USDC|EURC)$/iu.test(s));
  const action: PlanAction = fx ? { verb: "fx", from: found.outSym, to: found.inSym, amount: { exact: found.outAmount } } : { verb: "swap", from: found.outSym, to: found.inSym, amount: { exact: found.outAmount } };
  const planned = await plan(input, [action], tx("Swap {outAmount} {outSym} back to {inSym}", { outAmount: found.outAmount, outSym: found.outSym, inSym: found.inSym }));
  if (!planned.proposal) return end(input, tx("{honest} I tried to plan the opposite swap and could not.\n\n- {refused}\n\n**Next:** say an amount you hold, like “convert 50 {outSym} to {inSym}”.", { honest, refused: planned.refused, outSym: found.outSym, inSym: found.inSym }));
  const close = planClose(input, planned.proposal);
  return end(input, tx("{value}\n\n- **Last swap:** {inAmount} {inSym} for {outAmount} {outSym}\n- **Back:** {outAmount} {outSym} to {inSym}, with the fee and the spread paid again\n\n**Next:** {next}", { value: close.lead ?? tx("{honest} This is the opposite swap at today's price.", { honest }), inAmount: found.inAmount, inSym: found.inSym, outAmount: found.outAmount, outSym: found.outSym, next: close.next }), [], undefined, [planned.proposal]);
}

/* ----------------------------------------------------------------- orders */

async function orderTurn(input: DeskInput, intent: Extract<DeskIntent, { kind: "order" }>): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  const o = intent.input;
  steps.start("intent", tx("Reading your request")).end("ok", o.kind === "dca" ? tx("A repeating buy") : tx("A limit order"));
  if (!input.owner) return end(input, tx("Connect a wallet so I can draft that order."));
  if (intent.missing === "executions") {
    const base = input.message.trim().replace(/[.?!]+$/u, "");
    const unit = o.intervalSeconds === 3_600 ? "hours" : o.intervalSeconds === 86_400 ? "days" : o.intervalSeconds === 604_800 ? "weeks" : "months";
    return end(input, tx("For how long should it run? Each run sells {amount} {sell} for {buy}.\n\n**Next:** pick one below, or say a number.", { amount: o.amount, sell: o.sell, buy: o.buy }), [4, 8, 12].map((n) => `${base} for ${n} ${unit}`), tx("For how long should it run?"));
  }
  const drafting = steps.start("draft", tx("Drafting the order"));
  const blocks: AnswerBlock[] = [];
  const tc: ToolContext = { ctx: input.ctx, environment: input.environment, owner: input.owner, ownerVerified: input.ownerVerified === true, agent: { name: "Lyko", role: "orchestrator", fence: input.fence, capabilities: ["read", "propose"] }, proposals: [], drafts: [], blocks, ground: newGround(input.message) };
  const out = await runTool("draft_order", o, tc);
  const card = blocks.find((b) => b.kind === "order");
  if (!out.ok || !card || card.kind !== "order") {
    drafting.end("fail", tx("Not drafted"), out.summary);
    return end(input, tx("I couldn't draft that order: {value}.\n\n**Next:** change the amount or the pair and say it again.", { value: out.summary.replace(/\.$/u, "") }));
  }
  drafting.end(card.decision === "deny" ? "fail" : card.decision === "confirm" ? "warn" : "ok", card.decision === "deny" ? tx("Refused by the Fence") : tx("Drafted"), card.summary);
  emitBlock(input.emit, card);
  if (card.decision === "deny") return end(input, tx("The Fence said no to this order: {value}\n\n**Next:** ask for a smaller amount per run, or change the rule in your Fence.", { value: card.reasons[0] ?? tx("a rule refused it") }));
  return end(input, tx("Order drafted. {value}.\n\n- **Each run:** swaps {swapped} {symbolIn} after a fee of {fee} {symbolIn}\n- **Runs:** {executions}, filled on chain when its condition holds\n- **Your money:** stays in your wallet until a run fills\n\n**Next:** {value2}", { value: card.summary.replace(/\.$/u, ""), swapped: card.perExecution.swapped, symbolIn: card.perExecution.symbolIn, fee: card.perExecution.fee, executions: card.executions, value2: sampleOf(input) ? tx("connect a wallet to sign an order of your own.") : tx("review it on the card and sign it once; cancel it any time by name.") }));
}

/* --------------------------------------------------------- running things */

const KIND_WORDS: readonly (readonly [RegExp, (i: FoldInstruction) => boolean])[] = [
  [/^(?:payments?|rent|salary|payroll|recurring)$/u, (i) => i.source === "recurring"],
  [/^(?:orders?|dca|twap|limit|buy|sell)$/u, (i) => i.kind === "order"],
  [/^(?:watch(?:es)?|alerts?)$/u, (i) => i.kind === "watch"],
  [/^(?:leash(?:es)?|bots?|agents?|key)$/u, (i) => i.kind === "leash"],
  [/^(?:automations?|sweeps?|rules?|schedule[ds]?)$/u, (i) => i.kind === "automation"],
  [/^(?:plans?|route)$/u, (i) => i.kind === "plan"],
  [/^(?:autopilot)$/u, (i) => i.kind === "autopilot"],
  [/^(?:invoices?|links?)$/u, (i) => i.kind === "payment"],
];

function scoreRow(i: FoldInstruction, words: readonly string[]): number {
  const hay = `${i.name} ${i.sourceLabel} ${i.trigger} ${i.nextRunLabel}`.toLowerCase();
  let score = 0;
  for (const w of words) {
    if (hay.includes(w)) score += w.length >= 4 ? 3 : 2;
    else if (w.length > 4 && hay.includes(w.replace(/s$/u, ""))) score += 2;
    for (const [re, is] of KIND_WORDS) if (re.test(w) && is(i)) score += 2;
  }
  return score;
}

const itemOf = (i: FoldInstruction): RunningItem => ({ id: i.id, source: i.source, name: i.name.slice(0, 240), sourceLabel: i.sourceLabel, status: i.status, nextLine: i.nextLine ? i.nextLine.slice(0, 300) : null, control: i.control ?? null });
const CONTROL_PAST: Readonly<Record<string, string>> = { pause: "pauses", resume: "resumes", stop: "stops", cancel: "cancels" };

async function runningTurn(input: DeskInput, intent: Extract<DeskIntent, { kind: "running" }>): Promise<TurnResult | null> {
  const steps = stepsFor(input.emit);
  if (sampleOf(input)) {
    if (input.origin === "fold") return end(input, tx("These are the sample flock's rows, so there is nothing of yours to stop.\n\n**Next:** connect a wallet and I manage what you have running."));
    steps.start("intent", tx("Reading your request")).end("ok", tx("Manage something running"));
    return end(input, tx("No wallet is connected, so nothing of yours is running here.\n\n**Next:** connect a wallet and sign in; then I can pause, stop or cancel it by name."));
  }
  if (input.ownerVerified !== true) {
    steps.start("intent", tx("Reading your request")).end("ok", tx("Manage something running"));
    return end(input, tx("What you have running is private until you sign in.\n\n**Next:** sign in with your wallet (one message, no transaction) and ask again."));
  }
  const reading = steps.start("read", tx("Reading what is running"));
  const view = await instructionsView(input.ctx, input.owner as Address).catch(() => null);
  if (!view) {
    reading.end("fail", tx("Could not be read"));
    return end(input, tx("I couldn't read what is running just now.\n\n**Next:** try again in a moment, or open Herding in the Fold."));
  }
  const live = view.instructions.filter((i) => (i.status === "active" || i.status === "paused" || i.status === "waiting") && (i.environment === null || i.environment === input.environment));
  reading.end("ok", `${plural(live.length, "thing")} running`);
  if (intent.action === "list") {
    if (live.length === 0) return end(input, tx("Nothing is running for you right now.\n\n**Next:** start something, like a watch or a recurring payment."), [tx("Tell me if my health factor drops below 1.5")]);
    emitBlock(input.emit, { kind: "running", title: tx("Running for you"), items: live.slice(0, 6).map(itemOf), note: live.length > 6 ? tx("{value} more in Herding.", { value: live.length - 6 }) : null });
    return end(input, tx("{length, plural, one {# thing is} other {# things are}} running for you.\n\n{value2}\n\n**Next:** use the control on a row, or tell me which one to stop.", { length: live.length, value2: live.slice(0, 3).map((i) => `- **${i.sourceLabel}:** ${i.name}`).join("\n") }));
  }
  if (live.length === 0) return end(input, tx("Nothing is running for you right now, so there is nothing to change.\n\n**Next:** nothing to do."));
  const scored = live.map((i) => ({ i, score: scoreRow(i, intent.words) })).sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const tied = scored.filter((s) => s.score === best.score && s.score > 0);
  if (best.score === 0 || tied.length > 1) {
    const shown = (best.score === 0 ? scored : tied).slice(0, 4).map((s) => s.i);
    emitBlock(input.emit, { kind: "running", title: best.score === 0 ? tx("Running for you") : tx("Which one?"), items: shown.map(itemOf), note: null });
    return end(input, tx("{value}\n\n{value2}\n\n**Next:** press the control on the one you mean.", { value: best.score === 0 ? tx("I found nothing running by that name.") : tx("{length} running things match that.", { length: tied.length }), value2: shown.slice(0, 3).map((i) => `- **${i.sourceLabel}:** ${i.name}`).join("\n") }));
  }
  const row = best.i;
  const control = row.control ?? null;
  emitBlock(input.emit, { kind: "running", title: control ? `${control.label}: ${row.name}`.slice(0, 160) : row.name.slice(0, 160), items: [itemOf(row)], note: control?.sign === "order-cancel" ? tx("Cancelling an order is one transaction you sign; nothing else moves.") : control?.sign === "revoke-session" ? tx("The key stops at once; then your wallet ends its session on chain.") : null });
  if (!control) return end(input, tx("{name} has no control from here right now.\n\n- **What it is:** {sourceLabel}, {status}\n\n**Next:** open Herding in the Fold to see it.", { name: row.name, sourceLabel: row.sourceLabel, status: row.status }));
  const wanted = intent.action;
  const same = control.action === wanted || (wanted === "stop" && control.action === "cancel") || (wanted === "cancel" && control.action === "stop") || (wanted === "stop" && control.action === "pause") || (wanted === "cancel" && control.action === "pause");
  const lead = same ? tx("Found it: {name}.", { name: row.name }) : tx("Found it: {name}. Its control right now is {label}{value}.", { name: row.name, label: control.label, value: row.status === "paused" ? tx(", because it is already paused") : "" });
  return end(input, tx("{lead}\n\n- **What it is:** {sourceLabel}, {status}{value}\n- **{label}:** {value2} it{value3}\n\n**Next:** press {label} on the card to confirm; nothing changes until you do.", { lead, sourceLabel: row.sourceLabel, status: row.status, value: row.nextLine ? tx("\n- **Next up:** {nextLine}", { nextLine: lower(row.nextLine) }) : "", label: control.label, value2: CONTROL_PAST[control.action] ?? "changes", value3: control.sign ? tx(", with one signature") : tx(" at once, no signature") }));
}

/* ------------------------------------------------------------------ reads */

async function feesPaid(input: DeskInput): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  steps.start("intent", tx("Reading your question")).end("ok", tx("Fees you paid"));
  if (sampleOf(input)) return end(input, tx("No wallet is connected, so there is no history to read.\n\n**Next:** connect a wallet and sign in; then I read the fees from your Trails."), [tx("What are the fees?")]);
  if (input.ownerVerified !== true) return end(input, tx("Your history is private until you sign in.\n\n**Next:** sign in with your wallet (one message, no transaction) and ask again."), [tx("What are the fees?")]);
  const reading = steps.start("read", tx("Reading your Trails"));
  const trails = await trailsFor(input.ctx, input.owner as Address).catch(() => null);
  if (!trails) {
    reading.end("fail", tx("Unavailable"));
    return end(input, tx("Your Trails are unavailable right now, so I won't guess what you paid.\n\n**Next:** try again in a moment."));
  }
  reading.end("ok", `${plural(trails.totals.settled, "settled step")}`);
  const now = new Date(input.ctx.clock.now()).toISOString();
  const from: BlockSource = { source: "Your Trails · settled steps", readAt: now, block: null };
  const paying = trails.items.filter((i) => i.kind === "settled" && i.feeUsd && Number(i.feeUsd) > 0);
  emitBlock(input.emit, { kind: "facts", title: tx("Fees you paid Lykia"), rows: [{ label: tx("Last {TRAIL_FEE_WINDOW_DAYS} days", { TRAIL_FEE_WINDOW_DAYS }), value: usd(trails.totals.feesUsd), note: tx("Lykia's fee on settled steps; network fees are separate"), from }, { label: tx("Settled steps"), value: String(trails.totals.settled), note: tx("{length} carried a fee; repaying and withdrawing are free", { length: paying.length }), from }, ...(paying[0] ? [{ label: tx("Most recent"), value: usd(paying[0].feeUsd!), note: paying[0].title.slice(0, 160), from: { ...from, readAt: isoOf(paying[0].at) } }] : [])], note: null });
  return end(input, tx("You paid Lykia {amount} in fees over the last {TRAIL_FEE_WINDOW_DAYS} days.\n\n- **Settled steps:** {settled}, of which {length} carried a fee\n- **Free:** repaying and withdrawing never pay it\n\n**Next:** open Trails in the Fold for each step with its transaction.", { amount: usd(trails.totals.feesUsd), TRAIL_FEE_WINDOW_DAYS, settled: trails.totals.settled, length: paying.length }));
}

async function whyFailed(input: DeskInput, words: readonly string[]): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  steps.start("intent", tx("Reading your question")).end("ok", tx("What went wrong"));
  if (sampleOf(input)) return end(input, tx("No wallet is connected, so there is no history to read.\n\n**Next:** connect a wallet and sign in; then I read what failed from your Trails."), [tx("What happens if a step fails?")]);
  if (input.ownerVerified !== true) return end(input, tx("Your history is private until you sign in.\n\n**Next:** sign in with your wallet (one message, no transaction) and ask again."), [tx("What happens if a step fails?")]);
  const reading = steps.start("read", tx("Reading your Trails"));
  const trails = await trailsFor(input.ctx, input.owner as Address).catch(() => null);
  if (!trails) {
    reading.end("fail", tx("Unavailable"));
    return end(input, tx("Your Trails are unavailable right now.\n\n**Next:** try again in a moment."));
  }
  const bad = trails.items.filter((i) => i.kind === "failed" || i.kind === "refused");
  const named = words.length > 0 ? bad.filter((i) => words.some((w) => `${i.title} ${i.detail}`.toLowerCase().includes(w))) : [];
  const hit = named[0] ?? bad[0];
  if (!hit) {
    reading.end("ok", tx("Nothing failed"));
    return end(input, tx("Nothing failed or was refused in your Trails.\n\n- **Settled steps:** ") + String(trails.totals.settled) + tx("\n\n**Next:** if a plan would not sign, say it again and I check it now."));
  }
  reading.end("warn", hit.kind === "refused" ? tx("Refused by the Fence") : tx("A step failed"), hit.title);
  const from: BlockSource = { source: "Your Trails", readAt: isoOf(hit.at), block: null };
  emitBlock(input.emit, { kind: "facts", title: hit.kind === "refused" ? tx("Refused by your Fence") : tx("A step that failed"), rows: [{ label: tx("What"), value: hit.title.slice(0, 200), note: null, from }, { label: tx("Why"), value: hit.detail.slice(0, 200), note: null, from }, { label: tx("When"), value: `${hit.at.slice(0, 10)} ${hit.at.slice(11, 16)} UTC`, note: `Arc ${hit.environment}`, from }], note: hit.kind === "failed" ? tx("A failed step moves nothing; only its network fee is spent.") : tx("A refused plan was never signed and moved nothing.") });
  return end(input, tx("{value}: {value2}.\n\n- **What:** {title}\n- **Moved:** nothing{value3}\n\n**Next:** say “{value4}” to plan it again; I check it against today's balances.", { value: hit.kind === "refused" ? tx("Your Fence refused it") : tx("It failed"), value2: hit.detail.replace(/\.$/u, ""), title: hit.title, value3: hit.kind === "failed" ? tx("; only the network fee of the failed step was spent") : "", value4: hit.title.replace(/[“”"]/gu, "") }), [hit.title.slice(0, 120)]);
}

/* ---------------------------------------------------------- self-knowledge */

function knowledgeRows(entries: readonly KnowledgeEntry[], now: string): FactRow[] {
  return entries.slice(0, 8).map((e) => ({ label: txKnown(e.name).slice(0, 80), value: (e.value ? txKnown(e.value) : (e.topic === "not-built" ? tx("not built") : e.topic === "off" ? tx("off here") : e.topic === "unknowable" ? tx("cannot be known") : tx("explained below"))).slice(0, 60), note: txKnown(e.plain).slice(0, 200), from: { source: e.source.slice(0, 80), readAt: now, block: null } }));
}

/** Answers a question about Lykia itself from the capability map: no model, every figure a constant the code enforces. */
export function knowledgeTurn(input: DeskInput, reading: KnowledgeReading, map: CapabilityMap): TurnResult {
  const now = new Date(input.ctx.clock.now()).toISOString();
  const net = map.environment === "mainnet" ? tx("Arc mainnet") : tx("Arc testnet");
  stepsFor(input.emit).start("intent", tx("Reading your question")).end("ok", reading.intent === "can" || reading.intent === "why-not" ? tx("What Lyko can and cannot do") : reading.intent === "cost" ? tx("What it costs") : reading.intent === "limit" ? tx("The limits") : reading.intent === "safe" ? tx("The risks") : tx("From Lyko's own map"));
  if (reading.can) {
    const c = reading.can;
    emitBlock(input.emit, { kind: "facts", title: tx("{name} on {net}", { name: c.name, net }), rows: [{ label: c.name, value: c.venues > 0 ? plural(c.venues, "venue") : tx("built in"), note: c.plain.slice(0, 200), from: { source: "capability map (executable venues)", readAt: now, block: null } }], note: null });
    return end(input, tx("Yes: {plain}\n\n- **How:** I plan it, check it against your Fence, and you sign once{value}\n\n**Next:** say “{say}”.", { plain: lower(c.plain), value: c.venues > 0 ? tx("\n- **Through:** {venues, plural, one {# venue} other {# venues}} on {net}, compared for you", { venues: c.venues, net }) : "", say: c.say }), [c.say]);
  }
  const first = reading.entries[0];
  if (!first) return end(input, tx("I do not have that in my map.\n\n**Next:** ask what I can do."), [tx("What can you do?")]);
  const title = reading.intent === "cost" ? tx("What it costs") : reading.intent === "limit" ? tx("The limits") : reading.intent === "safe" ? tx("What can go wrong") : reading.intent === "off" ? tx("What Lykia does not do") : first.name;
  emitBlock(input.emit, { kind: "facts", title: title.slice(0, 120), rows: knowledgeRows(reading.entries, now), note: reading.intent === "safe" ? tx("Lykia never calls a token, a venue or itself safe: it says what can be checked.") : null });
  const chips = [...new Set(reading.entries.map((e) => e.say).filter((s): s is string => Boolean(s)))].slice(0, 3);
  const next = chips[0] ? tx("say “{value}”.", { value: chips[0] }) : tx("ask me about any line on the card.");
  const more = reading.entries.slice(1, 4).map((e) => `- **${txKnown(e.name)}:** ${e.value ?? txKnown(e.plain).split(/(?<=[.。])\s*/u)[0]}`);
  const body = more.length > 0 ? `\n\n${more.slice(0, 3).join("\n")}` : "";
  switch (reading.intent) {
    case "can":
    case "why-not":
      return end(input, tx("{no}{plain}{body}\n\n**Next:** {next}", { no: reading.verdict === "no" ? tx("No. ") : "", plain: first.plain, body, next }), chips);
    case "about":
      // What cannot be known is said as a no, never dressed up as an answer.
      return end(input, tx("{no}{plain}{body}\n\n**Next:** {next}", { no: reading.verdict === "no" ? tx("No, I can't tell you that. ") : "", plain: first.plain, body, next }), chips);
    case "cost":
      return end(input, tx("{name}: {value}. {plain}{body}\n\n**Next:** {next}", { name: first.name, value: first.value, plain: first.plain, body, next }), chips);
    case "limit":
      return end(input, tx("{name}: {value}. {plain}{body}\n\n**Next:** {next}", { name: first.name, value: first.value, plain: first.plain, body, next }), chips);
    case "safe":
      return end(input, tx("I never call anything safe; here is what can go wrong. {plain}{body}\n\n**Next:** {next}", { plain: first.plain, body, next }), chips);
    case "off":
      return end(input, tx("Here is what I do not do on {net}.\n\n{value}\n\n**Next:** ask “what can you do?” for the other side.", { net, value: reading.entries.slice(0, 3).map((e) => `- **${txKnown(e.name)}:** ${txKnown(e.plain).split(/(?<=[.。])\s*/u)[0]}`).join("\n") }), [tx("What can you do?")]);
    default:
      return end(input, tx("{lead}{plain}{body}\n\n**Next:** {next}", { lead: first.value ? tx("{name}: {value}. ", { name: first.name, value: first.value }) : "", plain: first.plain, body, next }), chips);
  }
}

/** A self-knowledge reading for the sentence, or null. `refusalsOnly` keeps to what Lyko cannot do or cannot know. */
export async function readSelf(input: DeskInput, refusalsOnly: boolean): Promise<{ reading: KnowledgeReading; map: CapabilityMap } | null> {
  const text = intentEnglish(input.message);
  const map = await liveCapabilityMap(input.ctx, input.environment);
  const reading = readKnowledge(text, map.knowledge, canTargets(map));
  if (!reading) return null;
  if (refusalsOnly && reading.verdict !== "no") return null;
  // A question about the owner's own money is a read of their positions, not a definition.
  if (!refusalsOnly && (reading.intent === "define" || reading.intent === "safe" || reading.intent === "limit") && /\b(?:my|mine)\b/iu.test(text) && !/\bmy (?:fence|limit|limits|cap|caps)\b/iu.test(text)) return null;
  return { reading, map };
}

/* ------------------------------------------------------------------- desk */

/** Answers the request when it is one the desk decides in code; null hands it on (the reader, or the model). */
export async function deskTurn(input: DeskInput): Promise<TurnResult | null> {
  const intent = readDesk(input.message);
  if (!intent) return null;
  switch (intent.kind) {
    case "fix-health":
      return fixHealth(input);
    case "repay-all":
      return repayAll(input);
    case "exit-all":
      return exitAll(input);
    case "idle-to-work":
      return idleToWork(input, intent.token);
    case "undo-swap":
      return undoSwap(input);
    case "running":
      return runningTurn(input, intent);
    case "order":
      return orderTurn(input, intent);
    case "fees-paid":
      return feesPaid(input);
    case "why-failed":
      return whyFailed(input, intent.words);
  }
}

/** Chain names a sentence may carry, for callers that need to know a destination was named. */
export const DESTINATION_NAMES: readonly string[] = CCTP_DESTINATIONS.map((d) => d.name);
