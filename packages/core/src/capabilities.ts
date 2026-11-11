/**
 * The capability map: what Lyko can do, through which venues, where USDC
 * can be bridged, what each token can do, and the features to reach for.
 * Built from the venue registry, the engine's executable set, the bridge
 * route tables and routable adapter manifests, never written by hand: a new
 * adapter or venue appears here the moment it is executable.
 *
 * `readAssist` reads a sentence against the map: capability questions,
 * bridge destinations, "which protocols for", feature offers ("my bot needs
 * money" -> a Leash) and the one question to ask when a request is missing
 * something essential, with options taken from the map. Pure: no I/O.
 */
import { tokensFor } from "./assets.js";
import { CCTP_DESTINATIONS, type ArcEnvironment } from "./networks.js";
import { LYKIA_TERMS, readStressQuestion, type LykiaTerm } from "./plain.js";
import { capableProtocols, PROTOCOLS, registryCoverage, type ProtocolDescriptor } from "./protocols.js";
import type { StepKind } from "./intent.js";
import type { PackRole } from "./pack.js";
import type { AutopilotTaskInput } from "./autopilot.js";
import { PREFLIGHT_CHECKS } from "./preflight/index.js";
import { buildSelfKnowledge, selfKnowledgeSummary, type CanTarget, type SelfKnowledge } from "./selfKnowledge.js";
import type { BetaCap } from "./plain.js";

import { tx, phrase } from "./i18n/index.js";
export const CAPABILITIES_SCHEMA = "lykia.capabilities/v1" as const;

export interface CapabilityVenue {
  readonly id: string;
  readonly name: string;
  /** Reached through another venue's adapter (a curator's vaults through Morpho). */
  readonly via?: string;
}

export interface CapabilityAction {
  readonly id: string;
  readonly label: string;
  /** What it does, in one plain line. */
  readonly plain: string;
  /** The engine step kinds behind it (empty for features that are not plan steps). */
  readonly steps: readonly StepKind[];
  /** Venues Lykia routes this through today on this network. */
  readonly venues: readonly CapabilityVenue[];
  /** A sentence that starts it. */
  readonly say: string;
}

export interface BridgeRoute {
  readonly id: "cctp" | "across" | "relay" | "gateway";
  readonly name: string;
  readonly plain: string;
  readonly destinations: readonly { readonly key: string; readonly name: string }[];
  /** When Lyko picks it. */
  readonly when: string;
}

export interface TokenCapability {
  readonly symbol: string;
  readonly name: string;
  /** Action ids this token can take part in on this network. */
  readonly can: readonly string[];
  /** Chains it can be bridged to (USDC only today). */
  readonly bridgeTo: readonly string[];
}

export interface CapabilityFeature {
  readonly id: "fence-presets" | "stress-test" | "leash" | "autopilot" | "watch" | "staged-plans" | "whistle" | "orders" | "alerts" | "automations" | "payouts";
  readonly name: string;
  readonly plain: string;
  /** When to reach for it, in the owner's words. */
  readonly when: string;
  /** A sentence that starts it. */
  readonly say: string;
  readonly href: string;
}

export interface CapabilityMap {
  readonly schema: typeof CAPABILITIES_SCHEMA;
  readonly environment: ArcEnvironment;
  readonly actions: readonly CapabilityAction[];
  readonly bridges: readonly BridgeRoute[];
  readonly tokens: readonly TokenCapability[];
  readonly features: readonly CapabilityFeature[];
  /** What Lyko checks before anything is signed (preflight), and warns about with fixes computed by code. */
  readonly checks: readonly { readonly id: string; readonly name: string; readonly plain: string }[];
  /** Protocols, not actions: how many Lykia routes through, how many more through another venue's adapter, and how many the registry maps on Arc. */
  readonly coverage: { readonly routable: number; readonly routableVia: number; readonly mapped: number };
  /** What Lykia knows about itself: limits, fees, plain meanings, what is off or not built, risks and what it cannot know. */
  readonly knowledge: SelfKnowledge;
}

export interface CapabilityInputs {
  readonly environment: ArcEnvironment;
  /** Venue ids the engine executes on this network (the API's EXECUTABLE_VENUES). */
  readonly executable: ReadonlySet<string>;
  /** Chains Circle Gateway can pay out on, from the API's Gateway table. */
  readonly gatewayChains: readonly { readonly key: string; readonly name: string }[];
  /** Routable adapter manifests: their protocol id and the step kinds they add. */
  readonly manifests?: readonly { readonly protocol: string; readonly name: string; readonly verbs: readonly StepKind[] }[];
  /** Lykia's fee in basis points on this deployment (defaults to the code's base fee). */
  readonly feeBps?: number;
  /** The mainnet beta cap of this deployment; null when switched off. */
  readonly beta?: BetaCap | null;
  /** Feature flags of this deployment, so the map can say what is off. */
  readonly flags?: Readonly<Record<string, boolean>>;
}

