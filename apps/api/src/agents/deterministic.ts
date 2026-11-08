/**
 * Lyko without a model. The deterministic reader turns the sentence into
 * actions; each action goes to the specialist whose job it is (payroll for
 * payments, the FX hedger for conversions, the yield keeper for vaults, the
 * treasurer for bridges, Gateway and credit), each specialist plans its part
 * under its own Fence, and parts from different specialists are merged into
 * one route under the owner's Fence. Same events as the model path, so the
 * deck renders both the same way.
 */
import type { Address, ArcEnvironment, Fence, IntentGraph, PackAgent, PlanAction } from "@lykia/core";
import { gasShortfall } from "@lykia/core/api/answer";
import type { AgentProposal } from "@lykia/core/api/agents";
import type { AppContext } from "../context.js";
import { services } from "../services.js";
import { balanceCard, emitBlock, fenceCard, gasCard, infoQuestion, positionsCard, quotedRate, rateCard, stepsFor, type InfoQuestion } from "./cards.js";
import { readPositions } from "../positions/service.js";
import { POSITION_STATE_LABELS, type PositionState } from "@lykia/core";
import { readWithMemory } from "../personal/reader.js";
import { isGoalLanguage } from "../compiler/lexicon.js";
import { compileIntent } from "../compiler/service.js";
import { deliver } from "../compiler/deliver.js";
import { planActions } from "./engine.js";
import { createWatch } from "./instructions.js";
import { readWatchRequest } from "@lykia/core";
import { mergeProposals, specialistFor, type Emit, type SpecialistRole, type TurnResult } from "./orchestrator.js";

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
export const PREVIEW_ON_MAINNET = "Preview on mainnet: ";

/** A planning failure caused by venues missing on Arc testnet (practice venues not deployed yet). */
export function practiceGap(message: string): boolean {
  return /practice|not deployed|testnet yet|mainnet only/iu.test(message);
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
  steps.start("intent", "Reading your request").end("ok", "A watch for Lyko on watch", request.label);
  const done = (text: string) => {
    emit("text", { text });
    return { text, proposals: [], stopReason: "end_turn" as const, delegations: 0, modelCalls: 0 };
  };
  if (!input.owner || input.owner.toLowerCase() === SAMPLE) return done(`That is a watch: ${request.label.toLowerCase()}.\n\n**Next:** connect a wallet and sign in, and I will hand it to Lyko on watch.`);
  if (input.ownerVerified !== true) return done(`That is a watch: ${request.label.toLowerCase()}. Nothing was saved: this chat has not proven control of the address.\n\n**Next:** sign in with your wallet (one message, no transaction) and ask again.`);
  const handing = steps.start("delegate", "Handing it to Lyko on watch", "Lyko");
  const made = await createWatch(input.ctx, { owner: input.owner, environment: input.environment, condition: request.condition, threadId: input.threadId ?? null }).catch((error: unknown) => error as Error);
  if (made instanceof Error) {
    handing.end("fail", "Not set", made.message);
    return done(`I couldn't set that watch: ${made.message}\n\n**Next:** change the condition and ask again.`);
  }
  handing.end("ok", "Watching", request.label);
  emit("tool", { agent: "Lyko", name: "watch_position", ok: true, summary: `Handed to Lyko on watch: ${request.label}` });
  emitBlock(emit, { kind: "herded", items: [{ kind: "watch", label: request.label, saved: true, href: "/app/fold/herding?show=watch", next: "Lyko on watch checks it each time it reads your Fold" }] });
  const defaulted = request.defaulted ? `\n- **Threshold:** ${(request.condition as { threshold?: string }).threshold ?? ""}, your Fence's health floor (say another number to change it)` : "";
  return done(`Lyko on watch has it: ${request.label.charAt(0).toLowerCase()}${request.label.slice(1)}.\n\n- **Where:** the Fold, under Herding, marked From Ask Lyko${defaulted}\n- **When it is met:** an insight in the Fold, with a move ready if there is one\n\n**Next:** nothing to sign; pause or remove it in the Fold any time.`);
}

