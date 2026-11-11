/**
 * Lyko knows its own features. Without a model, the capability map answers
 * "what can you do", "where can I bridge to" and "which protocols for";
 * words that match a feature get it offered or started (a bot that needs
 * money gets a Leash, "what if EURC drops" runs the Stress test inline,
 * "stop everything" offers the Whistle); and a request missing something
 * essential gets one short question with options from the map.
 */
import { formatList, intlTag } from "../i18n/format.js";
import { count } from "../i18n/count.js";
import { LYKIA_TERMS, readStressQuestion, shockInputsFromPositions, stressAnswer, type AssistReading, type CapabilityMap } from "@lykia/core";
import type { CapabilitySection } from "@lykia/core/api/answer";
import type { DeterministicInput } from "./deterministic.js";
import { emitBlock, stepsFor } from "./cards.js";
import { readPositions } from "../positions/service.js";
import { agentDraft, autopilotDraft, autopilotTaskDraft, marketsFacts, poolsFacts, yieldsCard } from "./create.js";
import type { TurnResult } from "./orchestrator.js";

import { englishText, tx, txKnown } from "@lykia/core";
const SAMPLE = "0x000000000000000000000000000000000000dead";
const usd = (n: number) => `$${Math.round(n).toLocaleString(intlTag())}`;
/** A card line holds at most 200 characters: cut at the last whole sentence that fits, never mid-word. */
function clip(english: string, max = 200): string {
  // Shown in the request's language first, then shortened, so a long meaning is still recognised as a known phrase.
  const text = txKnown(english);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(": "));
  return stop > 60 ? cut.slice(0, stop + 1).replace(/:$/u, ".") : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function finish(input: DeterministicInput, text: string, options: readonly string[] = [], question?: string): TurnResult {
  if (options.length > 0) input.emit("clarify", { question: question ?? "Pick one, or say it your way:", options: [...options].slice(0, 4) });
  input.emit("text", { text });
  return { text, proposals: [], stopReason: options.length > 0 && question ? "clarify" : "end_turn", delegations: 0, modelCalls: 0 };
}

function bridgeSections(map: CapabilityMap): CapabilitySection[] {
  return map.bridges.map((b) => ({ label: tx("{name} · {length, plural, one {# chain} other {# chains}}", { name: b.name, length: b.destinations.length }), note: `${b.plain} ${b.when}`.slice(0, 240), items: b.destinations.slice(0, 16).map((d) => ({ name: d.name, note: null })) }));
}