/** The plan actions, their step kinds and how to say them. Venues are filled from the registry. */
const ACTION_ROWS: readonly { readonly id: string; readonly label: string; readonly plain: string; readonly steps: readonly StepKind[]; readonly say: string }[] = [
  { id: "send", label: phrase("Send"), plain: phrase("Pay an address with a note written into the transaction."), steps: ["transfer"], say: phrase("Pay 250 USDC to 0x… for invoice 42") },
  { id: "convert", label: phrase("Convert"), plain: phrase("Change USDC into EURC or back, checked against the reference rate."), steps: ["fx"], say: phrase("Convert 200 USDC to EURC") },
  { id: "swap", label: phrase("Swap"), plain: phrase("Trade one token for another at the best on-chain price."), steps: ["swap"], say: phrase("Swap 100 USDC to cirBTC") },
  { id: "earn", label: phrase("Earn"), plain: phrase("Put idle money in a vault or lending market; Lyko compares rates and risk."), steps: ["deposit", "supply"], say: phrase("Put my idle USDC to work at low risk") },
  { id: "withdraw", label: phrase("Withdraw"), plain: phrase("Take money back out of a vault or lending market. Free of Lykia's fee."), steps: ["withdraw"], say: phrase("Withdraw 500 USDC from my vault") },
  { id: "borrow", label: phrase("Borrow"), plain: phrase("Borrow against collateral, never under your Fence's loan safety floor."), steps: ["borrow"], say: phrase("Borrow 200 USDC against my cirBTC") },
  { id: "repay", label: phrase("Repay"), plain: phrase("Pay back a loan. Free of Lykia's fee."), steps: ["repay"], say: phrase("Repay 150 USDC on Aave") },
  { id: "bridge", label: phrase("Bridge"), plain: phrase("Move USDC to another chain; Lyko picks the route that delivers the most."), steps: ["bridge"], say: phrase("Bridge 100 USDC to Base") },
  { id: "unify", label: phrase("Gateway balance"), plain: phrase("Put USDC into Circle Gateway: one balance you can spend on several chains."), steps: ["gateway-deposit"], say: phrase("Deposit 300 USDC into Gateway") },
];

const FEATURES: readonly CapabilityFeature[] = [
  { id: "fence-presets", name: phrase("Fence presets"), plain: `${LYKIA_TERMS.fence.word} · ${LYKIA_TERMS.fence.plain}: ${phrase("Careful, Balanced or Bold, with a preview of what changes.")}`, when: phrase("You want different limits, fewer questions, or more caution."), say: phrase("Make my Fence more careful"), href: "/app/fold/fence" },
  { id: "stress-test", name: phrase("Stress test"), plain: phrase("What happens to your holdings and loans if a price drops or rates move."), when: phrase("You ask \"what if\" about EURC, Bitcoin or rates."), say: phrase("What if EURC drops 5%?"), href: "/app/fold/flock" },
  { id: "leash", name: "Leash", plain: `${LYKIA_TERMS.leash.word} · ${LYKIA_TERMS.leash.plain}: ${phrase("per step, per day and in total, until a date, only to payees you name. An agent is what holds a leash.")}`, when: phrase("A bot or an outside agent needs money to spend on its own."), say: phrase("Give my bot $20 a day for a week"), href: "/app/fold/pack" },
  { id: "watch", name: phrase("Watch"), plain: phrase("A watch keeps an eye on a price, a position or a transfer and tells you in-app, by webhook or on Telegram. It never moves money."), when: phrase("You say \"tell me if\" or \"keep an eye on\"."), say: phrase("Tell me if my health factor drops below 1.5"), href: "/app/fold/herding?show=watches" },
  { id: "staged-plans", name: phrase("Step-by-step plans"), plain: phrase("A plan with several steps is signed one step at a time; each next step is rebuilt from what actually arrived."), when: phrase("A request has several moves, like swap then deposit."), say: phrase("Swap 500 USDC to EURC, then deposit it into Morpho"), href: "/app" },
  { id: "whistle", name: "Whistle", plain: `${LYKIA_TERMS.whistle.word} · ${LYKIA_TERMS.whistle.plain}: ${phrase("every agent and every new move stops at once. Money coming home still passes.")}`, when: phrase("Something looks wrong and you want everything to stop."), say: phrase("Blow the whistle"), href: "/app/fold/fence" },
  { id: "autopilot", name: "Autopilot", plain: phrase("Lyko signs your own automations (auto-repay, DCA, sweeping idle USDC, recurring payments) inside a leash on your LykiaAccount, at most $100 a step and $300 a day in beta. Off until you turn it on; Stop ends it at once."), when: phrase("You want repeats to run without signing each one."), say: phrase("Turn on Autopilot"), href: "/app/fold/pack" },
  { id: "orders", name: phrase("Orders"), plain: phrase("Limit, stop-loss, take-profit, DCA and TWAP orders, signed once and filled on chain within your limits."), when: phrase("You want to buy or sell when a price is reached, or spread a buy over time."), say: phrase("Buy EURC when EUR/USD is below 1.09"), href: "/app/fold/herding?show=orders" },
  { id: "alerts", name: phrase("Watch with a channel"), plain: phrase("A watch delivered by webhook or Telegram when a price crosses a level, a loan gets riskier, or money moves."), when: phrase("You only want to be told, not to move anything."), say: phrase("Tell me on Telegram if cirBTC falls below 60000"), href: "/app/fold/herding?show=watches" },
  { id: "automations", name: phrase("Automations"), plain: phrase("A sentence Lyko plans again on a schedule or a trigger; you sign each run, or Autopilot signs it inside its limits."), when: phrase("Something should happen every week or every month."), say: phrase("Every Friday at 17:00, sweep USDC above 1000 into a vault"), href: "/app/fold/herding?show=automations" },
  { id: "payouts", name: phrase("Payouts and invoices"), plain: phrase("Pay several people at once, or send an invoice someone pays with one link."), when: phrase("You pay a team, contractors or customers."), say: phrase("Pay 50 USDC each to 0x… and 0x… on the 1st of every month"), href: "/app/fold/herding?show=payments" },
];

