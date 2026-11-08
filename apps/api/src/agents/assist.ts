/**
 * Lyko knows its own features. Without a model, the capability map answers
 * "what can you do", "where can I bridge to" and "which protocols for";
 * words that match a feature get it offered or started (a bot that needs
 * money gets a Leash, "what if EURC drops" runs the Stress test inline,
 * "stop everything" offers the Whistle); and a request missing something
 * essential gets one short question with options from the map.
 */
import { betaCapExplain, LYKIA_TERMS, readStressQuestion, shockInputsFromPositions, stressAnswer, type AssistReading, type CapabilityMap } from "@lykia/core";
import type { CapabilitySection } from "@lykia/core/api/answer";
import type { DeterministicInput } from "./deterministic.js";
import { emitBlock, stepsFor } from "./cards.js";
import { readPositions } from "../positions/service.js";
import type { TurnResult } from "./orchestrator.js";

const SAMPLE = "0x000000000000000000000000000000000000dead";
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function finish(input: DeterministicInput, text: string, options: readonly string[] = [], question?: string): TurnResult {
  if (options.length > 0) input.emit("clarify", { question: question ?? "Pick one, or say it your way:", options: [...options].slice(0, 4) });
  input.emit("text", { text });
  return { text, proposals: [], stopReason: options.length > 0 && question ? "clarify" : "end_turn", delegations: 0, modelCalls: 0 };
}

function bridgeSections(map: CapabilityMap): CapabilitySection[] {
  return map.bridges.map((b) => ({ label: `${b.name} · ${b.destinations.length} chain${b.destinations.length === 1 ? "" : "s"}`, note: `${b.plain} ${b.when}`.slice(0, 240), items: b.destinations.slice(0, 16).map((d) => ({ name: d.name, note: null })) }));
}

/** The turn for a sentence the capability map reads. */
export async function assistTurn(input: DeterministicInput, reading: AssistReading, map: CapabilityMap): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  const net = map.environment === "mainnet" ? "Arc mainnet" : "Arc testnet";
  switch (reading.kind) {
    case "capabilities": {
      steps.start("intent", "Reading your question").end("ok", "What Lyko can do", `${map.actions.length} actions · ${map.bridges.length} bridge routes · ${map.features.length} features`);
      emitBlock(input.emit, {
        kind: "capabilities",
        title: `What I can do on ${net}`,
        sections: [
          { label: "Move money", items: map.actions.slice(0, 9).map((a) => ({ name: a.label, note: `${a.plain} Through ${a.venues.slice(0, 3).map((v) => v.name).join(", ")}${a.venues.length > 3 ? ` and ${a.venues.length - 3} more` : ""}.` })) },
          { label: "Keep watch and stay safe", items: map.features.slice(0, 8).map((f) => ({ name: f.name, note: f.plain })) },
        ],
      });
      return finish(input, `I plan money moves on ${net}, check every step against your Fence (your spending rules), and you sign once.\n\n- **Moves:** ${map.actions.map((a) => a.label.toLowerCase()).join(", ")}\n- **Bridges:** USDC to ${new Set(map.bridges.filter((b) => b.id !== "gateway").flatMap((b) => b.destinations.map((d) => d.key))).size} chains\n- **On watch:** watches, alerts, orders, Leashes and the Whistle\n\n**Next:** pick one below, or say what you want your money to do.`, map.features.slice(0, 4).map((f) => f.say));
    }
    case "bridge-destinations": {
      const routes = map.bridges.filter((b) => b.id !== "gateway");
      const all = [...new Map(routes.flatMap((b) => b.destinations).map((d) => [d.key, d.name])).values()];
      steps.start("intent", "Reading your question").end("ok", "Where USDC can go", `${all.length} chains`);
      if (reading.token !== "USDC") {
        return finish(input, `Only USDC bridges from Arc today; ${reading.token} stays on Arc.\n\n- **Way round:** convert ${reading.token} to USDC, then bridge the USDC\n- **USDC reaches:** ${all.slice(0, 6).join(", ")}${all.length > 6 ? ` and ${all.length - 6} more` : ""}\n\n**Next:** say “convert 100 ${reading.token} to USDC, then bridge it to Base”.`, [`Convert 100 ${reading.token} to USDC, then bridge it to Base`, "Where can I bridge USDC to?"]);
      }
      emitBlock(input.emit, { kind: "capabilities", title: `Where USDC can go from ${net}`, sections: bridgeSections(map) });
      const solvers = routes.filter((b) => b.id !== "cctp").map((b) => b.name);
      return finish(input, `USDC can go to ${all.length} chains from ${net}.\n\n- **Default:** CCTP, Circle burns on Arc and mints native USDC there\n${solvers.length > 0 ? `- **Also quoted:** ${solvers.join(" and ")}; I pick one only when it delivers more\n` : ""}- **Not yet:** Solana (it needs a token account Lykia does not create)\n\n**Next:** pick a chain below, or say “bridge 100 USDC to Base”.`, ["Base", "Arbitrum", "Ethereum", "OP Mainnet"].filter((c) => all.includes(c)).map((c) => `Bridge 100 USDC to ${c}`));
    }
    case "venues-for": {
      const action = map.actions.find((a) => a.id === reading.action)!;
      steps.start("intent", "Reading your question").end("ok", `Where Lyko can ${action.label.toLowerCase()}`, `${action.venues.length} venue${action.venues.length === 1 ? "" : "s"}`);
      emitBlock(input.emit, { kind: "capabilities", title: `${action.label} on ${net}`, sections: [{ label: action.plain, items: action.venues.slice(0, 16).map((v) => ({ name: v.name, note: v.via ? `through ${map.actions.flatMap((a) => a.venues).find((x) => x.id === v.via)?.name ?? v.via}` : null })) }] });
      return finish(input, `${action.label}: ${action.venues.length} venue${action.venues.length === 1 ? "" : "s"} on ${net}, and I compare them for you.\n\n- **Venues:** ${action.venues.slice(0, 6).map((v) => v.name).join(", ")}${action.venues.length > 6 ? ` and ${action.venues.length - 6} more` : ""}\n- **How I pick:** the best rate or price within your Fence's risk level, and I say why\n\n**Next:** say “${action.say}”.`, [action.say]);
    }
    case "explain": {
      const t = LYKIA_TERMS[reading.term];
      steps.start("intent", "Reading your question").end("ok", `${t.word} · ${t.plain}`);
      const feature = map.features.find((f) => f.id === reading.term || (reading.term === "fence" && f.id === "fence-presets"));
      const beta = reading.term === "fence" && map.environment === "mainnet" ? `\n- **On top of it:** ${betaCapExplain().sentence} ${betaCapExplain().why}` : "";
      if (feature) emitBlock(input.emit, { kind: "offer", feature: feature.id, title: `${t.word} · ${t.plain}`, line: t.line, href: feature.href, cta: `Open ${t.word}` });
      return finish(input, `${t.word} means ${t.plain}.\n\n- **What it does:** ${t.line}${beta}\n\n**Next:** ${feature ? `say “${feature.say}”` : "ask me to set one up"}.`, feature ? [feature.say] : []);
    }
    case "offer": {
      const feature = map.features.find((f) => f.id === reading.feature)!;
      if (reading.feature === "stress-test") return stressTurn(input, reading.reason);
      steps.start("intent", "Reading your request").end("ok", `Offering ${feature.name}`, reading.reason);
      emitBlock(input.emit, { kind: "offer", feature: feature.id, title: feature.name, line: `${feature.plain} ${reading.reason}`, href: feature.href, cta: reading.feature === "whistle" ? "Open the Whistle" : reading.feature === "leash" ? "Set up a Leash" : `Open ${feature.name}` });
      const lead = reading.feature === "leash" ? "That is a job for a Leash: your bot gets its own budget it cannot go past." : reading.feature === "whistle" ? "The Whistle stops everything at once." : `${feature.name} fits this.`;
      const facts = reading.feature === "leash" ? "- **You choose:** how much a day, for how many days, and who it may pay\n- **You keep control:** stop it anytime with Revoke" : reading.feature === "whistle" ? "- **Stops:** every agent and every new move\n- **Still passes:** money coming home (repaying, withdrawing)" : `- **What it does:** ${feature.plain}`;
      return finish(input, `${lead}\n\n${facts}\n\n**Next:** pick one below.`, reading.options, reading.feature === "leash" ? "How much should your bot get?" : "What should I do?");
    }
    case "clarify": {
      steps.start("intent", "Reading your request").end("warn", "Needs one detail", reading.question);
      const ask = `${reading.question.split("?")[0]}?`;
      return finish(input, `${ask}\n\n**Next:** pick one below, or name it${reading.missing === "destination" ? "; I pick the bridge that delivers the most and say why" : ""}.`, reading.options, ask);
    }
  }
}