/** The turn for a sentence the capability map reads. */
export async function assistTurn(input: DeterministicInput, reading: AssistReading, map: CapabilityMap): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  const net = map.environment === "mainnet" ? tx("Arc mainnet") : tx("Arc testnet");
  switch (reading.kind) {
    case "capabilities": {
      steps.start("intent", tx("Reading your question")).end("ok", tx("What Lyko can do"), tx("{length} actions · {length2} bridge routes · {length3} features", { length: map.actions.length, length2: map.bridges.length, length3: map.features.length }));
      emitBlock(input.emit, {
        kind: "capabilities",
        title: tx("What I can do on {net}", { net }),
        sections: [
          { label: tx("Move money"), items: map.actions.slice(0, 9).map((a) => ({ name: a.label, note: clip(tx("{plain} Through {value}{value2}.", { plain: a.plain, value: a.venues.slice(0, 3).map((v) => v.name).join(", "), value2: a.venues.length > 3 ? tx(" and {value} more", { value: a.venues.length - 3 }) : "" })) })) },
          { label: tx("Keep watch and stay in control"), items: map.features.slice(0, 11).map((f) => ({ name: f.name, note: clip(f.plain) })) },
          { label: tx("What I do not do"), items: map.knowledge.notBuilt.slice(0, 6).map((e) => ({ name: e.name, note: clip(e.plain) })) },
        ],
      });
      return finish(input, tx("I plan money moves on {net}, check every step against your Fence (your spending rules), and you sign once.\n\n- **Moves:** {value}\n- **Bridges:** USDC to {size} chains\n- **On watch:** watches, alerts, orders, Leashes and the Whistle\n\n**Next:** pick one below, or say what you want your money to do.", { net, value: map.actions.map((a) => txKnown(a.label).toLocaleLowerCase()).join(", "), size: new Set(map.bridges.filter((b) => b.id !== "gateway").flatMap((b) => b.destinations.map((d) => d.key))).size }), map.features.slice(0, 4).map((f) => f.say));
    }
    case "bridge-destinations": {
      const routes = map.bridges.filter((b) => b.id !== "gateway");
      const all = [...new Map(routes.flatMap((b) => b.destinations).map((d) => [d.key, d.name])).values()];
      steps.start("intent", tx("Reading your question")).end("ok", tx("Where USDC can go"), `${all.length} chains`);
      if (reading.token !== "USDC") {
        return finish(input, tx("Only USDC bridges from Arc today; {token} stays on Arc.\n\n- **Way round:** convert {token} to USDC, then bridge the USDC\n- **USDC reaches:** {value}{value2}\n\n**Next:** say “convert 100 {token} to USDC, then bridge it to Base”.", { token: reading.token, value: all.slice(0, 6).join(", "), value2: all.length > 6 ? tx(" and {value} more", { value: all.length - 6 }) : "" }), [tx("Convert 100 {token} to USDC, then bridge it to Base", { token: reading.token }), tx("Where can I bridge USDC to?")]);
      }
      emitBlock(input.emit, { kind: "capabilities", title: tx("Where USDC can go from {net}", { net }), sections: bridgeSections(map) });
      const solvers = routes.filter((b) => b.id !== "cctp").map((b) => b.name);
      return finish(input, tx("USDC can go to {length} chains from {net}.\n\n- **Default:** CCTP, Circle burns on Arc and mints native USDC there\n{value}- **Not yet:** Solana (it needs a token account Lykia does not create)\n\n**Next:** pick a chain below, or say “bridge 100 USDC to Base”.", { length: all.length, net, value: solvers.length > 0 ? tx("- **Also quoted:** {value}; I pick one only when it delivers more\n", { value: formatList(solvers) }) : "" }), ["Base", tx("Arbitrum"), "Ethereum", tx("OP Mainnet")].filter((c) => all.includes(c)).map((c) => tx("Bridge 100 USDC to {c}", { c })));
    }
    case "venues-for": {
      const action = map.actions.find((a) => a.id === reading.action)!;
      steps.start("intent", tx("Reading your question")).end("ok", tx("Where Lyko can {value}", { value: action.label.toLowerCase() }), count(action.venues.length, "venue"));
      emitBlock(input.emit, { kind: "capabilities", title: tx("{name} on {net}", { name: action.label, net }), sections: [{ label: action.plain, items: action.venues.slice(0, 16).map((v) => ({ name: v.name, note: v.via ? `through ${map.actions.flatMap((a) => a.venues).find((x) => x.id === v.via)?.name ?? v.via}` : null })) }] });
      return finish(input, tx("{label}: {length, plural, one {# venue} other {# venues}} on {net}, and I compare them for you.\n\n- **Venues:** {value2}{value3}\n- **How I pick:** the best rate or price within your Fence's risk level, and I say why\n\n**Next:** say “{say}”.", { label: action.label, length: action.venues.length, net, value2: action.venues.slice(0, 6).map((v) => v.name).join(", "), value3: action.venues.length > 6 ? tx(" and {value} more", { value: action.venues.length - 6 }) : "", say: action.say }), [action.say]);
    }
    case "explain": {
      const t = LYKIA_TERMS[reading.term];
      steps.start("intent", tx("Reading your question")).end("ok", tx("{word} · {plain}", { word: t.word, plain: t.plain }));
      const feature = map.features.find((f) => f.id === reading.term || (reading.term === "fence" && f.id === "fence-presets"));
      // The beta limit's figures are the deployment's own and ride on a card, like every other figure.
      const cap = reading.term === "fence" ? map.knowledge.limits.find((e) => e.id === "beta-cap") : undefined;
      const beta = cap ? tx("\n- **On top of it:** {name}, {value}, while Lykia is in beta", { name: cap.name, value: cap.value }) : "";
      if (cap) emitBlock(input.emit, { kind: "facts", title: tx("Above every Fence"), rows: [{ label: cap.name, value: cap.value ?? "", note: clip(cap.plain), from: { source: cap.source.slice(0, 80), readAt: new Date(input.ctx.clock.now()).toISOString(), block: null } }], note: null });
      if (feature) emitBlock(input.emit, { kind: "offer", feature: feature.id, title: tx("{word} · {plain}", { word: t.word, plain: t.plain }), line: t.line, href: feature.href, cta: tx("Open {word}", { word: t.word }) });
      return finish(input, tx("{word} means {plain}.\n\n- **What it does:** {line}{beta}\n\n**Next:** {value}.", { word: t.word, plain: t.plain, line: t.line, beta, value: feature ? tx("say “{say}”", { say: feature.say }) : tx("ask me to set one up") }), feature ? [feature.say] : []);
    }
    case "offer": {
      const feature = map.features.find((f) => f.id === reading.feature)!;
      if (reading.feature === "stress-test") return stressTurn(input, reading.reason);
      steps.start("intent", tx("Reading your request")).end("ok", tx("Offering {name}", { name: feature.name }), reading.reason);
      const stopAutopilot = reading.feature === "autopilot" && englishText(reading.reason).startsWith("Stop Autopilot");
      emitBlock(input.emit, { kind: "offer", feature: feature.id, title: stopAutopilot ? tx("Stop Autopilot") : feature.name, line: stopAutopilot ? reading.reason : `${feature.plain} ${reading.reason}`, href: reading.feature === "autopilot" && !stopAutopilot ? "/app/fold/pack?autopilot=on" : feature.href, cta: reading.feature === "whistle" ? tx("Open the Whistle") : reading.feature === "leash" ? tx("Set up a Leash") : stopAutopilot ? tx("Stop Autopilot") : tx("Open {name}", { name: feature.name }) });
      const lead = reading.feature === "leash" ? tx("That is a job for a Leash: your bot gets its own budget it cannot go past.") : reading.feature === "whistle" ? tx("The Whistle stops everything at once.") : stopAutopilot ? tx("Stop Autopilot ends Lyko's signing for you at once.") : reading.feature === "autopilot" ? tx("Autopilot lets Lyko sign your own automations, inside limits you set, on your own account.") : tx("{name} fits this.", { name: feature.name });
      const facts = reading.feature === "leash" ? tx("- **You choose:** how much a day, for how many days, and who it may pay\n- **You keep control:** stop it anytime with Revoke") : reading.feature === "whistle" ? tx("- **Stops:** every agent and every new move\n- **Still passes:** money coming home (repaying, withdrawing)") : stopAutopilot ? tx("- **At once:** the server asks Circle to sign nothing more\n- **Then:** sign revokeSession to end its session on chain") : reading.feature === "autopilot" ? tx("- **Limits:** at most $100 a step and $300 a day while in beta, lower if you choose\n- **Your money:** stays in your LykiaAccount; Stop ends it at once") : tx("- **What it does:** {plain}", { plain: feature.plain });
      return finish(input, tx("{lead}\n\n{facts}\n\n**Next:** pick one below.", { lead, facts }), reading.options, reading.feature === "leash" ? tx("How much should your bot get?") : tx("What should I do?"));
    }
    case "yields": {
      const reading2 = steps.start("read", tx("Reading {token} rates", { token: reading.token }));
      const card = await yieldsCard(input.ctx, input.environment, reading.token).catch(() => null);
      if (!card) {
        reading2.end("fail", tx("Rates unavailable"));
        return finish(input, tx("{token} rates are unavailable right now; I won't guess them.\n\n**Next:** ask again in a minute.", { token: reading.token }));
      }
      reading2.end(card.rows.length > 0 ? "ok" : "warn", card.summary);
      emitBlock(input.emit, card.block);
      if (card.rows.length === 0) return finish(input, tx("No {token} rate on {net} can be read right now.\n\n**Next:** ask again later, or ask where USDC earns.", { token: reading.token, net }), [tx("Where can I earn on {value}?", { value: reading.token === "USDC" ? "EURC" : "USDC" })]);
      return finish(input, tx("Here is where {token} earns on {net} right now, best first. The card names each rate's source and risk.\n\n**Next:** say how much should go to work; I plan it under your Fence and you sign once.", { token: reading.token, net }), [tx("Put my idle {token} to work at low risk", { token: reading.token }), tx("Put half my {token} to work", { token: reading.token })]);
    }
    case "pools": {
      const s2 = steps.start("read", tx("Reading new pools on Arc"));
      const card = await poolsFacts(input.ctx, input.environment).catch(() => null);
      s2.end(card?.block ? "ok" : "warn", card?.summary ?? tx("Unavailable"));
      if (card?.block) emitBlock(input.emit, card.block);
      return finish(input, card?.block ? tx("These pools opened on {net} recently. Each new token is checked: what can be proven, never \"safe\".\n\n**Next:** ask me to check a token before you touch it.", { net }) : tx("{value}\n\n**Next:** ask again later.", { value: card?.summary ?? tx("The pool radar is unavailable right now.") }), [tx("Check a token for me")]);
    }
    case "markets": {
      const s2 = steps.start("read", tx("Reading perps markets"));
      const card = await marketsFacts(input.ctx, reading.market).catch(() => null);
      s2.end(card?.block ? "ok" : "warn", card?.summary ?? tx("Unavailable"));
      if (card?.block) emitBlock(input.emit, card.block);
      return finish(input, card?.block ? tx("Perps data from Extended, whose collateral sits on Arc. Lykia shows it read-only.\n\n**Next:** to hedge on Arc itself, ask for a stop-loss or a limit order.") : tx("{value}\n\n**Next:** ask again later.", { value: card?.summary ?? tx("Extended's markets are unavailable right now.") }), [tx("Sell my cirBTC if it drops 10%")]);
    }
    case "create": {
      const s2 = steps.start("draft", reading.feature === "agent" ? tx("Drafting an agent") : reading.feature === "autopilot" ? tx("Drafting Autopilot") : tx("Drafting an Autopilot task"));
      const real = input.owner && input.owner.toLowerCase() !== SAMPLE ? input.owner : null;
      const drafted =
        reading.feature === "agent" ? agentDraft({ name: reading.name, role: reading.role, dailyUsd: reading.dailyUsd, environment: input.environment })
        : reading.feature === "autopilot" ? autopilotDraft({ perStepUsd: reading.perStepUsd, perDayUsd: reading.perDayUsd, days: reading.days, environment: input.environment })
        : await autopilotTaskDraft(input.ctx, real, input.environment, reading.task, reading.missing, reading.options);
      if (!drafted.ok) {
        s2.end("warn", tx("Needs one detail"), drafted.reason);
        return finish(input, tx("{question}\n\n**Next:** pick one below, or say it your way.", { question: drafted.question }), drafted.options.length > 0 ? drafted.options : reading.options, drafted.question);
      }
      s2.end("ok", drafted.summary);
      emitBlock(input.emit, drafted.block);
      const how = reading.feature === "agent" ? tx("Review it on the card: it holds a leash with its own Fence inside yours, and you can pause or revoke it in the Fold.") : reading.feature === "autopilot" ? tx("Review it on the card: you read what Autopilot holds, tick, and sign its session once. Stop ends it at once.") : tx("Confirm it on the card; Autopilot signs each run inside its limits, and you can pause it in the Fold.");
      return finish(input, tx("{summary}.\n\n{how}\n\n**Next:** open the card to review{value}.", { summary: drafted.summary, how, value: real ? "" : tx("; connect a wallet first, this is a sample") }));
    }
    case "clarify": {
      steps.start("intent", tx("Reading your request")).end("warn", tx("Needs one detail"), reading.question);
      const ask = `${reading.question.split("?")[0]}?`;
      return finish(input, tx("{ask}\n\n**Next:** pick one below, or name it{value}.", { ask, value: reading.missing === "destination" ? tx("; I pick the bridge that delivers the most and say why") : "" }), reading.options, ask);
    }
  }
}