function venueOf(p: ProtocolDescriptor): CapabilityVenue {
  return p.via && p.via !== p.id ? { id: p.id, name: p.name, via: p.via } : { id: p.id, name: p.name };
}

/** Builds the map from the registry, the executable set and the bridge tables. */
export function buildCapabilityMap(input: CapabilityInputs): CapabilityMap {
  const { environment, executable } = input;
  const manifests = input.manifests ?? [];
  const actions: CapabilityAction[] = ACTION_ROWS.map((row) => {
    const seen = new Map<string, CapabilityVenue>();
    for (const kind of row.steps) {
      for (const p of capableProtocols(kind, environment, executable)) seen.set(p.id, venueOf(p));
      for (const m of manifests) if (m.verbs.includes(kind)) seen.set(m.protocol, { id: m.protocol, name: m.name });
    }
    return { ...row, venues: [...seen.values()] };
  }).filter((a) => a.venues.length > 0);

  const evm = CCTP_DESTINATIONS.filter((d) => d.vm === "evm" && d.chainIds[environment] !== null).map((d) => ({ key: d.key, name: d.name }));
  const bridges: BridgeRoute[] = [];
  if (executable.has("cctp")) bridges.push({ id: "cctp", name: "CCTP", plain: tx("Circle burns USDC on Arc and mints it on the other chain. Lykia's default for USDC."), destinations: evm, when: tx("The default: native USDC on arrival, Circle forwards the mint.") });
  const solvers = (["across", "relay"] as const).filter((id) => executable.has(id) && environment === "mainnet");
  for (const id of solvers) {
    const name = id === "across" ? "Across" : tx("Relay");
    bridges.push({ id, name, plain: tx("{name} pays you on the other chain from its own funds and is repaid on Arc; an unfilled deposit is refunded on Arc.", { name }), destinations: evm, when: tx("Quoted next to CCTP on every bridge; chosen only when it delivers more, or when you name it.") });
  }
  if (executable.has("gateway") && input.gatewayChains.length > 0) bridges.push({ id: "gateway", name: "Circle Gateway", plain: tx("Deposit once on Arc, then spend the same USDC balance on any Gateway chain."), destinations: input.gatewayChains.map((c) => ({ key: c.key, name: c.name })), when: tx("You keep a balance to spend on several chains, or a Leash pays out on them.") });

  const can = (symbol: string): string[] => {
    const ids: string[] = [];
    if (actions.some((a) => a.id === "send")) ids.push("send");
    if (symbol === "USDC" || symbol === "EURC") {
      if (actions.some((a) => a.id === "convert")) ids.push("convert");
    }
    if (actions.some((a) => a.id === "swap")) ids.push("swap");
    if (["USDC", "EURC"].includes(symbol) && actions.some((a) => a.id === "earn")) ids.push("earn", "withdraw");
    if (symbol === "USDC") {
      for (const id of ["borrow", "repay", "bridge", "unify"]) if (actions.some((a) => a.id === id)) ids.push(id);
    }
    if (symbol === "cirBTC" && actions.some((a) => a.id === "borrow")) ids.push("collateral");
    return ids;
  };
  const bridgeTo = [...new Map(bridges.filter((b) => b.id !== "gateway").flatMap((b) => b.destinations).map((d) => [d.key, d.name])).values()];
  const tokens: TokenCapability[] = tokensFor(environment)
    .filter((t) => ["USDC", "EURC", "cirBTC", "WETH", "USYC"].includes(t.symbol))
    .map((t) => ({ symbol: t.symbol, name: t.name, can: t.symbol === "USYC" ? [] : can(t.symbol), bridgeTo: t.symbol === "USDC" ? bridgeTo : [] }));

  const cov = registryCoverage(environment, executable);
  return { schema: CAPABILITIES_SCHEMA, environment, actions, bridges, tokens, features: FEATURES, checks: PREFLIGHT_CHECKS.map((c) => ({ id: c.id, name: c.name, plain: c.plain })), coverage: { routable: cov.routable, routableVia: cov.routableVia, mapped: cov.protocols }, knowledge: buildSelfKnowledge({ environment, ...(input.feeBps !== undefined ? { feeBps: input.feeBps } : {}), ...(input.beta !== undefined ? { beta: input.beta } : {}), ...(input.flags ? { flags: input.flags } : {}) }) };
}

