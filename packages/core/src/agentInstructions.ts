/**
 * Agent instructions: how Lyko on watch (the Fold's portfolio assistant)
 * and Ask Lyko hand work to each other on the owner's shared thread.
 *
 *   plan   Lyko on watch -> Ask Lyko: an insight worth acting on ("repay a
 *          quarter of the Aave V4 Main debt, health 1.31 < floor 1.5").
 *          Ask Lyko plans it as a staged plan; the instruction follows the
 *          plan: pending -> planned -> signed -> done (or refused, stopped).
 *   watch  Ask Lyko -> Lyko on watch: a condition to keep an eye on ("tell
 *          me if health drops below 1.5"). It shows in the Fold, can be
 *          paused or removed, and raises an insight when it is met:
 *          active <-> paused, either -> removed.
 *
 * Pure: the shapes, the allowed moves, the reader for the common watch
 * phrasings and the check of a watch against what the Fold read.
 */
import type { ArcEnvironment } from "./networks.js";
import type { Address } from "./contracts.js";
import type { IntentGraph } from "./intent.js";

import { tx } from "./i18n/index.js";
export type AgentRole = "watch" | "ask";
export const AGENT_NAMES: Readonly<Record<AgentRole, string>> = { watch: "Lyko on watch", ask: "Ask Lyko" };

export type AgentInstructionKind = "plan" | "watch";
export type PlanInstructionStatus = "pending" | "planned" | "signed" | "done" | "refused" | "stopped";
export type WatchInstructionStatus = "active" | "paused" | "removed";
export type AgentInstructionStatus = PlanInstructionStatus | WatchInstructionStatus;

export type WatchCondition =
  | { readonly kind: "health-below"; readonly threshold: string; readonly venue?: string }
  | { readonly kind: "lp-out-of-range"; readonly venue?: string }
  | { readonly kind: "idle-above"; readonly token: string; readonly amount: string }
  | { readonly kind: "apy-below"; readonly percent: string; readonly venue?: string };

export const WATCH_KINDS = ["health-below", "lp-out-of-range", "idle-above", "apy-below"] as const satisfies readonly WatchCondition["kind"][];

export interface PlanPayload {
  readonly kind: "plan";
  /** What Ask Lyko is asked to plan, as a sentence the planner reads. */
  readonly sentence: string;
  /** "Repay a quarter of the Aave V4 Main debt". */
  readonly title: string;
  /** "health 1.31 < floor 1.5". */
  readonly reason: string;
  readonly insightId?: string;
  /** The plan Ask Lyko made from it, once planned. */
  readonly intentId?: string | null;
}

export interface WatchPayload {
  readonly kind: "watch";
  readonly condition: WatchCondition;
  /** "Health factor below 1.5 on Aave V4". */
  readonly label: string;
  /** The plan the watch was set up after ("Watch this position"). */
  readonly intentId?: string | null;
  readonly fired: number;
  readonly lastFiredAt: string | null;
  /** What the last check saw, in plain words. */
  readonly observation: string | null;
  /** Whether the condition held at the last check (a watch fires again only after it was clear). */
  readonly met?: boolean;
}

