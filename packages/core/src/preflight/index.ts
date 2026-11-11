/**
 * Preflight: run every plan check, order the findings (blocks first, then
 * warnings, then notes), and say the first one in one plain sentence. The
 * API gathers the state; everything here is pure.
 */
import { PLAN_CHECKS, type CheckContext } from "./checks.js";
import { walk } from "./ledger.js";
import type { Finding, FindingFix, FindingSeverity, PreflightCheckInfo, PreflightPlan, PreflightState } from "./types.js";

import { phrase, localized } from "../i18n/index.js";
export * from "./types.js";
export { bridgeRefusal, fingerprintOf, lookalike, quoteAgeFinding, unlimitedApprovalFindings, walletNetworkFinding } from "./checks.js";
export { feePerGasWei, gasUsdcUnits, lowerSpend, sentenceFor, show as showUnits, walk } from "./ledger.js";
export { watchFindings, ONE_TX_GAS, SWAP_GAS, type WatchState } from "./watch.js";

const RANK: Readonly<Record<FindingSeverity, number>> = { block: 0, warn: 1, note: 2 };

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return findings.map((f, i) => ({ f, i })).sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i).map((x) => x.f);
}

/** Every check over the plan; a check that throws drops only its own findings. */
export function runPreflight(plan: PreflightPlan, state: PreflightState): Finding[] {
  const c: CheckContext = { plan, state, ledger: walk(plan, state) };
  const out: Finding[] = [];
  const ids = new Set<string>();
  for (const check of PLAN_CHECKS) {
    let found: Finding[];
    try {
      found = check(c);
    } catch {
      found = [];
    }
    for (const f of found) {
      if (ids.has(f.id)) continue;
      ids.add(f.id);
      out.push(f);
    }
  }
  return sortFindings(out);
}

export interface PreflightGate {
  readonly blocked: boolean;
  /** Warnings the owner has not acknowledged yet. */
  readonly needsAck: readonly string[];
  readonly worst: FindingSeverity | null;
}

export function preflightGate(findings: readonly Finding[] | undefined, acknowledged: readonly string[] | boolean = false): PreflightGate {
  const list = findings ?? [];
  const blocked = list.some((f) => f.severity === "block");
  const warns = list.filter((f) => f.severity === "warn").map((f) => f.id);
  const needsAck = acknowledged === true ? [] : warns.filter((id) => !(Array.isArray(acknowledged) && acknowledged.includes(id)));
  const worst = blocked ? "block" : warns.length > 0 ? "warn" : list.length > 0 ? "note" : null;
  return { blocked, needsAck, worst };
}

/** The most severe one or two, then how many more ("calm, never a wall of alerts"). */
export function topFindings(findings: readonly Finding[], n = 2): { readonly shown: readonly Finding[]; readonly more: number } {
  const sorted = sortFindings(findings);
  const lead = sorted.filter((f) => f.severity !== "note");
  const shown = (lead.length > 0 ? lead : sorted).slice(0, n);
  return { shown, more: sorted.length - shown.length };
}

/** The first fix that asks a question, for the end of the chat's warning sentence. */
export function leadFix(f: Finding): FindingFix | null {
  return f.fixes.find((x) => x.question) ?? f.fixes.find((x) => x.kind === "replan") ?? null;
}

/**
 * What Lyko says before anything else when a plan has a block or a warning:
 * the finding's own sentence, then the question its first fix asks. Code
 * wrote every figure in it; null when nothing is in the way.
 */
export function preflightLead(findings: readonly Finding[] | undefined): string | null {
  const first = sortFindings(findings ?? []).find((f) => f.severity !== "note");
  if (!first) return null;
  const fix = leadFix(first);
  return `${first.say}${fix?.question ? ` ${fix.question}` : fix ? ` ${fix.label}${fix.detail ? ` (${fix.detail})` : ""}?` : ""}`;
}