/** What "can you X" may match with a yes: every action and feature of the map, with the words that name it. */
export function canTargets(map: CapabilityMap): CanTarget[] {
  const words: Readonly<Record<string, readonly string[]>> = {
    send: ["send\\w*", "pay\\w*", "transfer\\w*", "payments?"],
    convert: ["convert\\w*", "fx", "exchange", "eurc"],
    swap: ["swap\\w*", "trade", "trading", "buy", "sell"],
    earn: ["earn\\w*", "yield", "lend\\w*", "deposit\\w*", "invest\\w*", "sav(?:e|ing)\\w*", "interest", "vaults?", "stak\\w+"],
    withdraw: ["withdraw\\w*", "take (?:it|money) out", "redeem\\w*"],
    borrow: ["borrow\\w*", "loans?", "credit"],
    repay: ["repay\\w*", "pay back", "pay off"],
    bridge: ["bridg\\w+", "cross.?chain", "another chain", "other chains?"],
    unify: ["gateway", "unified balance"],
    "fence-presets": ["fence", "rules", "limits"],
    "stress-test": ["stress test", "what.?if", "scenario"],
    leash: ["leash(?:es)?", "bot", "agent budget"],
    autopilot: ["autopilot", "automatic\\w*", "auto.?repay", "auto.?pilot"],
    watch: ["watch\\w*", "monitor\\w*", "keep an eye", "notify", "alert\\w*", "tell me (?:if|when)"],
    "staged-plans": ["several steps", "multi.?step", "step by step"],
    whistle: ["whistle", "stop everything", "emergency stop", "kill switch"],
    orders: ["orders?", "limit orders?", "stop.?loss", "take.?profit", "dca", "twap", "recurring buy"],
    alerts: ["telegram", "webhooks?"],
    automations: ["automat\\w+", "schedule\\w*", "recurring", "every (?:day|week|month|friday|monday)"],
    payouts: ["payouts?", "invoices?", "payroll", "pay (?:my )?team", "pay several"],
  };
  return [
    ...map.actions.map((a) => ({ name: a.label, plain: a.plain, say: a.say, venues: a.venues.length, words: words[a.id] ?? [a.id] })),
    ...map.features.map((f) => ({ name: f.name, plain: f.plain, say: f.say, venues: 0, words: words[f.id] ?? [f.id] })),
  ];
}

/** Every venue the map routes through (for the test that keeps it complete). */
export function capabilityVenueIds(map: CapabilityMap): Set<string> {
  return new Set([...map.actions.flatMap((a) => a.venues.map((v) => v.id)), ...map.bridges.map((b) => b.id)]);
}

/** Registry venues the engine executes on a network, for comparison with the map. */
export function routableVenueIds(environment: ArcEnvironment, executable: ReadonlySet<string>): string[] {
  return PROTOCOLS.filter((p) => executable.has(p.id) && p.deployments[environment] !== undefined && p.verbs.some((v) => v !== "approve" && v !== "register-agent" && v !== "attest")).map((p) => p.id);
}

/** A compact summary for the model's system prompt: a few lines, all from the map. */
export function capabilitySummary(map: CapabilityMap): string {
  const lines = [
    `Capability map (${map.environment}, from code). Call the capabilities tool for the full list.`,
    ...map.actions.map((a) => `- ${a.label}: ${a.venues.map((v) => v.name).slice(0, 8).join(", ")}${a.venues.length > 8 ? ` and ${a.venues.length - 8} more` : ""}`),
    ...map.bridges.map((b) => `- Bridge ${b.name}: ${b.destinations.map((d) => d.name).join(", ")}. ${b.when}`),
    `- Features: ${map.features.map((f) => `${f.name} (${f.when})`).join("; ")}`,
    `- Before anything is signed, code checks: ${map.checks.map((c) => c.name).join(", ")}. A plan carries its findings (preflight); when one blocks or warns, lead with it in one sentence and offer its fixes, never the sign button first.`,
    `- Coverage counts protocols, never actions: ${map.actions.length} actions, through ${map.coverage.routable} protocols (plus ${map.coverage.routableVia} reached through another venue), out of ${map.coverage.mapped} protocols mapped on Arc.`,
    "Proactive: when the owner's words match a feature, offer it or start it instead of explaining it. When an essential detail is missing (destination chain, amount, which position), ask one short question with ask_owner and 2 to 4 options taken from this map; never guess.",
    selfKnowledgeSummary(map.knowledge),
  ];
  return lines.join("\n");
}

/* --------------------------------------------------------------- reading */