/** Goal language without a model: the intent compiler's lexicon, one plan for now, drafts for later. */
async function compiledTurn(input: DeterministicInput): Promise<TurnResult> {
  const { emit } = input;
  const owner = input.owner as Address;
  const steps = stepsFor(emit);
  emit("task", { agent: "Lyko", role: "orchestrator", task: "compile the goal" });
  const compiling = steps.start("compile", "Compiling your goal");
  const result = await compileIntent(input.ctx, { text: input.message, owner, environment: input.environment, fence: input.fence, search: false, reader: "deterministic" });
  const verified = input.ownerVerified === true ? (input.actor ?? { developer: owner.toLowerCase(), via: "session" as const }) : null;
  const delivered = await deliver({ ctx: input.ctx, environment: input.environment, owner, fence: input.fence, verified, agent: { name: "Lyko", role: "orchestrator" }, proposedByAgent: false }, result);
  const v = delivered.view;
  compiling.end(result.status === "refused" ? "fail" : result.questions.length > 0 ? "warn" : "ok", result.status === "refused" ? "Refused" : `${v.now ? `${v.now.steps.length} now` : "Nothing now"} · ${v.scheduled.length} for later`, result.why.summary);
  if (v.now) {
    const gate = steps.start("fence", "Checking your Fence");
    gate.end(v.now.decision === "deny" ? "fail" : v.now.decision === "confirm" ? "warn" : "ok", v.now.decision === "deny" ? "Refused" : v.now.decision === "confirm" ? "Needs your confirmation" : v.now.decision === "unknown" ? "Checked when it runs" : "Allowed", v.now.reasons.slice(0, 2).join(" "));
  }
  emit("tool", { agent: "Lyko", name: "compile_goal", ok: result.status !== "refused", summary: result.why.summary });
  for (const d of delivered.drafts) emit("draft", d);
  emit("program", delivered.view);
  if (delivered.proposal) emit("proposal", delivered.proposal);
  if (result.questions.length > 0) emit("clarify", { question: result.questions[0]!.text, options: [...(result.questions[0]!.choices ?? [])] });
  const lines: string[] = [];
  if (result.status === "refused") {
    lines.push("I won't do that.", "", ...v.refusals.map((r) => `- ${r}`), "", "**Next:** ask for something your Fence allows.");
  } else {
    lines.push(result.questions.length > 0 ? "One question before this is ready." : v.now ? "Your plan is ready to review." : "Your plan is drafted for later.", "");
    if (v.now) lines.push(`- **Now:** ${v.now.steps.map((st) => st.summary).join("; ")}`);
    if (v.scheduled.length > 0) lines.push(`- **Later:** ${v.scheduled.map((sch) => sch.summary).join("; ")}`);
    if (v.assumptions.length > 0) lines.push(`- **Assumed:** ${v.assumptions.length} thing${v.assumptions.length === 1 ? "" : "s"} you can change below`);
    if (v.refusals.length > 0) lines.push(`- **Left out:** ${v.refusals.join(" ")}`);
    if (delivered.planError) lines.push(`- **Not built now:** ${delivered.planError}`);
    lines.push("", result.questions.length > 0 ? `**Next:** ${result.questions[0]!.text}` : v.now ? "**Next:** review the route and sign it in your wallet." : "**Next:** save the drafts below.");
  }
  const text = lines.join("\n").trim() || result.why.summary;
  emit("text", { text });
  return { text, proposals: delivered.proposal ? [delivered.proposal] : [], stopReason: result.questions.length > 0 ? "clarify" : "end_turn", delegations: 0, modelCalls: 0 };
}

