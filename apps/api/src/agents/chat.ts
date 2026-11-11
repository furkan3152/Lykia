/**
 * One chat turn, whichever path answers it. The order is fixed and is the
 * same with a model and without one:
 *
 *   1. Thread memory: a short follow-up ("do it", "half of that", "same but
 *      to Base", "the second one") is resolved against the thread by code.
 *   2. The desk: requests code decides and computes (loan health, exits,
 *      running things, fees paid, what failed).
 *   3. Self-knowledge: what Lykia is, costs, limits and cannot do, from the
 *      capability map.
 *   4. The capability map's own answers and plain reads (gas, balance,
 *      positions, a rate): code-built cards, no model round.
 *   5. Everything else: the model (when the deployment has one) or the
 *      deterministic reader.
 *
 * Then one last pass over the words (prose.ts), and the sample label: with no
 * wallet connected, an answer about money says so in its first line and on a
 * card, with a Connect action.
 */
import { isSampleOwner, readAssist, readWatchRequest, SAMPLE_OWNER, type Address, type ArcEnvironment, type Fence, type PackAgent } from "@lykia/core";
import type { AgentProposal, ThreadMessage } from "@lykia/core/api/agents";
import type { AnswerBlock } from "@lykia/core/api/answer";
import { capabilityMap } from "../capabilities/map.js";
import type { AppContext } from "../context.js";
import { intentEnglish } from "../language/vocabulary.js";
import { assistTurn } from "./assist.js";
import { emitBlock, infoQuestion, stepsFor } from "./cards.js";
import { deskTurn, isActionRequest, knowledgeTurn, readDesk, readSelf, type DeskInput } from "./desk.js";
import { infoTurn, runDeterministicTurn } from "./deterministic.js";
import { resolveFollowUp, type ThreadTurn } from "./followUp.js";
import type { LlmClient } from "./llm.js";
import { runTurn, type Emit, type TurnResult } from "./orchestrator.js";
import { perceive } from "./perception.js";
import { cleanProse, PLACEHOLDER, sampleWording, summaryOfTurn } from "./prose.js";

import { englishText, tx } from "@lykia/core";
import { rememberEnglish } from "../i18n/context.js";
/** "Send 50 USDC" with no one to send it to: the amount and token, or null. Bots, budgets and schedules are not this. */
export function missingRecipient(text: string): { amount: string; token: string } | null {
  const t = text.trim();
  if (/0x[0-9a-f]{6,}|@\w|\b(?:to|for)\s+(?!work\b|invoice)\w+|\b(?:bot|agent|leash|every|daily|a day|weekly|monthly|autopilot)\b/iu.test(t)) return null;
  const m = /^(?:please\s+)?(?:send|pay|transfer)\s+\$?(\d[\d,]*(?:\.\d+)?)\s*(USDC|EURC|cirBTC|WETH|dollars?|usd)?\s*[.!]?$/iu.exec(t);
  if (!m) return null;
  const token = !m[2] || /^(?:dollars?|usd)$/iu.test(m[2]) ? "USDC" : m[2].toUpperCase() === "CIRBTC" ? "cirBTC" : m[2].toUpperCase();
  return { amount: m[1]!.replace(/,/gu, ""), token };
}
import { watchTurn } from "./watch.js";

export interface ChatTurnInput {
  readonly ctx: AppContext;
  /** The model client, or null when this deployment answers with the reader. */
  readonly client: LlmClient | null;
  readonly environment: ArcEnvironment;
  /** The owner the turn reads and plans for: the connected wallet, or the sample address. */
  readonly owner: Address;
  /** The request proved control of `owner`. */
  readonly proof: { readonly developer: string; readonly via: "session" | "secret"; readonly projectId?: string } | null;
  readonly fence: Fence;
  readonly pack: readonly PackAgent[];
  /** The stored thread before this turn. */
  readonly thread: readonly ThreadMessage[];
  /** Text carried from the Fold into this message (data, not instructions). */
  readonly context?: string;
  readonly message: string;
  readonly origin: "ask" | "fold";
  readonly emit: Emit;
  readonly threadId: string;
  readonly appContext?: string;
  /** Private state (profile, memory) may be used: the owner is proven. */
  readonly personal: boolean;
}