export type AssistReading =
  /** "What can you do?" */
  | { readonly kind: "capabilities"; readonly topic: "all" }
  /** "Where can I bridge USDC to?" */
  | { readonly kind: "bridge-destinations"; readonly token: string }
  /** "What is a Leash?": one of Lykia's words, explained. */
  | { readonly kind: "explain"; readonly term: LykiaTerm }
  /** "Which protocols can I lend on?" / "Can I swap EURC?" */
  | { readonly kind: "venues-for"; readonly action: string }
  /** A feature that fits the words: offered with a sentence that starts it. */
  | { readonly kind: "offer"; readonly feature: CapabilityFeature["id"]; readonly reason: string; readonly options: readonly string[] }
  /** Something essential is missing: one question, options from the map. */
  | { readonly kind: "clarify"; readonly missing: "destination" | "amount" | "position" | "recipient"; readonly question: string; readonly options: readonly string[] }
  /** "Where can I earn on EURC?": live rates for one token, ranked (the answer Pastures used to be). */
  | { readonly kind: "yields"; readonly token: "USDC" | "EURC" }
  /** "What are the new pools on Arc?": new pools with each token's check (the answer Discover used to be). */
  | { readonly kind: "pools" }
  /** "Show me the perps markets": price, funding and open interest (the answer Markets used to be). */
  | { readonly kind: "markets"; readonly market: string | null }
  /** Something to start: an agent on a leash, Autopilot, or an Autopilot task. Every figure is the owner's, or the turn asks with options. */
  | CreateReading;

export type CreateReading =
  | { readonly kind: "create"; readonly feature: "agent"; readonly name: string; readonly role: PackRole; readonly dailyUsd: string | null; readonly options: readonly string[] }
  | { readonly kind: "create"; readonly feature: "autopilot"; readonly perStepUsd: string | null; readonly perDayUsd: string | null; readonly days: number | null; readonly options: readonly string[] }
  | { readonly kind: "create"; readonly feature: "autopilot-task"; readonly task: AutopilotTaskInput | null; readonly missing: string | null; readonly options: readonly string[] };

const ACTION_WORDS: readonly [RegExp, string][] = [
  [/\b(lend|lending|supply|earn|yield|deposit|vaults?)\b/u, "earn"],
  [/\b(borrow|borrowing|loan|loans)\b/u, "borrow"],
  [/\b(swap|swaps|trade|trading|dex|dexes)\b/u, "swap"],
  [/\b(convert|fx|exchange|eurc)\b/u, "convert"],
  [/\b(bridge|bridges|cross-chain)\b/u, "bridge"],
  [/\b(pay|send|transfer)\b/u, "send"],
  [/\b(repay)\b/u, "repay"],
  [/\b(withdraw)\b/u, "withdraw"],
];

const AMOUNT = /(?:\$\s?\d|\d[\d,]*(?:\.\d+)?\s*(?:usdc|eurc|usd|dollars?|\$|k\b)|\b(?:all|half|everything|the rest)\b)/iu;

/**
 * Reads a sentence against the map. Null when it is an ordinary request the
 * planner handles (or a watch, which has its own reader).
 */
