/**
 * Lyko without a model. The deterministic reader turns the sentence into
 * actions; each action goes to the specialist whose job it is (payroll for
 * payments, the FX hedger for conversions, the yield keeper for vaults, the
 * treasurer for bridges, Gateway and credit), each specialist plans its part
 * under its own Fence, and parts from different specialists are merged into
 * one route under the owner's Fence. Same events as the model path, so the
 * deck renders both the same way.
 */
import { intlTag } from "../i18n/format.js";
import { englishOf } from "../i18n/context.js";
import { count } from "../i18n/count.js";
import type { Address, ArcEnvironment, Fence, IntentGraph, PackAgent, PlanAction } from "@lykia/core";
import { gasShortfall } from "@lykia/core/api/answer";
import type { AgentProposal } from "@lykia/core/api/agents";
import type { AppContext } from "../context.js";
import { balanceCard, emitBlock, fenceCard, gasCard, planFactsCard, hiddenLine, infoQuestion, materialPositions, positionsCard, quotedRate, rateCard, stepsFor, type InfoQuestion } from "./cards.js";
import { foldPositions, foldSnapshot } from "../fold/sample.js";
import { POSITION_STATE_LABELS, type PositionState } from "@lykia/core";
import { readWithMemory } from "../personal/reader.js";
import { isGoalLanguage } from "../compiler/lexicon.js";
import { compileIntent } from "../compiler/service.js";
import { deliver } from "../compiler/deliver.js";
import { planActions, preflightOf } from "./engine.js";
import { services } from "../services.js";
import { createWatch } from "./instructions.js";
import { preflightLead, readAssist, readWatchRequest } from "@lykia/core";
import { capabilityMap } from "../capabilities/map.js";
import { assistTurn } from "./assist.js";
import { mergeProposals, specialistFor, type Emit, type SpecialistRole, type TurnResult } from "./orchestrator.js";

import { tx, phrase, txKnown } from "@lykia/core";
function roleForAction(action: PlanAction): SpecialistRole {
  switch (action.verb) {
    case "send":
      return "payroll";
    case "fx":
    case "swap":
      return "fx-hedger";
    case "earn":
    case "withdraw":
    case "supply":
    case "reserve":
      return "yield-keeper";
    case "rebalance":
      return "fx-hedger";
    default:
      return "treasurer";
  }
}

/** True when the action's amount is "what the previous step produced". */
export function spendsPrevious(action: PlanAction): boolean {
  const amount = (action as { amount?: unknown }).amount;
  return typeof amount === "object" && amount !== null && (amount as { previous?: unknown }).previous === true;
}

/** Clarify options that start with this prefix ask the web to switch to mainnet and re-ask the rest. */
export const PREVIEW_ON_MAINNET = phrase("Preview on mainnet: ");

/** A planning failure caused by venues missing on Arc testnet (practice venues not deployed yet). */
export function practiceGap(message: string): boolean {
  return /practice|not deployed|testnet yet|mainnet only/iu.test(englishOf(message));
}

export interface DeterministicInput {
  readonly ctx: AppContext;
  readonly environment: ArcEnvironment;
  readonly owner: Address | null;
  readonly fence: Fence;
  readonly pack: readonly PackAgent[];
  readonly message: string;
  readonly emit: Emit;
  /** Proven control of the owner (SIWE session or secret key): compiled drafts are saved, not only linked. */
  readonly ownerVerified?: boolean;
  readonly actor?: { readonly developer: string; readonly via: "session" | "secret"; readonly projectId?: string };
  /** The shared thread this turn is written to; a watch request is filed under it. */
  readonly threadId?: string;
}