/** "What if EURC drops 5%?": the Stress test on the owner's own positions, answered inline. */
async function stressTurn(input: DeterministicInput, lead: string): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  steps.start("intent", tx("Reading your question")).end("ok", tx("A stress test"), lead);
  const shocks = readStressQuestion(input.message)?.shocks ?? { EURC: -5, cirBTC: 0, ratesBps: 0 };
  if (!input.owner || input.owner.toLowerCase() === SAMPLE) {
    emitBlock(input.emit, { kind: "offer", feature: "stress-test", title: tx("Stress test"), line: tx("Try it on the sample flock in the Fold, or connect a wallet and I run it on yours."), href: "/app/fold/flock", cta: tx("Open the Stress test") });
    return finish(input, tx("{lead}: I need a wallet to run that on your holdings.\n\n**Next:** connect a wallet, or try the Stress test on the sample flock in the Fold.", { lead }));
  }
  const reading = steps.start("wallet", tx("Reading your positions"));
  const res = await readPositions(input.ctx, input.environment, input.owner, { personal: input.ownerVerified === true }).catch(() => null);
  if (!res) {
    reading.end("fail", tx("The venues could not be read"));
    return finish(input, tx("I couldn't read your positions just now, so I can't run the stress test.\n\n**Next:** try again in a moment."));
  }
  const { holdings, health, names } = shockInputsFromPositions(res.venues);
  const floor = Number(res.healthFloor) || 1.5;
  const a = stressAnswer(holdings, health, shocks, lead, floor, names);
  reading.end(a.safe ? "ok" : "warn", `${usd(a.before)} → ${usd(a.after)}`, res.summary.unavailable.length > 0 ? tx("Not read: {value}.", { value: res.summary.unavailable.join(", ") }) : undefined);
  emitBlock(input.emit, { kind: "stress", scenario: lead, sentence: a.sentence.slice(0, 400), beforeUsd: a.before.toFixed(2), afterUsd: a.after.toFixed(2), closest: a.closest ? { venue: a.closest.venue, health: a.closest.health.toFixed(2), roomPercent: a.closest.roomPercent.toFixed(1) } : null });
  const facts = [tx("- **Value:** {amount} → {amount2}", { amount: usd(a.before), amount2: usd(a.after) }), a.closest ? tx("- **Closest loan:** {venue}, health {value} (liquidation at 1.00)", { venue: a.closest.venue, value: a.closest.health.toFixed(2) }) : tx("- **Loans:** none, so nothing can be liquidated")];
  return finish(input, `${a.sentence}\n\n${facts.join("\n")}\n\n**Next:** ${a.safe ? tx("nothing to do; ask for another scenario any time.") : tx("repay part of the loan or add collateral; say “repay a quarter of my loan”.")}`, [tx("What if Bitcoin drops 20%?"), tx("What if rates go up 1%?")]);
}