export function readAssist(text: string, map: CapabilityMap): AssistReading | null {
  const t = text.trim().toLowerCase().replace(/[’']/gu, "'");
  if (t.length === 0 || t.length > 400) return null;
  const question = /\?$/u.test(t) || /^(what|which|where|can|could|do|does|how|is|are)\b/u.test(t);
  const bridgeNames = map.bridges.flatMap((b) => b.destinations).map((d) => d.name.toLowerCase());
  const destinations = [...new Set(map.bridges.filter((b) => b.id !== "gateway").flatMap((b) => b.destinations.map((d) => d.name)))].sort((a, b) => popular(a) - popular(b));
  const namesChain = (s: string) => destinations.some((d) => new RegExp(`\\b${d.toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(s)) || CCTP_ALIASES.some((a) => new RegExp(`\\b${a}\\b`, "u").test(s)) || bridgeNames.some((n) => s.includes(n));

  // Lykia's own words.
  const term = t.match(/\b(?:what(?:'s|s| is| are)|explain|meaning of)\s+(?:a |an |the |my )?(fence|whistle|flock|trails?|herding|pack|leash(?:es)?|tag|scent)\b/u);
  if (term) {
    const word = term[1]!.replace(/es$|s$/u, "") as string;
    const key = (word === "trail" ? "trails" : word) as LykiaTerm;
    if (key in LYKIA_TERMS) return { kind: "explain", term: key };
  }

  // The pages that became answers: yields, new pools, perps markets.
  if ((question || /^(show|list|give)\b/u.test(t)) && !readStressQuestion(t) && !/\b(my|mine|i have|i hold)\b/u.test(t)) {
    if (/\b(perps?|perpetuals?|funding rates?|open interest)\b/u.test(t)) {
      const m = t.match(/\b(btc|eth|sol|bitcoin|ether)\b/u)?.[1] ?? null;
      return { kind: "markets", market: m ? ({ bitcoin: "BTC", ether: "ETH" } as Record<string, string>)[m] ?? m.toUpperCase() : null };
    }
    // "What is APY?" asks for a meaning, and "the EURC rate" for a conversion rate: neither is a list of yields.
    const meaning = /^(?:what(?:'s| is| does)|explain)\s+(?:an? |the )?(?:apy|apr|yield|interest)(?:\s+mean)?\??$/u.test(t);
    const conversion = /\b(?:eurc|euro|eur|fx|exchange|conversion)\b/u.test(t) && !/\b(?:earn|yield|yields|apy|interest|lend|vaults?|savings?|pastures?)\b/u.test(t);
    if (!meaning && !conversion && /\b(earn|yield|yields|apy|rates?|interest|pastures?)\b/u.test(t) && /\b(where|which|best|show|what|list|rates?)\b/u.test(t) && !AMOUNT.test(t)) {
      return { kind: "yields", token: /\beurc\b/u.test(t) ? "EURC" : "USDC" };
    }
    if (/\bnew (pools?|tokens?|launch(es)?)\b|\blaunchpads?\b|\bwhat(?:'s| is) new on arc\b/u.test(t)) return { kind: "pools" };
  }

  // Capability questions.
  if (/\b(what can you do|what do you do|what are you able|your (features|capabilities)|help me get started|what can lyko do|what can lykia do)\b/u.test(t)) return { kind: "capabilities", topic: "all" };
  if (question && /\bbridge|move .* to (another|other) chain|which chains?|what chains?\b/u.test(t) && /\b(where|which|what|can i)\b/u.test(t) && !AMOUNT.test(t)) {
    const token = /\beurc\b/u.test(t) ? "EURC" : "USDC";
    return { kind: "bridge-destinations", token };
  }
  if (question && /\b(which|what) (protocols?|venues?|places?|dexe?s?|vaults?|markets?)\b|\bwhere can i\b|\bcan i\b/u.test(t) && !AMOUNT.test(t)) {
    const hit = ACTION_WORDS.find(([re]) => re.test(t));
    if (hit && map.actions.some((a) => a.id === hit[1])) return { kind: "venues-for", action: hit[1] };
  }

  // Starting things: an agent on a leash, Autopilot, an Autopilot task.
  const create = readCreate(t, text);
  if (create) return create;

  // Watches and alerts have their own reader ("tell me if", "keep an eye on").
  if (/\b(tell me|let me know|alert me|notify me|warn me|keep an eye|watch)\b/u.test(t)) return null;

  // Proactive offers.
  if (/\b(stop|turn off|switch off|pause|kill|disable|halt)\b.*\bautopilot\b|\bautopilot\b.*\b(off|stop)\b/u.test(t)) return { kind: "offer", feature: "autopilot", reason: tx("Stop Autopilot ends server signing at once; then sign revokeSession to end its session on chain."), options: [tx("Show my Autopilot"), tx("Blow the whistle")] };
  if (/\bautopilot\b|\b(sign|act) (for|on behalf of) me\b|\bwithout (asking|signing) (me )?(each|every) time\b/u.test(t) && !AMOUNT.test(t)) return { kind: "offer", feature: "autopilot", reason: tx("Autopilot lets Lyko sign your own automations inside limits you set, on your own account."), options: [tx("Turn on Autopilot"), tx("What does Autopilot hold?")] };
  if (/\b(stop everything|stop it all|stop all|freeze everything|panic|halt everything|something('s| is) wrong|kill switch)\b/u.test(t)) return { kind: "offer", feature: "whistle", reason: tx("The Whistle stops every agent and every new move at once."), options: [tx("Blow the whistle"), tx("Show me what is running")] };
  const newPackAgent = /\b(create|make|spin up|set up|new)\b.*\b(agent|bot)\b/u.test(t) && !/\b(needs?|wants?)\b/u.test(t);
  if (!newPackAgent && !AMOUNT.test(t) && (/\b(bot|agent|ai agent|script)\b.*\b(needs?|wants?|should have|to have|spend|budget|money|allowance|funds?|pay (its|for))\b/u.test(t) || /\b(give|fund|top up)\b.*\b(bot|agent)\b/u.test(t))) {
    return { kind: "offer", feature: "leash", reason: tx("A Leash gives a bot its own spending limit it cannot go past, and you can stop it anytime."), options: [tx("Give my bot $20 a day for 7 days to pay invoices"), tx("Give my bot $50 a day for 30 days to pay invoices"), tx("What is a Leash?")] };
  }
  const stress = readStressQuestion(t);
  if (stress) return { kind: "offer", feature: "stress-test", reason: stress.lead, options: [] };
  if (/\b(make|set|change|switch) my fence\b|\b(more|less) (careful|cautious|strict|bold)\b|\b(stricter|looser) (rules|limits)\b/u.test(t)) return { kind: "offer", feature: "fence-presets", reason: tx("Pick a preset and see what changes before anything is signed."), options: [tx("Careful"), tx("Balanced"), tx("Bold")] };

  // Ask, don't guess.
  if (/\b(bridge|move|send)\b/u.test(t) && /\b(bridge|another chain|other chain|cross-chain|off arc)\b/u.test(t) && !namesChain(t)) {
    const opts = destinations.slice(0, 4);
    return { kind: "clarify", missing: "destination", question: tx("{value} to which chain?", { value: /\d/u.test(t) ? text.trim().replace(/[.?!]+$/u, "") : tx("Bridge") }), options: opts.map((d) => `${text.trim().replace(/[.?!]+$/u, "")} to ${d}`) };
  }
  if (/^(bridge|swap|convert|send|pay|deposit|withdraw|repay|borrow)\b/u.test(t) && !AMOUNT.test(t) && !/\b(my|all|everything|the rest|idle)\b/u.test(t)) {
    const verb = t.split(/\s+/u)[0]!;
    const base = text.trim().replace(/[.?!]+$/u, "");
    const rest = base.slice(verb.length).trim();
    const amounts = ["50", "100", "500"];
    return { kind: "clarify", missing: "amount", question: tx("How much should I {verb}?", { verb }), options: amounts.map((a) => `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${a} USDC${rest ? ` ${rest.replace(/^usdc\s*/iu, "")}` : ""}`.trim()) };
  }
  return null;
}

const ROLE_WORDS: readonly [RegExp, PackRole, string][] = [
  [/\bpayroll\b/u, "payroll", phrase("Payroll")],
  [/\b(treasur(y|er))\b/u, "treasurer", phrase("Treasurer")],
  [/\b(fx|hedg(e|er|ing)|currency)\b/u, "fx-hedger", phrase("FX hedger")],
  [/\b(yield|earn(ing)?|vault)\b/u, "yield-keeper", phrase("Yield keeper")],
  [/\b(bills?|invoices?)\b/u, "bill-payer", phrase("Bill payer")],
  [/\b(sentinel|guard|security)\b/u, "sentinel", phrase("Sentinel")],
  [/\b(research(er)?)\b/u, "researcher", phrase("Researcher")],
];

/** A USD figure written next to a period word ("$500 a day", "500 USDC daily", "daily budget of 500"). */
function usdPer(t: string, period: "day" | "step"): string | null {
  const unit = period === "day" ? "(?:a|per|each|every)\\s+day|daily|/\\s*day" : "(?:a|per|each)\\s+(?:step|move|run|go)|per\\s+transaction";
  const after = new RegExp(`\\$?\\s?(\\d{1,9}(?:\\.\\d{1,2})?)\\s*(?:usdc|usd|dollars?)?\\s*(?:${unit})`, "u").exec(t);
  if (after) return after[1]!;
  const before = new RegExp(`(?:${period === "day" ? "daily (?:budget|cap|limit)" : "(?:step|per-step) (?:cap|limit)"})\\s*(?:of)?\\s*\\$?\\s?(\\d{1,9}(?:\\.\\d{1,2})?)`, "u").exec(t);
  if (before) return before[1]!;
  if (period === "day") {
    const daily = /\$?\s?(\d{1,9}(?:\.\d{1,2})?)\s*(?:usdc|usd|dollars?)?\s+daily\b/u.exec(t);
    if (daily) return daily[1]!;
  }
  return null;
}

/** Reads a request to start an agent, Autopilot or an Autopilot task. Pure; the figures are only ever the owner's own. */
export function readCreate(t: string, original: string): CreateReading | null {
  void original;
  // An agent (it holds a leash): "create a payroll agent with a 500 USDC daily budget".
  if (/\b(create|make|spin up|set up|start|new|add|hire)\b.*\b(agent|bot)\b/u.test(t) && !/\b(needs?|wants?)\b/u.test(t) && !/\b(leash|autopilot)\b/u.test(t)) {
    const hit = ROLE_WORDS.find(([re]) => re.test(t));
    const role: PackRole = hit?.[1] ?? "custom";
    const name = hit?.[2] ?? tx("Helper");
    const dailyUsd = usdPer(t, "day") ?? (/\bbudget\b/u.test(t) ? (/\$?\s?(\d{1,9}(?:\.\d{1,2})?)\s*(?:usdc|usd|dollars?|\$)?/u.exec(t.replace(/^.*?\bbudget\b/u, ""))?.[1] ?? null) : null);
    const base = `Create a ${name.toLowerCase()} agent`;
    return { kind: "create", feature: "agent", name, role, dailyUsd, options: dailyUsd ? [] : [tx("{base} with a $100 daily budget", { base }), tx("{base} with a $250 daily budget", { base }), tx("{base} with a $500 daily budget", { base })] };
  }
  // Autopilot: "turn on Autopilot with $50 a step and $150 a day for 30 days".
  if (/\b(turn on|switch on|enable|start|set up)\b.*\bautopilot\b|\bautopilot\b.*\b(on|up)\b\s*$/u.test(t) && !/\b(off|stop|pause)\b/u.test(t)) {
    const perStepUsd = usdPer(t, "step");
    const perDayUsd = usdPer(t, "day");
    const daysHit = /\bfor\s+(\d{1,3})\s+days?\b|\bfor\s+a\s+(week|month)\b/u.exec(t);
    const days = daysHit ? (daysHit[1] ? Number(daysHit[1]) : daysHit[2] === "week" ? 7 : 30) : null;
    const ready = perStepUsd !== null && perDayUsd !== null && days !== null;
    return { kind: "create", feature: "autopilot", perStepUsd, perDayUsd, days, options: ready ? [] : [tx("Turn on Autopilot with $25 a step and $75 a day for 30 days"), tx("Turn on Autopilot with $50 a step and $150 a day for 30 days"), tx("Turn on Autopilot with $100 a step and $300 a day for 30 days")] };
  }
  // An Autopilot task: "have Autopilot repay 50 USDC on Aave when health drops below 1.5".
  if (/\bautopilot\b/u.test(t) && /\b(add|task|have|let|make|tell)\b/u.test(t) && !/\b(off|stop|pause|turn on|switch on|enable)\b/u.test(t)) {
    const amount = /\$?\s?(\d{1,9}(?:\.\d{1,2})?)\s*(?:usdc|usd|dollars?)\b|\$\s?(\d{1,9}(?:\.\d{1,2})?)/u.exec(t);
    const amountUsd = amount ? (amount[1] ?? amount[2] ?? null) : null;
    const every = /\b(daily|every day|each day)\b/u.test(t) ? "day" : /\b(weekly|every week|each week)\b/u.test(t) ? "week" : /\b(monthly|every month|each month)\b/u.test(t) ? "month" : null;
    if (/\brepay\b/u.test(t)) {
      const floor = /\b(?:health|hf)\b[^\d]{0,30}(\d(?:\.\d{1,2})?)/u.exec(t)?.[1] ?? null;
      const missing = !amountUsd ? "amount" : !floor ? "floor" : null;
      return { kind: "create", feature: "autopilot-task", task: missing ? null : { kind: "repay", amountUsd: amountUsd!, floor: floor! }, missing, options: missing === "amount" ? [tx("Have Autopilot repay 25 USDC on Aave when health drops below 1.5"), tx("Have Autopilot repay 50 USDC on Aave when health drops below 1.5")] : missing === "floor" ? [tx("Have Autopilot repay {amountUsd} USDC on Aave when health drops below 1.5", { amountUsd }), tx("Have Autopilot repay {amountUsd} USDC on Aave when health drops below 1.3", { amountUsd })] : [] };
    }
    if (/\b(sweep|idle)\b/u.test(t)) {
      const keep = /\b(?:above|over|keep(?:ing)?)\s*\$?\s?(\d{1,9}(?:\.\d{1,2})?)/u.exec(t)?.[1] ?? null;
      const up = /\bup to\s*\$?\s?(\d{1,9}(?:\.\d{1,2})?)/u.exec(t)?.[1] ?? null;
      const vault = /\binto\s+(?:the\s+)?([a-z][a-z0-9 .'-]{1,40}?)(?:\s+vault)?(?:,|\.|$|\s+up to|\s+when|\s+every)/u.exec(t)?.[1]?.trim() ?? null;
      const missing = !keep ? "keep" : !up ? "amount" : !vault ? "vault" : null;
      const say = (k: string, a: string) => tx("Have Autopilot sweep idle USDC above {k} into the Galaxy vault, up to {a} at a time", { k, a });
      return { kind: "create", feature: "autopilot-task", task: missing ? null : { kind: "sweep", keepUsd: keep!, amountUsd: up!, vault: vault!.replace(/\b\w/gu, (c) => c.toUpperCase()) }, missing, options: missing ? [say(keep ?? "500", up ?? "100"), say(keep ?? "1000", up ?? "100")] : [] };
    }
    if (/\b(pay|send)\b/u.test(t)) {
      const payee = /0x[0-9a-f]{40}/u.exec(t)?.[0] ?? null;
      const missing = !amountUsd ? "amount" : !payee ? "payee" : !every ? "every" : null;
      return { kind: "create", feature: "autopilot-task", task: missing ? null : { kind: "pay", amountUsd: amountUsd!, every: every!, payee: payee as `0x${string}` }, missing, options: missing === "every" ? ["every day", "every week", "every month"].map((e) => `${original.trim().replace(/[.?!]+$/u, "")} ${e}`) : [] };
    }
    if (/\b(dca|buy|convert)\b/u.test(t)) {
      // DCA has one engine: LykiaOrders. Autopilot no longer takes new DCA tasks.
      return { kind: "create", feature: "autopilot-task", task: null, missing: "dca", options: [4, 8].map((n) => tx("Buy EURC with {value} USDC every {value2} for {n} {value2}s", { value: amountUsd ?? "50", value2: every ?? "week", n })) };
    }
    return { kind: "create", feature: "autopilot-task", task: null, missing: "kind", options: [tx("Have Autopilot repay 50 USDC on Aave when health drops below 1.5"), tx("Have Autopilot sweep idle USDC above 1000 into the Galaxy vault, up to 100 at a time"), tx("Have Autopilot pay 25 USDC to 0x… every week")] };
  }
  return null;
}

/** The chains people bridge to most, first in a question's options. */
const POPULAR = ["Base", phrase("Arbitrum"), "Ethereum", phrase("OP Mainnet"), phrase("Polygon PoS"), phrase("Avalanche")];
const popular = (name: string) => {
  const i = POPULAR.indexOf(name);
  return i < 0 ? POPULAR.length : i;
};

/** Common short names for CCTP chains, so "to base" or "to arb" counts as naming a chain. */
const CCTP_ALIASES: readonly string[] = [...new Set(CCTP_DESTINATIONS.flatMap((d) => [d.key, ...d.aliases]).map((a) => a.toLowerCase()))];