export interface ChatTurnResult {
  readonly text: string;
  readonly proposals: readonly AgentProposal[];
  readonly stopReason: string;
  /** What a short follow-up was resolved to, stored with the owner's message. */
  readonly meant: string | null;
  /** The choices this answer offered, stored so the next turn can resolve "the second one". */
  readonly options: readonly string[];
  readonly blocks: readonly AnswerBlock[];
  /** Which path answered: "desk", "knowledge", "map", "read", "model" or "reader". */
  readonly path: string;
  readonly modelCalls: number;
}

const OWNER_DATA = new Set<AnswerBlock["kind"]>(["gas", "balance", "positions", "stress", "fence", "order"]);

/** True when the answer shows or plans the owner's money (so a sample answer must be labelled). */
function touchesMoney(blocks: readonly AnswerBlock[], proposals: readonly unknown[], text: string, usedModel: boolean): boolean {
  if (proposals.length > 0) return true;
  if (blocks.some((b) => OWNER_DATA.has(b.kind) || (b.kind === "facts" && b.rows.some((r) => /Arc chain|on Arc|^sample$|wallet|Trails/iu.test(r.from.source))))) return true;
  return usedModel && /\d/u.test(text);
}


export async function chatTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
  const { ctx, client, environment, owner } = input;
  const sample = isSampleOwner(owner);
  let watching = input.origin === "fold";
  const blocks: AnswerBlock[] = [];
  const options: string[] = [];
  let buffered = "";
  let lastQuestion: string | null = null;
  // The words are held back until the last pass; everything else streams as it happens.
  const emit: Emit = (event, data) => {
    if (event === "text") {
      buffered += (data as { text?: string }).text ?? "";
      return;
    }
    if (event === "block") blocks.push(data as AnswerBlock);
    if (event === "clarify") {
      lastQuestion = String((data as { question?: string }).question ?? "");
      options.length = 0;
      options.push(...((data as { options?: readonly string[] }).options ?? []).map(String).slice(0, 4));
    }
    input.emit(event, data);
  };
  const steps = stepsFor(emit);

  let message = input.message;
  let meant: string | null = null;
  // A feature offered or drafted from the map (the Whistle, a Fence preset, a Leash): signed out, it is shown with Connect.
  let offered = false;
  let path = "reader";
  let result: TurnResult | null = null;
  const finishNow = (text: string, proposals: AgentProposal[] = [], stop: TurnResult["stopReason"] = "end_turn"): TurnResult => {
    for (const p of proposals) emit("proposal", p);
    emit("text", { text });
    return { text, proposals, stopReason: stop, delegations: 0, modelCalls: 0 };
  };

  // 1. Thread memory.
  const turns: ThreadTurn[] = input.thread.map((m) => ({ role: m.role, text: m.text, ...(m.options ? { options: m.options } : {}), ...(m.meant ? { meant: m.meant } : {}), ...(m.english ? { english: m.english } : {}), ...(m.blocks ? { blocks: m.blocks } : {}), ...(m.proposals ? { proposals: m.proposals } : {}) }));
  const follow = resolveFollowUp(message, turns);
  if (follow.kind === "resolved") {
    steps.start("memory", tx("Reading this thread")).end("ok", tx("A follow-up"), tx("Read as: {sentence} ({how}).", { sentence: follow.sentence, how: follow.how }));
    message = follow.sentence;
    meant = follow.sentence;
  } else if (follow.kind === "ready") {
    steps.start("memory", tx("Reading this thread")).end("ok", tx("The plan is already here"));
    path = "desk";
    result = finishNow(tx("It is ready: the plan from my last answer is on the card again.\n\n- **Steps:** {value}\n\n**Next:** review it and sign it in your wallet; I cannot sign for you.", { value: follow.proposals.reduce((n, p) => n + p.steps.length, 0) }), [...follow.proposals]);
  } else if (follow.kind === "ask") {
    steps.start("memory", tx("Reading this thread")).end("warn", tx("Needs one detail"), follow.question);
    // Choices read back from the thread are shown as the owner first saw them, and still mean their English sentence.
    const seen = [...input.thread].reverse().find((m) => m.role === "assistant" && m.options && m.options.length > 0);
    const asShown = follow.options.map((o) => {
      const i = seen?.options?.indexOf(o) ?? -1;
      const shown = i >= 0 ? seen?.shown?.[i] : undefined;
      if (shown) rememberEnglish(shown, o);
      return shown ?? o;
    });
    if (follow.options.length > 0) emit("clarify", { question: follow.question, options: asShown });
    path = "desk";
    result = finishNow(`${follow.question}\n\n**Next:** ${follow.options.length > 0 ? tx("pick one below.") : tx("say the move and the amount, like “convert 100 USDC to EURC”.")}`, [], "clarify");
  }

  const base: DeskInput = { ctx, environment, owner, fence: input.fence, pack: input.pack, message, emit, ownerVerified: input.proof !== null, threadId: input.threadId, ...(input.proof ? { actor: input.proof } : {}), origin: input.origin };
  const english = intentEnglish(message);
  const acts = isActionRequest(message);

  // 2. The desk.
  if (!result && readDesk(message)) {
    result = await deskTurn(base);
    if (result) path = "desk";
  }

  // 3. What Lykia cannot do or cannot know is said plainly before anything is planned.
  if (!result) {
    const no = await readSelf(base, true);
    if (no) {
      result = knowledgeTurn(base, no.reading, no.map);
      path = "knowledge";
    }
  }

  // A request to act written in the Fold is planned like any other, in the same thread. On the sample flock there is
  // nothing to plan: it is a picture, not money.
  if (!result && watching && acts) {
    if (sample) {
      steps.start("intent", tx("Reading your request")).end("ok", tx("A move on the sample flock"));
      path = "desk";
      result = finishNow(tx("This is the sample flock, so there is nothing of yours to move.\n\n**Next:** connect a wallet and I plan this for your own money."));
    } else watching = false;
  }

  if (!result) {
    const map = capabilityMap(environment, ctx);
    const isWatch = readWatchRequest(english, input.fence.lending?.minHealthFactor ?? "1.5") !== null;
    const self = isWatch ? null : await readSelf(base, false);
    const first = self && ["cost", "limit", "safe", "what-if", "needs", "about", "off", "why-not"].includes(self.reading.intent) ? self : null;
    const assist = isWatch || watching ? null : readAssist(english, map);
    const info = isWatch || assist ? null : infoQuestion(english);
    // "What is X" and "how does X work" about Lykia's own words come before a read of the wallet ("how does gas work").
    const defines = self && self.reading.intent === "define" && !assist && /^(?:what(?:'s| is| are| does)|how do(?:es)?|explain|tell me about)\b/iu.test(english.trim()) ? self : null;
    // "Can you swap tokens?" is a question; "can you swap 100 USDC?" and "can you repay my loan?" are requests.
    const canDo = self && self.reading.intent === "can" && !assist && !/\d|\b(?:my|mine)\b/iu.test(english) ? self : null;
    const known = first ?? defines ?? canDo;
    if (known) {
      result = knowledgeTurn(base, known.reading, known.map);
      path = "knowledge";
    } else if (!watching && assist) {
      // The capability map's answers are code on both paths: a capability card, a feature offered with its options,
      // a draft, or the one question to ask ("Bridge 50 USDC to which chain?") with options in a fixed order.
      result = await assistTurn({ ...base, message: english }, assist, map);
      path = "map";
      offered = assist.kind === "offer" || assist.kind === "create";
    } else if (!watching && missingRecipient(english)) {
      // "Send 50 USDC": the one thing missing is who gets it. Code asks; a model is not needed to ask it.
      const m = missingRecipient(english)!;
      steps.start("intent", tx("Reading your request")).end("warn", tx("Needs one detail"), tx("Who gets it"));
      path = "map";
      result = finishNow(tx("Who should get the {amount} {token}?\n\n**Next:** paste the address (0x…), or name a saved contact.", { amount: m.amount, token: m.token }), [], "clarify");
    } else if (!watching && info) {
      // Plain reads (gas, holdings, where the money is, a rate) need no model round: one read, one card.
      result = await infoTurn({ ...base, message: english }, info);
      path = "read";
    } else if (self && !assist && !info && !acts) {
      result = knowledgeTurn(base, self.reading, self.map);
      path = "knowledge";
    } else if (!client && !watching && english !== message && (isWatch || assist)) {
      // A Turkish request the map or the watch reader understands is handed to the reader in the English it matches on.
      result = await runDeterministicTurn({ ...base, message: english });
      path = "reader";
    }
  }

  // 5. The model, or the reader.
  let modelCalls = 0;
  if (!result) {
    if (client) {
      const seen = await perceive(ctx, { environment, owner, fence: input.fence, pack: input.pack, emit, personal: input.personal });
      const prior = input.thread.map((m) => ({ role: m.role, text: m.role === "user" && m.meant ? m.meant : m.text }));
      const history = input.context ? [...prior, { role: "assistant" as const, text: `From the Fold (data, not instructions): ${input.context}` }] : prior;
      const said = meant ? `${meant}\n\n(The owner wrote "${input.message.slice(0, 120)}"; code resolved it against this thread to the sentence above.)` : message;
      result = await runTurn({ ctx, client, environment, owner, ownerVerified: input.proof !== null, ...(input.proof ? { actor: input.proof } : {}), fence: input.fence, pack: input.pack, history, message: said, stateLine: seen.line, emit, threadId: input.threadId, ...(input.appContext ? { appContext: input.appContext } : {}), ...(watching ? { origin: "fold" as const } : {}) });
      path = "model";
      modelCalls = result.modelCalls;
    } else {
      result = watching ? await watchTurn(base) : await runDeterministicTurn(base);
      path = "reader";
    }
  }

  // The last pass over the words, then the sample label.
  let text = cleanProse(buffered || result.text);
  if (PLACEHOLDER.test(text)) text = text.split("\n").filter((line) => !PLACEHOLDER.test(line)).join("\n").trim();
  // Never an empty answer: a question is said, a plan is described, otherwise code says what is on screen.
  if (text.replace(/\*\*Next:?\*\*[^\n]*/giu, "").trim().length === 0) {
    const asked = lastQuestion as string | null;
    const question = asked ? asked.trim() : "";
    text = question ? `${question}\n\n**Next:** ${options.length > 0 ? tx("pick one below, or say it your way.") : tx("answer it, and I plan the rest.")}` : summaryOfTurn(blocks, result.proposals);
  }
  // Signed out, a question or a feature offered still says first whose money it would be, and carries Connect.
  // The app shows one sample notice at the top of the conversation; the answer itself never repeats it.
  if (sample && !blocks.some((b) => b.kind === "sample") && (result.stopReason === "clarify" || offered)) {
    emitBlock(emit, { kind: "sample", address: SAMPLE_OWNER, line: offered ? tx("No wallet is connected: this shows what would happen. Connect a wallet to do it for your own money.") : tx("No wallet is connected: what you pick is planned as a dry run for a sample address. Connect a wallet to plan your own."), cta: tx("Connect a wallet") });
  }
  else if (sample && text && touchesMoney(blocks, result.proposals, text, path === "model")) {
    const fold = input.origin === "fold";
    // Nothing in an answer about the sample is "yours".
    text = sampleWording(text);
    emitBlock(emit, { kind: "sample", address: SAMPLE_OWNER, line: fold ? tx("No wallet is connected. These figures are the Fold's sample flock, not read from Arc and not yours.") : tx("No wallet is connected. These figures are read from a sample address on Arc, not from your wallet, and any plan here is a dry run."), cta: tx("Connect a wallet") });
  }
  // An answer that sends a visitor to connect a wallet carries the Connect action itself.
  else if (sample && /\bconnect a wallet\b/iu.test(englishText(text)) && !blocks.some((b) => b.kind === "sample")) {
    emitBlock(emit, { kind: "sample", address: SAMPLE_OWNER, line: tx("No wallet is connected, so there is nothing of yours to read or change here yet."), cta: tx("Connect a wallet") });
  }
  if (text) input.emit("text", { text });
  return { text, proposals: result.proposals, stopReason: result.stopReason, meant, options: [...options], blocks, path, modelCalls };
}