const SAMPLE = "0x000000000000000000000000000000000000dead";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A token amount for a sentence: two decimals from 1 up, up to six below (gas is often a few cents). */
const amt = (v: string) => (Number(v) >= 1 ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(Number(Number(v).toFixed(6))));
const usd = (v: string) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Questions about gas, balances or the EURC rate: read the data, answer with a verdict and a card. */
async function infoTurn(input: DeterministicInput, question: InfoQuestion): Promise<TurnResult> {
  const { emit } = input;
  const steps = stepsFor(emit);
  const done = (text: string) => {
    emit("text", { text });
    return { text, proposals: [], stopReason: "end_turn" as const, delegations: 0, modelCalls: 0 };
  };
  steps.start("intent", "Reading your question").end("ok", question.kind === "gas" ? "A question about gas" : question.kind === "balance" ? "A question about your holdings" : question.kind === "positions" ? "Where your money is and what it is doing" : `The ${question.base}/${question.quote} rate`);
  if (question.kind === "positions") {
    if (!input.owner) return done("Connect a wallet so I can read where its money is.");
    const reading = steps.start("wallet", "Reading every venue");
    const res = await readPositions(input.ctx, input.environment, input.owner, { personal: input.ownerVerified === true }).catch(() => null);
    if (!res) {
      reading.end("fail", "The venues could not be read");
      return done("I couldn't read your positions just now.\n\n**Next:** try again in a moment.");
    }
    const all = res.venues.flatMap((v) => v.positions);
    reading.end(res.summary.unavailable.length > 0 ? "warn" : "ok", `${plural(all.length, "position")} in ${plural(res.venues.filter((v) => v.positions.length > 0).length, "venue")}`, res.summary.unavailable.length > 0 ? `Not read: ${res.summary.unavailable.join(", ")}.` : undefined);
    emitBlock(emit, positionsCard(res));
    if (all.length === 0) return done(`Nothing is deployed on Arc ${input.environment} for this address${res.summary.unavailable.length > 0 ? `, though ${res.summary.unavailable.join(", ")} could not be read` : ""}.\n\n**Next:** fund it with USDC, or say “put 100 USDC to work”.`);
    const risky = all.filter((p) => p.state === "at-risk" || p.state === "out-of-range");
    const states = (Object.entries(res.summary.byState) as [PositionState, string][]).filter(([, v]) => Number(v) > 0).sort((a, b) => Number(b[1]) - Number(a[1]));
    const lead = risky.length > 0 ? `${plural(risky.length, "position")} want${risky.length === 1 ? "s" : ""} attention: ${risky[0]!.doing.charAt(0).toLowerCase()}${risky[0]!.doing.slice(1)}.` : res.summary.netUsd !== null ? `Your money on Arc is worth ${usd(res.summary.netUsd)}, spread over ${plural(all.length, "position")}.` : `You have ${plural(all.length, "position")} on Arc; some are unpriced.`;
    const facts = [
      `- **By state:** ${states.slice(0, 4).map(([k, v]) => `${POSITION_STATE_LABELS[k].toLowerCase()} ${usd(v)}`).join(", ")}`,
      ...(res.summary.weightedApyPercent !== null ? [`- **Earning:** ${res.summary.weightedApyPercent}% weighted${res.summary.yearlyYieldUsd !== null ? `, about ${usd(res.summary.yearlyYieldUsd)} a year net of borrowing` : ""}`] : []),
      ...(res.summary.lowestHealth ? [`- **Lowest health:** ${Number(res.summary.lowestHealth.factor).toFixed(2)} on ${res.summary.lowestHealth.label}`] : res.summary.unavailable.length > 0 ? [`- **Not read:** ${res.summary.unavailable.join(", ")}`] : []),
    ].slice(0, 3);
    const next = risky[0]?.actions[0] ? `say “${risky[0].actions[0].sentence}”` : "open The Fold to see each position";
    return done(`${lead}\n\n${facts.join("\n")}\n\n**Next:** ${next}.`);
  }
  if (question.kind === "rate") {
    const pricing = steps.start("price", "Checking the reference rate");
    const card = await rateCard(input.ctx, question.base, question.quote, input.fence);
    if (!card || card.kind !== "rate") {
      pricing.end("fail", "No fresh reference price");
      return done(`I can't quote ${question.base}/${question.quote} right now: the reference price is stale or unreadable.\n\n**Next:** try again in a minute.`);
    }
    pricing.end("ok", `1 ${card.base} = ${Number(card.rate).toFixed(4)} ${card.quote}`, card.source ?? undefined);
    emitBlock(emit, card);
    const band = card.bandBps !== null ? `\n- **Your band:** a quote may sit at most ${(card.bandBps / 100).toFixed(2)}% from it` : "";
    return done(`1 ${card.base} buys ${Number(card.rate).toFixed(4)} ${card.quote} at the reference rate.\n\n- **Source:** ${(card.source ?? "oracle reference").replace(/chainlink:/giu, "Chainlink ")}${band}\n\n**Next:** say “convert 200 USDC to EURC” for a routed quote.`);
  }
  if (!input.owner) return done("Connect a wallet so I can read it.");
  const sample = input.owner.toLowerCase() === SAMPLE;
  const reading = steps.start("wallet", "Reading the wallet");
  const snap = await services(input.ctx).flock.snapshot(input.environment, input.owner).catch(() => null);
  if (!snap) {
    reading.end("fail", "The wallet could not be read");
    return done("I couldn't read the wallet just now.\n\n**Next:** try again in a moment.");
  }
  if (question.kind === "balance") {
    const card = balanceCard(snap);
    reading.end("ok", `${plural(snap.holdings.length, "holding")}${snap.totalUsd !== null ? ` · ${usd(snap.totalUsd)}` : ""}`);
    emitBlock(emit, card);
    const top = card && card.kind === "balance" ? card.holdings.slice(0, 3) : [];
    if (top.length === 0) return done(`${sample ? "The sample wallet" : "Your wallet"} is empty on Arc ${input.environment}.\n\n**Next:** fund it with USDC; Arc pays gas in USDC too.`);
    const lead = snap.totalUsd !== null ? `${sample ? "The sample wallet holds" : "You hold"} ${usd(snap.totalUsd)} on Arc ${input.environment}.` : `${sample ? "The sample wallet holds" : "You hold"} ${plural(snap.holdings.length, "holding")}; some are unpriced.`;
    return done(`${lead}\n\n${top.map((h) => `- **${h.symbol}:** ${amt(h.amount)}${h.usd !== null ? ` (${usd(h.usd)})` : ""} in ${h.where}`).join("\n")}\n\n**Next:** say “put my idle USDC to work” to earn on what sits still.`);
  }
  const card = await gasCard(input.ctx, input.environment, input.owner, snap, sample);
  if (!card || card.kind !== "gas") {
    reading.end("fail", "The gas balance could not be read");
    return done("I couldn't read the gas balance just now.\n\n**Next:** try again in a moment.");
  }
  const short = gasShortfall(card);
  const low = short !== "0";
  reading.end(low ? "warn" : "ok", `${amt(card.balance)} USDC for gas`, `Your floor is ${card.floor} USDC.`);
  emitBlock(emit, card);
  if (low) return done(`Gas is low: ${amt(card.balance)} USDC, under your ${card.floor} USDC floor.\n\n- **Short by:** ${amt(short)} USDC\n- **Why it matters:** Arc pays gas in USDC, and below the floor a plan can stop halfway.\n\n**Next:** send at least ${amt(short)} USDC to ${sample ? "the wallet" : "this wallet"}.`);
  return done(`Gas is fine: ${amt(card.balance)} USDC, above your ${card.floor} USDC floor.\n\n- **Why it matters:** Arc pays gas in USDC, so this covers your next plans.\n\n**Next:** nothing to do.`);
}