/** "Watch my Aave position and tell me if health drops below 1.5": a watch task for Lyko on watch. */
async function watchTurn(input: DeterministicInput, request: NonNullable<ReturnType<typeof readWatchRequest>>): Promise<TurnResult> {
  const { emit } = input;
  const steps = stepsFor(emit);
  steps.start("intent", tx("Reading your request")).end("ok", tx("A watch for Lyko on watch"), request.label);
  const done = (text: string) => {
    emit("text", { text });
    return { text, proposals: [], stopReason: "end_turn" as const, delegations: 0, modelCalls: 0 };
  };
  if (!input.owner || input.owner.toLowerCase() === SAMPLE) return done(tx("That is a watch: {value}.\n\n**Next:** connect a wallet and sign in, and I will hand it to Lyko on watch.", { value: request.label.toLowerCase() }));
  if (input.ownerVerified !== true) return done(tx("That is a watch: {value}. Nothing was saved: this chat has not proven control of the address.\n\n**Next:** sign in with your wallet (one message, no transaction) and ask again.", { value: request.label.toLowerCase() }));
  const handing = steps.start("delegate", tx("Handing it to Lyko on watch"), "Lyko");
  const made = await createWatch(input.ctx, { owner: input.owner, environment: input.environment, condition: request.condition, threadId: input.threadId ?? null }).catch((error: unknown) => error as Error);
  if (made instanceof Error) {
    handing.end("fail", tx("Not set"), made.message);
    return done(tx("I couldn't set that watch: {message}\n\n**Next:** change the condition and ask again.", { message: made.message }));
  }
  handing.end("ok", tx("Watching"), request.label);
  emit("tool", { agent: "Lyko", name: "watch_position", ok: true, summary: `Handed to Lyko on watch: ${request.label}` });
  emitBlock(emit, { kind: "herded", items: [{ kind: "watch", label: request.label, saved: true, href: "/app/fold/herding?show=watches", next: tx("Lyko on watch checks it each time it reads your Fold") }] });
  const defaulted = request.defaulted ? tx("\n- **Threshold:** {value}, your Fence's health floor (say another number to change it)", { value: (request.condition as { threshold?: string }).threshold ?? "" }) : "";
  return done(tx("Lyko on watch has it: {value}{value2}.\n\n- **Where:** the Fold, under Herding, marked From Ask Lyko{defaulted}\n- **When it is met:** an insight in the Fold, with a move ready if there is one\n\n**Next:** nothing to sign; pause or remove it in the Fold any time.", { value: request.label.charAt(0).toLowerCase(), value2: request.label.slice(1), defaulted }));
}

/** Goal language without a model: the intent compiler's lexicon, one plan for now, drafts for later. */
async function compiledTurn(input: DeterministicInput): Promise<TurnResult> {
  const { emit } = input;
  const owner = input.owner as Address;
  const steps = stepsFor(emit);
  emit("task", { agent: "Lyko", role: "orchestrator", task: "compile the goal" });
  const compiling = steps.start("compile", tx("Compiling your goal"));
  const result = await compileIntent(input.ctx, { text: input.message, owner, environment: input.environment, fence: input.fence, search: false, reader: "deterministic" });
  const verified = input.ownerVerified === true ? (input.actor ?? { developer: owner.toLowerCase(), via: "session" as const }) : null;
  const delivered = await deliver({ ctx: input.ctx, environment: input.environment, owner, fence: input.fence, verified, agent: { name: "Lyko", role: "orchestrator" }, proposedByAgent: false }, result);
  const v = delivered.view;
  compiling.end(result.status === "refused" ? "fail" : result.questions.length > 0 ? "warn" : "ok", result.status === "refused" ? tx("Refused") : tx("{value} · {length} for later", { value: v.now ? `${v.now.steps.length} now` : tx("Nothing now"), length: v.scheduled.length }), result.why.summary);
  if (v.now) {
    const gate = steps.start("fence", tx("Checking your Fence"));
    gate.end(v.now.decision === "deny" ? "fail" : v.now.decision === "confirm" ? "warn" : "ok", v.now.decision === "deny" ? tx("Refused") : v.now.decision === "confirm" ? tx("Needs your confirmation") : v.now.decision === "unknown" ? tx("Checked when it runs") : tx("Allowed"), v.now.reasons.slice(0, 2).join(" "));
  }
  emit("tool", { agent: "Lyko", name: "compile_goal", ok: result.status !== "refused", summary: result.why.summary });
  for (const d of delivered.drafts) emit("draft", d);
  for (const b of delivered.blocks) emitBlock(emit, b);
  emit("program", delivered.view);
  if (delivered.proposal) emit("proposal", delivered.proposal);
  if (result.questions.length > 0) emit("clarify", { question: result.questions[0]!.text, options: [...(result.questions[0]!.choices ?? [])] });
  const lines: string[] = [];
  if (result.status === "refused") {
    lines.push(tx("I won't do that."), "", ...v.refusals.map((r) => `- ${r}`), "", tx("**Next:** ask for something your Fence allows."));
  } else {
    lines.push(result.questions.length > 0 ? tx("One question before this is ready.") : v.now ? tx("Your plan is ready to review.") : tx("Your plan is drafted for later."), "");
    if (v.now) lines.push(tx("- **Now:** {value}", { value: v.now.steps.map((st) => st.summary).join("; ") }));
    if (v.scheduled.length > 0) lines.push(tx("- **Later:** {value}", { value: v.scheduled.map((sch) => sch.summary).join("; ") }));
    if (v.assumptions.length > 0) lines.push(tx("- **Assumed:** {length, plural, one {# thing} other {# things}} you can change below", { length: v.assumptions.length }));
    if (v.refusals.length > 0) lines.push(tx("- **Left out:** {value}", { value: v.refusals.join(" ") }));
    if (delivered.planError) lines.push(tx("- **Not built now:** {planError}", { planError: delivered.planError }));
    lines.push("", result.questions.length > 0 ? `**Next:** ${result.questions[0]!.text}` : v.now ? tx("**Next:** review the route and sign it in your wallet.") : v.scheduled.some((x) => x.kind === "leash") ? tx("**Next:** review the leash on its card; you sign once there.") : tx("**Next:** save the drafts below."));
  }
  const text = lines.join("\n").trim() || result.why.summary;
  emit("text", { text });
  return { text, proposals: delivered.proposal ? [delivered.proposal] : [], stopReason: result.questions.length > 0 ? "clarify" : "end_turn", delegations: 0, modelCalls: 0 };
}