/** What every check does, for the capability map ("Lyko knows it can warn about these"). */
export const PREFLIGHT_CHECKS: readonly PreflightCheckInfo[] = localized([
  { id: "gas-reserve", family: "gas", name: phrase("Gas reserve on Arc"), plain: phrase("USDC left after every step, Lykia's fee and each step's network fee: warns under your network fee reserve, blocks when the plan cannot pay its own fee, and offers the amount that keeps the reserve."), runs: ["plan", "prepare", "watch"] },
  { id: "cash-floor", family: "money", name: phrase("Cash to keep at hand"), plain: phrase("Warns when a plan takes your USDC under the floor you keep at hand, with the amount that respects it."), runs: ["plan", "prepare"] },
  { id: "obligations", family: "time", name: phrase("What is due this week"), plain: phrase("Recurring payments and order slices due in the next 7 days that the balance left would not cover; offers a smaller amount or a pause in Herding."), runs: ["plan", "prepare", "watch"] },
  { id: "dust", family: "money", name: phrase("Dust"), plain: phrase("A remainder worth under $0.05 left behind; offers to use all of it."), runs: ["plan", "watch"] },
  { id: "insufficient", family: "money", name: phrase("Not enough balance"), plain: phrase("Names exactly what is missing (the amount, Lykia's fee, the network fee) and offers the most that fits, or funds already on their way."), runs: ["plan", "prepare"] },
  { id: "cost-ratio", family: "cost", name: phrase("Costs for the amount"), plain: phrase("Lykia's fee, the network fee and price impact together: a note above 2% of the amount, a warning above 5%."), runs: ["plan"] },
  { id: "price-impact", family: "cost", name: phrase("Price impact"), plain: phrase("A swap paying more than 1% (or your Fence's slippage) under the reference price; offers a smaller swap now."), runs: ["plan"] },
  { id: "fx-band", family: "risk", name: phrase("FX rate against the reference"), plain: phrase("A USDC/EURC rate off Chainlink's EURC/USD beyond your Fence's band, with both rates."), runs: ["plan", "prepare"] },
  { id: "price-stale", family: "time", name: phrase("Stale prices"), plain: phrase("A Chainlink round older than its heartbeat allows."), runs: ["plan"] },
  { id: "quote-age", family: "time", name: phrase("Quote age"), plain: phrase("A quote older than 30 seconds is rebuilt from Arc before the wallet opens."), runs: ["review"] },
  { id: "round-trip", family: "cost", name: phrase("Round trip"), plain: phrase("The same pair converted the other way in the last 24 hours, with the fees and spread both trades lose."), runs: ["plan"] },
  { id: "loan-health", family: "risk", name: phrase("Loan health"), plain: phrase("Health before and after a borrow, a collateral withdrawal or a partial repay: blocks under your Fence's floor, warns close to it."), runs: ["plan", "prepare"] },
  { id: "vault-state", family: "risk", name: phrase("Vault state"), plain: phrase("A deposit above the vault's remaining cap (maxDeposit), a rate down over 30% in a week, or a high risk rating."), runs: ["plan"] },
  { id: "lp-range", family: "risk", name: phrase("Liquidity range"), plain: phrase("Liquidity out of its price range earns nothing (Lyko on watch; Lykia does not open LP positions in plans)."), runs: ["watch"] },
  { id: "approvals", family: "approval", name: phrase("Approvals"), plain: phrase("Blocks an unlimited approval in the calls; notes old unlimited approvals to a spender the plan touches."), runs: ["plan", "prepare", "watch"] },
  { id: "recipient", family: "address", name: phrase("Recipient checks"), plain: phrase("The zero address, a token or Lykia contract, a lookalike of an address you paid before (address poisoning, with \"Did you mean…\"), your own address, a contract, or a first-time payee."), runs: ["plan"] },
  { id: "bridge-destination", family: "bridge", name: phrase("Bridge destination"), plain: phrase("An unsupported chain (with the supported list), a recipient without native gas on the destination, the bridge time and fee, and a bridge stuck longer than expected."), runs: ["plan", "watch"] },
  { id: "network", family: "network", name: phrase("Network and wallet"), plain: phrase("The wallet on another chain (with a Switch network fix) and an Arc RPC whose latest block is old."), runs: ["plan", "review"] },
  { id: "duplicate", family: "time", name: phrase("Duplicate"), plain: phrase("The same steps, amounts and recipients planned or signed in the last 10 minutes."), runs: ["plan"] },
  { id: "fence-room", family: "limits", name: phrase("Fence room"), plain: phrase("A plan over today's Fence or beta room, with the amount that fits today."), runs: ["plan", "prepare"] },
  { id: "budget", family: "limits", name: phrase("Budget use"), plain: phrase("A plan that uses 80% or more of the day's budget (your Fence, a leash, an agent or Autopilot)."), runs: ["plan"] },
  { id: "conflict", family: "time", name: phrase("Conflicts in Herding"), plain: phrase("An automation that moves the same token within 24 hours, named, with its Pause."), runs: ["plan"] },
  { id: "unpriced", family: "cost", name: phrase("Unpriced tokens"), plain: phrase("A step without a USD price, which caps count as unknown."), runs: ["plan"] },
  { id: "plan-refused", family: "money", name: phrase("Refused plans"), plain: phrase("When the planner cannot build a plan, the reason as a finding with what would fit."), runs: ["plan"] },
]);