export async function runDeterministicTurn(input: DeterministicInput): Promise<TurnResult> {
  const { emit } = input;
  const steps = stepsFor(emit);
  // A watch request goes to Lyko on watch before anything is planned.
  const watch = readWatchRequest(input.message, input.fence.lending?.minHealthFactor ?? "1.5");
  if (watch) return watchTurn(input, watch);
  const question = infoQuestion(input.message);
  if (question) return infoTurn(input, question);
  if (input.owner && isGoalLanguage(input.message)) return compiledTurn(input);
  const reading = steps.start("intent", "Reading your request");
  // Memory ("again", named contacts) only for an owner this request proved control of.
  const parsed = await readWithMemory(input.ctx, input.ownerVerified === true ? input.owner : null, input.message);
  const done = (text: string, proposals: AgentProposal[], stopReason: TurnResult["stopReason"] = "end_turn") => {
    for (const p of proposals) emit("proposal", p);
    emit("text", { text });
    return { text, proposals, stopReason, delegations: 0, modelCalls: 0 };
  };
  const choices = (parsed.clarifyChoices?.[0]?.choices ?? []).slice(0, 4).map(String);
  if (parsed.command || parsed.easterEgg || parsed.actions.length === 0) {
    reading.end(parsed.clarify.length > 0 ? "warn" : "ok", parsed.command ? "A sheepdog command" : parsed.easterEgg ? "A hidden word" : parsed.clarify.length > 0 ? "Needs one detail" : "Nothing to plan");
    if (parsed.clarify.length > 0) emit("clarify", { question: parsed.clarify[0], options: choices });
    return done(parsed.reply, [], parsed.clarify.length > 0 ? "clarify" : "end_turn");
  }
  if (parsed.clarify.length > 0) {
    reading.end("warn", "Needs one detail", parsed.clarify[0]);
    emit("clarify", { question: parsed.clarify[0], options: choices });
    return done(parsed.clarify[0] ?? parsed.reply, [], "clarify");
  }
  reading.end("ok", `${plural(parsed.actions.length, "action")}: ${parsed.actions.map((a) => a.verb).join(" + ")}`);
  if (!input.owner) return done("Connect a wallet so I can plan that.", []);

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
  const failures: string[] = [];
  const planned: { actions: readonly PlanAction[]; proposal: AgentProposal }[] = [];
  const intents: IntentGraph[] = [];
  for (const group of groups) {
    // A chain across specialists is planned by Lyko under the owner's Fence: no single specialist's Fence covers every leg.
    const specialist = group.chained ? { name: "Lyko", role: "orchestrator" as const, fence: input.fence } : specialistFor(group.role, input.fence, input.pack);
    const part = group.actions.map((a) => a.verb).join(" + ");
    emit("task", { agent: specialist.name, role: specialist.role, task: part });
    const routing = steps.start("route", "Searching routes", specialist.name);
    const outcome = await planActions(input.ctx, group.actions, input.message, { environment: input.environment, owner: input.owner, fence: specialist.fence, proposedByAgent: groups.length > 1 });
    if (outcome.kind !== "planned") {
      const why = outcome.kind === "refused" ? outcome.message : outcome.reply;
      failures.push(why);
      routing.end("fail", "No route", why);
      emit("tool", { agent: specialist.name, name: "plan_intent", ok: false, summary: why });
      continue;
    }
    const { intent } = outcome.result;
    intents.push(intent);
    const venues = [...new Set(intent.steps.map((st) => st.route?.chosen.label ?? (st.kind === "transfer" ? "Direct transfer" : st.kind === "approve" ? "Exact approval" : st.venue)))].filter(Boolean);
    const beat = intent.steps.reduce((n, st) => n + (st.route?.alternatives.length ?? 0), 0);
    routing.end("ok", `${venues.slice(0, 2).join(", ") || "Direct"} · ${plural(intent.steps.length, "step")}`, [intent.steps.find((st) => st.route)?.route?.reason, beat > 0 ? `Beat ${plural(beat, "other option")}.` : null].filter(Boolean).join(" ") || intent.steps.map((st) => st.summary).join(" → "));
    const funds = intent.warnings.find((w) => /spendable|fund the wallet|insufficient|not enough/iu.test(w));
    if (funds) steps.start("wallet", "Checking the wallet", specialist.name).end("warn", "Short of funds", funds);
    const decision = intent.verdict.decision;
    const firstRule = intent.verdict.reasons.find((r) => r.decision === decision && decision !== "allow");
    steps.start("fence", "Checking your Fence", specialist.name).end(decision === "deny" ? "fail" : decision === "confirm" ? "warn" : "ok", decision === "deny" ? `Refused by ${firstRule?.rule ?? "a rule"}` : decision === "confirm" ? "Needs your confirmation" : "Allowed", intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message).slice(0, 3).join(" ") || undefined);
    emit("tool", { agent: specialist.name, name: "plan_intent", ok: true, summary: `${intent.verdict.decision}: ${intent.steps.map((st) => st.summary).join(" → ")}` });
    const proposal: AgentProposal = {
      intentId: outcome.result.stored ? intent.id : null,
      title: part,
      steps: intent.steps.map((st) => st.summary),
      decision: intent.verdict.decision,
      reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message),
      warnings: intent.warnings,
      attribution: [{ agent: specialist.name, role: specialist.role, part }],
      rationale: "",
    };
    proposals.push(proposal);
    planned.push({ actions: group.actions, proposal });
  }
  const merged = await mergeProposals(input, planned, input.fence);
  const final = merged ? [merged] : proposals;
  const denied = final.find((p) => p.decision === "deny");
  if (final.length === 0) {
    const reasons = [...new Set(failures)];
    const testnetGap = input.environment === "testnet" && failures.some(practiceGap);
    if (testnetGap) {
      const options = [`${PREVIEW_ON_MAINNET}${input.message}`, "Deploy the practice venues from the owner console"];
      emit("clarify", { question: "Arc testnet has no venue for this route yet. Preview it on mainnet as a dry run?", options });
      const text = `No route on testnet yet: the practice venues aren't deployed on Arc testnet, so I can't route this here.\n\n${reasons.map((r) => `- ${r}`).join("\n")}\n\n**Next:** preview it on mainnet as a dry run, or deploy the practice venues from the owner console.`;
      return done(text, [], "clarify");
    }
    return done(reasons.length > 0 ? `I couldn't build that plan.\n\n${reasons.map((r) => `- ${r}`).join("\n")}\n\n**Next:** change the amount or the venue and ask again.` : "I couldn't build that plan.\n\n**Next:** say it another way, with an amount and a token.", []);
  }
  // Cards: the Fence gate for a refusal or a confirmation, the rate tile for a conversion.
  for (const intent of intents) emitBlock(emit, fenceCard(intent, input.fence));
  const fx = intents.filter((i) => i.verdict.decision !== "deny").map(quotedRate).find((q) => q !== null);
  if (fx) emitBlock(emit, await rateCard(input.ctx, fx.base, fx.quote, input.fence, fx.rate));
  const dry = input.fence.mode === "dry-run" || input.owner.toLowerCase() === SAMPLE;
  // The rules that refused (not the ones that would only ask for a confirmation), three at most; the Fence card lists them all.
  const refusals = (p: AgentProposal): string[] => {
    const hard = intents.flatMap((i) => i.verdict.reasons.filter((r) => r.decision === "deny").map((r) => r.message));
    const list = [...new Set(hard.length > 0 ? hard : p.reasons)];
    return list.length > 3 ? [...list.slice(0, 3), `${list.length - 3} more rule${list.length - 3 === 1 ? "" : "s"} below`] : list;
  };
  // Earn steps say which venues were compared, from the route's own reason (core/routes.ts comparedLine).
  const compared = intents.flatMap((i) => i.steps.filter((st) => st.route && /Compared \d+ venues?:/u.test(st.route.reason)).map((st) => `- **Why ${st.route!.chosen.label}:** ${st.route!.reason}`));
  const stepsList = [...final.flatMap((p) => p.steps).map((st) => `- ${st}`), ...compared].join("\n");
  const text = denied
    ? `The Fence said no.\n\n${refusals(denied).map((r) => `- ${r}`).join("\n")}\n\n**Next:** ask for less, or change the rule in your Fence.`
    : final.some((p) => p.decision === "confirm")
      ? `Ready, with one confirmation.\n\n${stepsList}\n\n**Next:** review the route, confirm, and sign it in your wallet.`
      : dry
        ? `Dry run ready: ${plural(final.reduce((n, p) => n + p.steps.length, 0), "step")}, every one inside your Fence.\n\n${stepsList}\n\n**Next:** connect a wallet to plan this for real.`
        : `Ready to sign: ${plural(final.reduce((n, p) => n + p.steps.length, 0), "step")}, every one inside your Fence.\n\n${stepsList}\n\n**Next:** review the route and sign it in your wallet.`;
  return done(text, final);
}