const SAMPLE = "0x000000000000000000000000000000000000dead";
const plural = count;
/** A token amount for a sentence: two decimals from 1 up, up to six below (gas is often a few cents). */
const amt = (v: string) => (Number(v) >= 1 ? Number(v).toLocaleString(intlTag(), { maximumFractionDigits: 2 }) : String(Number(Number(v).toFixed(6))));
const usd = (v: string) => `$${Number(v).toLocaleString(intlTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Questions about gas, balances or the EURC rate: read the data, answer with a verdict and a card. */
export async function infoTurn(input: DeterministicInput, question: InfoQuestion): Promise<TurnResult> {
  const { emit } = input;
  const steps = stepsFor(emit);
  const done = (text: string) => {
    emit("text", { text });
    return { text, proposals: [], stopReason: "end_turn" as const, delegations: 0, modelCalls: 0 };
  };
  steps.start("intent", tx("Reading your question")).end("ok", question.kind === "gas" ? tx("A question about gas") : question.kind === "balance" ? tx("A question about your holdings") : question.kind === "positions" ? tx("Where your money is and what it is doing") : tx("The {base}/{quote} rate", { base: question.base, quote: question.quote }));
  if (question.kind === "positions") {
    if (!input.owner) return done(tx("Connect a wallet so I can read where its money is."));
    const reading = steps.start("wallet", tx("Reading every venue"));
    const res = await foldPositions(input.ctx, input.environment, input.owner, { personal: input.ownerVerified === true, fixture: "chain" }).catch(() => null);
    if (!res) {
      reading.end("fail", tx("The venues could not be read"));
      return done(tx("I couldn't read your positions just now.\n\n**Next:** try again in a moment."));
    }
    // Dust and unpriced lines are counted in one line, never presented as positions.
    const material = materialPositions(res);
    const all = material.shown;
    const folded = hiddenLine(material.hidden);
    const whoseMoney = input.owner.toLowerCase() === SAMPLE ? tx("The sample address's money") : tx("Your money");
    reading.end(res.summary.unavailable.length > 0 ? "warn" : "ok", `${plural(all.length, "position")} in ${plural(res.venues.filter((v) => v.positions.some((p) => all.includes(p))).length, "venue")}`, res.summary.unavailable.length > 0 ? tx("Not read: {value}.", { value: res.summary.unavailable.join(", ") }) : undefined);
    const card = emitBlock(emit, positionsCard(res));
    // The largest lines, copied from the card: every figure in the answer is one the card shows.
    const largest = card && card.kind === "positions" ? card.rows.filter((r) => r.valueUsd !== null).slice(0, 2) : [];
    if (all.length === 0) return done(tx("Nothing of value is on Arc {environment} for this address{value}.{value2}\n\n**Next:** {value3}", { environment: input.environment, value: res.summary.unavailable.length > 0 ? tx(", though {value} could not be read", { value: res.summary.unavailable.join(", ") }) : "", value2: folded ? tx("\n\n- **Folded away:** {folded}", { folded }) : "", value3: input.owner.toLowerCase() === SAMPLE ? tx("connect a wallet to see your own money.") : tx("fund it with USDC, or say “put 100 USDC to work”.") }));
    const risky = all.filter((p) => p.state === "at-risk" || p.state === "out-of-range");
    const lead = risky.length > 0 ? tx("{length, plural, one {# position} other {# positions}} want{value} attention: {value2}{value3}.", { length: risky.length, value: risky.length === 1 ? "s" : "", value2: risky[0]!.doing.charAt(0).toLowerCase(), value3: risky[0]!.doing.slice(1) }) : res.summary.netUsd !== null ? tx("{whoseMoney} on Arc is worth {amount}, spread over {length, plural, one {# position} other {# positions}}.", { whoseMoney, amount: usd(res.summary.netUsd), length: all.length }) : tx("{whoseMoney} on Arc is worth {amount} at the prices that could be read, over {length, plural, one {# position} other {# positions}}.", { whoseMoney, amount: usd(res.summary.pricedNetUsd), length: all.length });
    const facts = [
      ...(largest.length > 0 ? [tx("- **Largest:** {value}", { value: largest.map((r) => `${r.label} ${Number(r.valueUsd) < 0 ? "−" : ""}${usd(String(Math.abs(Number(r.valueUsd))))} (${POSITION_STATE_LABELS[r.state as PositionState]?.toLowerCase() ?? r.state})`).join(", ") })] : []),
      ...(res.summary.weightedApyPercent !== null ? [tx("- **Earning:** {weightedApyPercent}% weighted{value}", { weightedApyPercent: res.summary.weightedApyPercent, value: res.summary.yearlyYieldUsd !== null ? tx(", about {amount} a year net of borrowing", { amount: usd(res.summary.yearlyYieldUsd) }) : "" })] : []),
      ...(res.summary.lowestHealth ? [tx("- **Lowest health:** {value} on {label}", { value: Number(res.summary.lowestHealth.factor).toFixed(2), label: res.summary.lowestHealth.label })] : res.summary.unavailable.length > 0 ? [tx("- **Not read:** {value}", { value: res.summary.unavailable.join(", ") })] : folded ? [tx("- **Folded away:** {folded}", { folded })] : []),
    ].slice(0, 3);
    const underFloor = risky.some((p) => p.state === "at-risk");
    const next = underFloor ? tx("say “fix my loan health” and I compute the repay that lifts it") : risky[0]?.actions[0] ? tx("say “{sentence}”", { sentence: risky[0].actions[0].sentence }) : tx("say what the money should do, or open the Fold for each position");
    return done(tx("{lead}\n\n{value}\n\n**Next:** {next}.", { lead, value: facts.join("\n"), next }));
  }
  if (question.kind === "rate") {
    const pricing = steps.start("price", tx("Checking the reference rate"));
    const card = await rateCard(input.ctx, question.base, question.quote, input.fence);
    if (!card || card.kind !== "rate") {
      pricing.end("fail", tx("No fresh reference price"));
      return done(tx("I can't quote {base}/{quote} right now: the reference price is stale or unreadable.\n\n**Next:** try again in a minute.", { base: question.base, quote: question.quote }));
    }
    pricing.end("ok", `1 ${card.base} = ${Number(card.rate).toFixed(4)} ${card.quote}`, card.source ?? undefined);
    emitBlock(emit, card);
    const band = card.bandBps !== null ? tx("\n- **Your band:** a quote may sit at most {value}% from it", { value: (card.bandBps / 100).toFixed(2) }) : "";
    return done(tx("1 {base} buys {value} {quote} at the reference rate.\n\n- **Source:** {value2}{band}\n\n**Next:** say “convert 200 USDC to EURC” for a routed quote.", { base: card.base, value: Number(card.rate).toFixed(4), quote: card.quote, value2: (card.source ?? "oracle reference").replace(/chainlink:/giu, "Chainlink "), band }));
  }
  if (!input.owner) return done(tx("Connect a wallet so I can read it."));
  const sample = input.owner.toLowerCase() === SAMPLE;
  const reading = steps.start("wallet", tx("Reading the wallet"));
  const snap = await foldSnapshot(input.ctx, input.environment, input.owner, { fixture: "chain" }).catch(() => null);
  if (!snap) {
    reading.end("fail", tx("The wallet could not be read"));
    return done(tx("I couldn't read the wallet just now.\n\n**Next:** try again in a moment."));
  }
  if (question.kind === "balance") {
    const card = balanceCard(snap);
    reading.end("ok", `${plural(snap.holdings.length, "holding")}${snap.totalUsd !== null ? ` · ${usd(snap.totalUsd)}` : ""}`);
    emitBlock(emit, card);
    const top = card && card.kind === "balance" ? card.holdings.slice(0, 3) : [];
    if (top.length === 0) return done(tx("{value} is empty on Arc {environment}.\n\n**Next:** fund it with USDC; Arc pays gas in USDC too.", { value: sample ? tx("The sample wallet") : tx("Your wallet"), environment: input.environment }));
    const lead = snap.totalUsd !== null ? tx("{value} {amount} on Arc {environment}.", { value: sample ? tx("The sample wallet holds") : tx("You hold"), amount: usd(snap.totalUsd), environment: input.environment }) : tx("{value} {length, plural, one {# holding} other {# holdings}}; some are unpriced.", { value: sample ? tx("The sample wallet holds") : tx("You hold"), length: snap.holdings.length });
    return done(tx("{lead}\n\n{value}\n\n**Next:** say “put my idle USDC to work” to earn on what sits still.", { lead, value: top.map((h) => `- **${h.symbol}:** ${amt(h.amount)}${h.usd !== null ? ` (${usd(h.usd)})` : ""} ${h.where === "wallet" ? tx("in the wallet") : tx("in {where}", { where: h.where })}`).join("\n") }));
  }
  const card = await gasCard(input.ctx, input.environment, input.owner, snap, sample);
  if (!card || card.kind !== "gas") {
    reading.end("fail", tx("The gas balance could not be read"));
    return done(tx("I couldn't read the gas balance just now.\n\n**Next:** try again in a moment."));
  }
  const short = gasShortfall(card);
  const low = short !== "0";
  reading.end(low ? "warn" : "ok", tx("{balance} USDC for gas", { balance: amt(card.balance) }), tx("Your floor is {floor} USDC.", { floor: card.floor }));
  emitBlock(emit, card);
  if (low) return done(tx("Gas is low: {balance} USDC, under your {floor} USDC floor.\n\n- **Short by:** {short} USDC\n- **Why it matters:** Arc pays gas in USDC, and below the floor a plan can stop halfway.\n\n**Next:** send at least {short} USDC to {value}.", { balance: amt(card.balance), floor: card.floor, short: amt(short), value: sample ? tx("the wallet") : tx("this wallet") }));
  return done(tx("Gas is fine: {balance} USDC, above your {floor} USDC floor.\n\n- **Why it matters:** Arc pays gas in USDC, so this covers your next plans.\n\n**Next:** nothing to do.", { balance: amt(card.balance), floor: card.floor }));
}

export async function runDeterministicTurn(input: DeterministicInput): Promise<TurnResult> {
  const { emit } = input;
  const steps = stepsFor(emit);
  // A watch request goes to Lyko on watch before anything is planned.
  const watch = readWatchRequest(input.message, input.fence.lending?.minHealthFactor ?? "1.5");
  if (watch) return watchTurn(input, watch);
  // Lyko knows its own features: capability questions, feature offers and the one question to ask come from the map.
  const map = capabilityMap(input.environment);
  const assist = readAssist(input.message, map);
  if (assist) return assistTurn(input, assist, map);
  const question = infoQuestion(input.message);
  if (question) return infoTurn(input, question);
  if (input.owner && isGoalLanguage(input.message)) return compiledTurn(input);
  const reading = steps.start("intent", tx("Reading your request"));
  // Memory ("again", named contacts) only for an owner this request proved control of.
  const parsed = await readWithMemory(input.ctx, input.ownerVerified === true ? input.owner : null, input.message);
  const done = (text: string, proposals: AgentProposal[], stopReason: TurnResult["stopReason"] = "end_turn") => {
    for (const p of proposals) emit("proposal", p);
    emit("text", { text });
    return { text, proposals, stopReason, delegations: 0, modelCalls: 0 };
  };
  const choices = (parsed.clarifyChoices?.[0]?.choices ?? []).slice(0, 4).map(String);
  const standing = parsed.standing ?? [];
  if (standing.length > 0 && parsed.clarify.length === 0 && parsed.actions.length === 0) {
    const draft = standing[0]!;
    reading.end("ok", tx("Something to repeat"), draft.text);
    const real = input.owner && input.owner.toLowerCase() !== SAMPLE ? input.owner : null;
    if (!real || input.ownerVerified !== true) {
      emitBlock(emit, { kind: "herded", items: [{ kind: "automation", label: draft.text.slice(0, 160), saved: false, href: "/app/fold/herding?show=automations", next: real ? tx("Sign in to save it") : tx("Connect a wallet to save it") }] });
      return done(tx("I read that as something to repeat, but nothing is saved yet: {value}.\n\n- **What:** {text}\n- **Each time it fires:** I plan it under your Fence and you sign it\n\n**Next:** {value2}", { value: real ? tx("this chat has not proven the wallet is yours") : tx("no wallet is connected"), text: draft.text, value2: real ? tx("sign in with your wallet (one message, no transaction) and say it again.") : tx("connect a wallet and say it again.") }), []);
    }
    const saving = steps.start("draft", tx("Saving it to Herding"));
    const made = await services(input.ctx).standing.create({ owner: real, environment: input.environment, draft }).catch((error: unknown) => (error instanceof Error ? error : new Error("It could not be saved.")));
    if (made instanceof Error) {
      saving.end("fail", tx("Not saved"), made.message);
      return done(tx("I couldn't save that: {message}\n\n**Next:** change it and say it again.", { message: made.message }), []);
    }
    saving.end("ok", tx("Saved"), draft.text);
    emitBlock(emit, { kind: "herded", items: [{ kind: "automation", label: draft.text.slice(0, 160), saved: true, href: "/app/fold/herding?show=automations", next: tx("Each time it fires I plan it and you sign it") }] });
    return done(tx("Saved: it now runs from Herding in the Fold.\n\n- **What:** {text}\n- **Each time it fires:** I plan it under your Fence and you sign it; nothing moves on its own\n\n**Next:** nothing to sign now; pause or stop it by name here, or in the Fold.", { text: draft.text }), []);
  }
  if (parsed.command || parsed.easterEgg || parsed.actions.length === 0) {
    reading.end(parsed.clarify.length > 0 ? "warn" : "ok", parsed.command ? tx("A sheepdog command") : parsed.easterEgg ? tx("A hidden word") : parsed.clarify.length > 0 ? tx("Needs one detail") : tx("Nothing to plan"));
    if (parsed.clarify.length > 0) emit("clarify", { question: parsed.clarify[0], options: choices });
    // Unsure what to ask: next steps from the capability map, one tap each.
    else if (!parsed.command && !parsed.easterEgg) emit("clarify", { question: "Not sure where to start? Try one of these:", options: ["What can you do?", ...map.features.slice(0, 3).map((f) => f.say)] });
    return done(parsed.reply, [], parsed.clarify.length > 0 ? "clarify" : "end_turn");
  }
  if (parsed.clarify.length > 0) {
    reading.end("warn", tx("Needs one detail"), parsed.clarify[0]);
    emit("clarify", { question: parsed.clarify[0], options: choices });
    return done(parsed.clarify[0] ?? parsed.reply, [], "clarify");
  }
  reading.end("ok", `${plural(parsed.actions.length, "action")}: ${parsed.actions.map((a) => a.verb).join(" + ")}`);
  if (!input.owner) return done(tx("Connect a wallet so I can plan that."), []);

  // Group consecutive actions by specialist, keeping order. An action that spends the previous
  // step's output ("buy EURC … and lend it") stays with that step: planned apart, "it" has nothing to refer to.
  const groups: { role: SpecialistRole; actions: PlanAction[]; chained: boolean }[] = [];
  for (const action of parsed.actions) {
    const role = roleForAction(action);
    const last = groups[groups.length - 1];
    if (last && last.role === role) last.actions.push(action);
    else if (last && spendsPrevious(action)) {
      last.actions.push(action);
      last.chained = true;
    } else groups.push({ role, actions: [action], chained: false });
  }

  const proposals: AgentProposal[] = [];
  const refusedCards: AgentProposal[] = [];
  const failures: string[] = [];
  const planned: { actions: readonly PlanAction[]; proposal: AgentProposal }[] = [];
  const intents: IntentGraph[] = [];
  for (const group of groups) {
    // A chain across specialists is planned by Lyko under the owner's Fence: no single specialist's Fence covers every leg.
    const specialist = group.chained ? { name: "Lyko", role: "orchestrator" as const, fence: input.fence } : specialistFor(group.role, input.fence, input.pack);
    const part = group.actions.map((a) => a.verb).join(" + ");
    emit("task", { agent: specialist.name, role: specialist.role, task: part });
    const routing = steps.start("route", tx("Searching routes"), specialist.name);
    const outcome = await planActions(input.ctx, group.actions, input.message, { environment: input.environment, owner: input.owner, fence: specialist.fence, proposedByAgent: groups.length > 1 });
    if (outcome.kind !== "planned") {
      const why = outcome.kind === "refused" ? outcome.message : outcome.reply;
      failures.push(why);
      if (outcome.kind === "refused" && outcome.findings && outcome.findings.length > 0) refusedCards.push({ intentId: null, title: part, steps: [], decision: "deny", reasons: [why], warnings: [], preflight: outcome.findings, attribution: [{ agent: specialist.name, role: specialist.role, part }], rationale: "" });
      routing.end("fail", tx("No route"), why);
      emit("tool", { agent: specialist.name, name: "plan_intent", ok: false, summary: why });
      continue;
    }
    const { intent } = outcome.result;
    intents.push(intent);
    const venues = [...new Set(intent.steps.map((st) => st.route?.chosen.label ?? (st.kind === "transfer" ? tx("Direct transfer") : st.kind === "approve" ? tx("Exact approval") : st.venue)))].filter(Boolean);
    const beat = intent.steps.reduce((n, st) => n + (st.route?.alternatives.length ?? 0), 0);
    routing.end("ok", `${venues.slice(0, 2).join(", ") || tx("Direct")} · ${plural(intent.steps.length, "step")}`, [intent.steps.find((st) => st.route)?.route?.reason, beat > 0 ? `Beat ${plural(beat, "other option")}.` : null].filter(Boolean).join(" ") || intent.steps.map((st) => st.summary).join(" → "));
    const funds = intent.warnings.find((w) => /spendable|fund the wallet|insufficient|not enough/iu.test(w));
    if (funds) steps.start("wallet", tx("Checking the wallet"), specialist.name).end("warn", tx("Short of funds"), funds);
    const decision = intent.verdict.decision;
    const firstRule = intent.verdict.reasons.find((r) => r.decision === decision && decision !== "allow");
    steps.start("fence", tx("Checking your Fence"), specialist.name).end(decision === "deny" ? "fail" : decision === "confirm" ? "warn" : "ok", decision === "deny" ? tx("Refused by {value}", { value: firstRule?.rule ?? tx("a rule") }) : decision === "confirm" ? tx("Needs your confirmation") : tx("Allowed"), intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message).slice(0, 3).join(" ") || undefined);
    emit("tool", { agent: specialist.name, name: "plan_intent", ok: true, summary: `${intent.verdict.decision}: ${intent.steps.map((st) => st.summary).join(" → ")}` });
    const proposal: AgentProposal = {
      intentId: outcome.result.stored ? intent.id : null,
      title: part,
      steps: intent.steps.map((st) => st.summary),
      decision: intent.verdict.decision,
      reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message),
      warnings: intent.warnings, ...preflightOf(intent),
      attribution: [{ agent: specialist.name, role: specialist.role, part }],
      // Why this venue, from the route's own comparison: it travels with the plan, so its figures have a home.
      rationale: intent.steps.map((st) => st.route?.reason).filter((r): r is string => Boolean(r)).join(" ").slice(0, 600),
    };
    proposals.push(proposal);
    planned.push({ actions: group.actions, proposal });
  }
  const merged = await mergeProposals(input, planned, input.fence);
  const final = merged ? [merged] : proposals;
  const denied = final.find((p) => p.decision === "deny");
  if (final.length === 0) {
    const reasons = [...new Set(failures)];
    const refusedLead = preflightLead(refusedCards.flatMap((p) => p.preflight ?? []));
    if (refusedLead) return done(tx("{refusedLead}\n\n**Next:** pick one of the options, or ask another way.", { refusedLead }), refusedCards);
    const testnetGap = input.environment === "testnet" && failures.some(practiceGap);
    if (testnetGap) {
      const options = [`${txKnown(PREVIEW_ON_MAINNET)}${input.message}`, tx("Deploy the practice venues from the owner console")];
      emit("clarify", { question: "Arc testnet has no venue for this route yet. Preview it on mainnet as a dry run?", options });
      const text = tx("No route on testnet yet: the practice venues aren't deployed on Arc testnet, so I can't route this here.\n\n{value}\n\n**Next:** preview it on mainnet as a dry run, or deploy the practice venues from the owner console.", { value: reasons.map((r) => `- ${r}`).join("\n") });
      return done(text, [], "clarify");
    }
    return done(reasons.length > 0 ? tx("I couldn't build that plan.\n\n{value}\n\n**Next:** change the amount or the venue and ask again.", { value: reasons.map((r) => `- ${r}`).join("\n") }) : tx("I couldn't build that plan.\n\n**Next:** say it another way, with an amount and a token."), []);
  }
  // Cards: the Fence gate for a refusal or a confirmation, the rate tile for a conversion.
  for (const intent of intents) emitBlock(emit, fenceCard(intent, input.fence));
  // What each plan costs and why its route won, on a card: the figures the answer quotes are on screen.
  for (const intent of intents) emitBlock(emit, planFactsCard(intent));
  const fx = intents.filter((i) => i.verdict.decision !== "deny").map(quotedRate).find((q) => q !== null);
  if (fx) emitBlock(emit, await rateCard(input.ctx, fx.base, fx.quote, input.fence, fx.rate));
  const dry = input.fence.mode === "dry-run" || input.owner.toLowerCase() === SAMPLE;
  // The rules that refused (not the ones that would only ask for a confirmation), three at most; the Fence card lists them all.
  const refusals = (p: AgentProposal): string[] => {
    const hard = intents.flatMap((i) => i.verdict.reasons.filter((r) => r.decision === "deny").map((r) => r.message));
    const list = [...new Set(hard.length > 0 ? hard : p.reasons)];
    return list.length > 3 ? [...list.slice(0, 3), tx("{value, plural, one {# more rule} other {# more rules}} below", { value: list.length - 3 })] : list;
  };
  // Earn steps say which venues were compared, from the route's own reason (core/routes.ts comparedLine).
  const compared = intents.flatMap((i) => i.steps.filter((st) => st.route && /Compared \d+ venues?:/u.test(st.route.reason)).map((st) => tx("- **Why {label}:** {reason}", { label: st.route!.chosen.label, reason: st.route!.reason })));
  const stepsList = [...final.flatMap((p) => p.steps).map((st) => `- ${st}`), ...compared].join("\n");
  // Preflight leads: a block or a warning comes first, in code's own sentence, with its fixes as chips under the plan.
  const allFindings = final.flatMap((p) => p.preflight ?? []);
  const lead = preflightLead(allFindings);
  const blocked = allFindings.some((f) => f.severity === "block");
  const text = lead && !denied
    ? `${lead}\n\n${stepsList}\n\n**Next:** ${blocked ? tx("pick a fix below; this can't be signed as it is.") : tx("pick a fix below, or review and sign it as it is.")}`
    : denied
    ? tx("The Fence said no.\n\n{value}\n\n**Next:** ask for less, or change the rule in your Fence.", { value: refusals(denied).map((r) => `- ${r}`).join("\n") })
    : final.some((p) => p.decision === "confirm")
      ? tx("Ready, with one confirmation.\n\n{stepsList}\n\n**Next:** review the route, confirm, and sign it in your wallet.", { stepsList })
      : dry
        ? tx("Dry run ready: {n, plural, one {# step} other {# steps}}, every one inside your Fence.\n\n{stepsList}\n\n**Next:** connect a wallet to plan this for real.", { n: final.reduce((n, p) => n + p.steps.length, 0), stepsList })
        : tx("Ready to sign: {n, plural, one {# step} other {# steps}}, every one inside your Fence.\n\n{stepsList}\n\n**Next:** review the route and sign it in your wallet.", { n: final.reduce((n, p) => n + p.steps.length, 0), stepsList });
  return done(text, final);
}