export interface AgentInstruction {
  readonly id: string;
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly from: AgentRole;
  readonly to: AgentRole;
  readonly kind: AgentInstructionKind;
  readonly payload: PlanPayload | WatchPayload;
  readonly status: AgentInstructionStatus;
  /** The shared thread the hand-off was written to. */
  readonly threadId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const MOVES: Readonly<Record<AgentInstructionStatus, readonly AgentInstructionStatus[]>> = {
  pending: ["planned", "refused"],
  planned: ["signed", "done", "stopped"],
  signed: ["done", "stopped"],
  done: [],
  refused: [],
  stopped: [],
  active: ["paused", "removed"],
  paused: ["active", "removed"],
  removed: [],
};

const PLAN_STATUSES: readonly AgentInstructionStatus[] = ["pending", "planned", "signed", "done", "refused", "stopped"];

export function canMoveInstruction(kind: AgentInstructionKind, from: AgentInstructionStatus, to: AgentInstructionStatus): boolean {
  const own = kind === "plan" ? PLAN_STATUSES.includes(to) : !PLAN_STATUSES.includes(to);
  return own && MOVES[from].includes(to);
}

/** A copy moved to `to`, or an Error when the move is not allowed. */
export function moveInstruction(i: AgentInstruction, to: AgentInstructionStatus, at: string): AgentInstruction {
  if (i.status === to) return i;
  if (!canMoveInstruction(i.kind, i.status, to)) throw new Error(`An instruction that is ${i.status} cannot become ${to}.`);
  return { ...i, status: to, updatedAt: at };
}

/** Who may hand what to whom: plans go from Lyko on watch to Ask Lyko, watches from Ask Lyko to Lyko on watch. */
export function routingIssue(input: { readonly from: AgentRole; readonly to: AgentRole; readonly kind: AgentInstructionKind }): string | null {
  if (input.from === input.to) return "An instruction goes from one agent to the other.";
  if (input.kind === "plan" && input.from !== "watch") return "Plans are handed from Lyko on watch to Ask Lyko.";
  if (input.kind === "watch" && input.to !== "watch") return "Watch tasks are handed to Lyko on watch.";
  return null;
}

/** The plan instruction's status from its plan: nothing signed yet, part signed, all settled, stopped. */
export function planStatusOf(graph: Pick<IntentGraph, "steps">): PlanInstructionStatus {
  const steps = graph.steps ?? [];
  if (steps.length > 0 && steps.every((s) => s.status === "settled")) return "done";
  if (steps.some((s) => s.status === "stopped") && !steps.some((s) => s.status === "submitted" || s.status === "settling")) return "stopped";
  if (steps.some((s) => s.status === "submitted" || s.status === "settling" || s.status === "settled")) return "signed";
  return "planned";
}

const VENUE_WORDS: readonly [RegExp, string, string][] = [
  [/\baave\b/iu, "aave-v4", "Aave V4"],
  [/\bmorpho\b/iu, "morpho-blue", "Morpho Blue"],
  [/\buniswap\b/iu, "uniswap-v3", "Uniswap"],
  [/\baerodrome\b/iu, "aerodrome-slipstream", "Aerodrome"],
];

const VENUE_NAMES: Readonly<Record<string, string>> = { ...Object.fromEntries(VENUE_WORDS.map(([, id, name]) => [id, name])), morpho: "Morpho" };

function venueName(id: string | undefined): string | null {
  if (!id) return null;
  return VENUE_NAMES[id] ?? id;
}

export function watchLabel(c: WatchCondition): string {
  switch (c.kind) {
    case "health-below":
      return tx("Health factor below {threshold}{value}", { threshold: c.threshold, value: venueName(c.venue) ? tx(" on {venue}", { venue: venueName(c.venue) }) : "" });
    case "lp-out-of-range":
      return tx("Liquidity out of range{value}", { value: venueName(c.venue) ? tx(" on {venue}", { venue: venueName(c.venue) }) : "" });
    case "idle-above":
      return tx("Idle {token} above {amount}", { token: c.token, amount: c.amount });
    case "apy-below":
      return tx("Rate below {percent}%{value}", { percent: c.percent, value: venueName(c.venue) ? tx(" on {venue}", { venue: venueName(c.venue) }) : "" });
  }
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;

/** A condition with sane values, or a reason it is not. */
export function watchIssue(c: WatchCondition): string | null {
  switch (c.kind) {
    case "health-below": {
      const v = Number(c.threshold);
      return DECIMAL.test(c.threshold) && v > 1 && v <= 10 ? null : tx("A health threshold is a number above 1 and at most 10.");
    }
    case "idle-above":
      return /^(USDC|EURC)$/u.test(c.token) && DECIMAL.test(c.amount) && Number(c.amount) > 0 ? null : tx("Idle watches take USDC or EURC and an amount above 0.");
    case "apy-below":
      return DECIMAL.test(c.percent) && Number(c.percent) > 0 && Number(c.percent) < 100 ? null : tx("A rate threshold is a percent between 0 and 100.");
    case "lp-out-of-range":
      return null;
  }
}

/** Phrasings that ask for a watch rather than a move. */
const ASK_TO_WATCH = /\b(?:watch|keep (?:an )?eye on|keep watching|monitor|alert me (?:if|when)|tell me (?:if|when)|let me know (?:if|when)|warn me (?:if|when)|notify me (?:if|when)|ping me (?:if|when))\b/iu;

export interface WatchRequest {
  readonly condition: WatchCondition;
  readonly label: string;
  /** True when the threshold was not said and the owner's health floor is used. */
  readonly defaulted: boolean;
}

/**
 * The deterministic reader for watch requests: "watch my Aave position and
 * tell me if health drops below 1.5", "alert me if my health factor goes
 * under 1.4", "keep an eye on this LP", "let me know when idle USDC is above
 * 500", "tell me if the rate falls below 4%". Null when the sentence is not
 * a watch request (a move, a question, a standing order with an action).
 * A health watch without a number uses `floor` (the owner's Fence floor).
 */
export function readWatchRequest(text: string, floor = "1.5"): WatchRequest | null {
  const t = text.replace(/\s+/gu, " ").trim();
  if (!ASK_TO_WATCH.test(t) || t.length > 300) return null;
  // A move named in the sentence ("watch the price and sell") is an order, not a watch.
  if (/\b(?:send|pay|swap|sell|buy|convert|bridge|deposit|withdraw|repay)\b/iu.test(t)) return null;
  const venue = VENUE_WORDS.find(([re]) => re.test(t))?.[1];
  const health = /\bhealth(?:\s+factor)?\b/iu.test(t) || /\b(?:loan|debt|borrow(?:ing)?|liquidat\w*)\b/iu.test(t) || (/\bposition\b/iu.test(t) && (venue === "aave-v4" || venue === "morpho-blue"));
  const below = /(?:below|under|beneath|less than|drops? (?:to|below)|falls? (?:to|below)|<)\s*(\d+(?:\.\d+)?)/iu.exec(t)?.[1];
  const make = (condition: WatchCondition, defaulted = false): WatchRequest | null => (watchIssue(condition) ? null : { condition, label: watchLabel(condition), defaulted });
  if (/\b(?:lp|liquidity|range|pool position)\b/iu.test(t)) return make({ kind: "lp-out-of-range", ...(venue ? { venue } : {}) });
  const rate = /\b(?:apy|apr|rate|yield)\b/iu.test(t) ? /(\d+(?:\.\d+)?)\s*%/u.exec(t)?.[1] : undefined;
  // A rate watch on "Morpho" covers its vaults and markets alike.
  if (rate) return make({ kind: "apy-below", percent: rate, ...(venue ? { venue: venue === "morpho-blue" ? "morpho" : venue } : {}) });
  // Idle cash needs the word: "tell me when EURC is above 1.2" is a price alert, not a watch.
  const idle = /\b(?:idle|resting|sitting|spare|unused)\b/iu.test(t) || /\bbalance\b/iu.test(t) ? /\b(USDC|EURC)\b[^.]*?\b(?:above|over|more than|exceeds?|>)\s*(\d+(?:\.\d+)?)/iu.exec(t) : null;
  if (idle && !health) return make({ kind: "idle-above", token: idle[1]!.toUpperCase(), amount: idle[2]! });
  if (health) return make({ kind: "health-below", threshold: below ?? floor, ...(venue ? { venue } : {}) }, below === undefined);
  return null;
}

/** What the Fold read, as far as watches need it. */
export interface WatchFacts {
  readonly health: readonly { readonly venue: string; readonly label: string; readonly factor: string | null }[];
  readonly ranges: readonly { readonly venue: string; readonly label: string; readonly inRange: boolean }[];
  /** Whole tokens in the wallet, by symbol. */
  readonly wallet: Readonly<Record<string, number>>;
  readonly rates: readonly { readonly venue: string; readonly label: string; readonly percent: number }[];
}

export interface WatchCheck {
  readonly met: boolean;
  /** "Health factor 1.31 on Aave V4 Main Spoke, below 1.5". */
  readonly observation: string;
}

/** Venue ids that belong together ("aave-v4" watches every Aave V4 Spoke). */
function sameVenue(want: string | undefined, have: string): boolean {
  return !want || have === want || have.startsWith(want);
}

export function checkWatch(c: WatchCondition, facts: WatchFacts): WatchCheck {
  switch (c.kind) {
    case "health-below": {
      const rows = facts.health.filter((h) => sameVenue(c.venue, h.venue) && h.factor !== null);
      if (rows.length === 0) return { met: false, observation: tx("No lending position to watch yet.") };
      const low = rows.reduce((a, b) => (Number(b.factor) < Number(a.factor) ? b : a));
      const v = Number(low.factor);
      return { met: v < Number(c.threshold), observation: tx("Health factor {value} on {label}, {value2} {threshold}", { value: v.toFixed(2), label: low.label, value2: v < Number(c.threshold) ? tx("below") : tx("above"), threshold: c.threshold }) };
    }
    case "lp-out-of-range": {
      const rows = facts.ranges.filter((r) => sameVenue(c.venue, r.venue));
      if (rows.length === 0) return { met: false, observation: tx("No liquidity position to watch yet.") };
      const out = rows.filter((r) => !r.inRange);
      return { met: out.length > 0, observation: out.length > 0 ? tx("{label} is out of range", { label: out[0]!.label }) : tx("{length, plural, one {# liquidity position} other {# liquidity positions}} in range", { length: rows.length }) };
    }
    case "idle-above": {
      const have = facts.wallet[c.token] ?? 0;
      return { met: have > Number(c.amount), observation: tx("{value} {token} in the wallet, {value2} {amount}", { value: have.toFixed(2), token: c.token, value2: have > Number(c.amount) ? tx("above") : tx("below"), amount: c.amount }) };
    }
    case "apy-below": {
      const rows = facts.rates.filter((r) => sameVenue(c.venue, r.venue));
      if (rows.length === 0) return { met: false, observation: tx("No earning position to watch yet.") };
      const low = rows.reduce((a, b) => (b.percent < a.percent ? b : a));
      return { met: low.percent < Number(c.percent), observation: tx("{label} earns {value}%, {value2} {percent}%", { label: low.label, value: low.percent.toFixed(2), value2: low.percent < Number(c.percent) ? tx("below") : tx("above"), percent: c.percent }) };
    }
  }
}

/**
 * The watch Ask Lyko offers once a plan settles ("Watch this position"):
 * a borrow or a supply on a lending venue watches its health factor; a
 * deposit at a known rate watches that rate. Null when nothing fits.
 */
export function watchForPlan(graph: Pick<IntentGraph, "steps">, floor = "1.5"): WatchCondition | null {
  const steps = (graph.steps ?? []).filter((s) => s.status === "settled");
  const lending = steps.find((s) => (s.kind === "borrow" || s.kind === "supply") && (s.venue.startsWith("aave") || s.venue.startsWith("morpho-blue")));
  if (lending) return { kind: "health-below", threshold: floor, venue: lending.venue.startsWith("aave") ? "aave-v4" : "morpho-blue" };
  const deposit = steps.find((s) => (s.kind === "deposit" || s.kind === "supply") && s.route?.chosen.apy);
  const apy = deposit ? Number(deposit.route!.chosen.apy) * 100 : NaN;
  if (deposit && Number.isFinite(apy) && apy > 0.5) return { kind: "apy-below", percent: (Math.floor(apy * 0.8 * 100) / 100).toString(), venue: deposit.venue };
  return null;
}

/** "Lyko on watch → Ask Lyko · planned", for the thread and the cards. */
export function instructionChip(i: Pick<AgentInstruction, "from" | "to" | "kind" | "status">): string {
  const status = i.status === "done" || i.status === "signed" ? "signed" : i.status;
  return i.kind === "plan" ? tx("Sent to {value} · {status}", { value: AGENT_NAMES[i.to], status }) : tx("From {value} · {status}", { value: AGENT_NAMES[i.from], status });
}