/** "What if EURC drops 5%?": the Stress test on the owner's own positions, answered inline. */
async function stressTurn(input: DeterministicInput, lead: string): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  steps.start("intent", "Reading your question").end("ok", "A stress test", lead);
  const shocks = readStressQuestion(input.message)?.shocks ?? { EURC: -5, cirBTC: 0, ratesBps: 0 };
  if (!input.owner || input.owner.toLowerCase() === SAMPLE) {
    emitBlock(input.emit, { kind: "offer", feature: "stress-test", title: "Stress test", line: "Try it on the sample flock in the Fold, or connect a wallet and I run it on yours.", href: "/app/fold/flock", cta: "Open the Stress test" });
    return finish(input, `${lead}: I need a wallet to run that on your holdings.\n\n**Next:** connect a wallet, or try the Stress test on the sample flock in the Fold.`);
  }
  const reading = steps.start("wallet", "Reading your positions");
  const res = await readPositions(input.ctx, input.environment, input.owner, { personal: input.ownerVerified === true }).catch(() => null);
  if (!res) {
    reading.end("fail", "The venues could not be read");
    return finish(input, "I couldn't read your positions just now, so I can't run the stress test.\n\n**Next:** try again in a moment.");
  }
  const { holdings, health, names } = shockInputsFromPositions(res.venues);
  const floor = Number(res.healthFloor) || 1.5;
  const a = stressAnswer(holdings, health, shocks, lead, floor, names);
  reading.end(a.safe ? "ok" : "warn", `${usd(a.before)} → ${usd(a.after)}`, res.summary.unavailable.length > 0 ? `Not read: ${res.summary.unavailable.join(", ")}.` : undefined);
  emitBlock(input.emit, { kind: "stress", scenario: lead, sentence: a.sentence.slice(0, 400), beforeUsd: a.before.toFixed(2), afterUsd: a.after.toFixed(2), closest: a.closest ? { venue: a.closest.venue, health: a.closest.health.toFixed(2), roomPercent: a.closest.roomPercent.toFixed(1) } : null });
  const facts = [`- **Value:** ${usd(a.before)} → ${usd(a.after)}`, a.closest ? `- **Closest loan:** ${a.closest.venue}, health ${a.closest.health.toFixed(2)} (liquidation at 1.00)` : "- **Loans:** none, so nothing can be liquidated"];
  return finish(input, `${a.sentence}\n\n${facts.join("\n")}\n\n**Next:** ${a.safe ? "nothing to do; ask for another scenario any time." : "repay part of the loan or add collateral; say “repay a quarter of my loan”."}`, ["What if Bitcoin drops 20%?", "What if rates go up 1%?"]);
}
