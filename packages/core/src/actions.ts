/**
 * Plan actions: the typed input of the planner. The language reader turns
 * sentences into actions; SDK users and agents can send actions directly.
 * Amounts are decimal strings in whole tokens, a share of the balance, or
 * "all". Never floats.
 *
 * Shares and "all" are resolved against the balance the plan starts with:
 * "put 40% in a vault, convert 20% to EURC and bridge the rest" takes 40%
 * and 20% of the starting USDC and bridges what is left. A `reserve`
 * action keeps an amount untouched (it is taken out of the base first).
 */
import { isDecimalAmount } from "./amounts.js";
import { isAddress, type Address } from "./contracts.js";
import { findToken } from "./assets.js";
import { findCctpDestination } from "./networks.js";
import { RATIO_PATTERN } from "./fence.js";
import { RISK_ORDER, type RiskTier } from "./routes.js";

/**
 * exact: a decimal amount; percent: a share of the starting balance; all: everything spendable
 * at that point; previous: exactly what the step before produced (the borrowed amount after
 * the fee, a swap's guaranteed minimum), so "borrow 1000 USDC and put it to work" never sweeps
 * the rest of the wallet.
 */
export type ActionAmount = { readonly exact: string } | { readonly percent: number } | { readonly all: true } | { readonly previous: true };

export interface AllocationTarget {
  readonly token: string;
  /** Share of the rebalanced value, in basis points; targets sum to 10000. */
  readonly weightBps: number;
}

export type PlanAction =
  | { readonly verb: "send"; readonly token: string; readonly amount: ActionAmount; readonly to: Address; readonly memo?: string }
  | { readonly verb: "fx"; readonly from: string; readonly to: string; readonly amount: ActionAmount }
  | { readonly verb: "swap"; readonly from: string; readonly to: string; readonly amount: ActionAmount; readonly slippageBps?: number; readonly venue?: string }
  | { readonly verb: "earn"; readonly token: string; readonly amount: ActionAmount; readonly venue?: string; readonly maxRisk?: RiskTier }
  | { readonly verb: "withdraw"; readonly token: string; readonly amount: ActionAmount; readonly venue?: string }
  | { readonly verb: "supply"; readonly token: string; readonly amount: ActionAmount; readonly venue?: string }
  | {
      readonly verb: "borrow";
      readonly token: string;
      readonly amount: ActionAmount;
      readonly venue?: string;
      /** Collateral to post first; amount absent = just enough for `minHealth` (capped by the wallet balance). */
      readonly collateral?: { readonly token: string; readonly amount?: ActionAmount };
      /** Health factor the position must keep after the borrow ("1.8"). */
      readonly minHealth?: string;
    }
  | { readonly verb: "repay"; readonly token: string; readonly amount: ActionAmount; readonly venue?: string }
  | { readonly verb: "bridge"; readonly token: string; readonly amount: ActionAmount; readonly destination: string; readonly recipient?: string; readonly venue?: string }
  | { readonly verb: "unify"; readonly amount: ActionAmount }
  /** Keep `amount` of `token` liquid in the wallet: later shares and "all" never touch it. */
  | { readonly verb: "reserve"; readonly token: string; readonly amount: ActionAmount; readonly reason?: string }
  /** Move the listed tokens to target weights (by USD value) with the fewest swaps. */
  | { readonly verb: "rebalance"; readonly targets: readonly AllocationTarget[]; readonly toleranceBps?: number };

export type ActionVerb = PlanAction["verb"];

export const ACTION_VERBS: readonly ActionVerb[] = ["send", "fx", "swap", "earn", "withdraw", "supply", "borrow", "repay", "bridge", "unify", "reserve", "rebalance"];

export interface ActionIssue {
  readonly index: number;
  readonly message: string;
}

function amountProblem(amount: unknown): string | null {
  if (typeof amount !== "object" || amount === null) return "amount is required.";
  const a = amount as Record<string, unknown>;
  if ("exact" in a) return isDecimalAmount(a.exact) && a.exact !== "0" && !/^0(?:\.0+)?$/u.test(a.exact as string) ? null : "amount.exact must be a positive decimal string.";
  if ("percent" in a) return typeof a.percent === "number" && Number.isInteger(a.percent) && a.percent >= 1 && a.percent <= 100 ? null : "amount.percent must be 1 to 100.";
  if ("all" in a) return a.all === true ? null : "amount.all must be true.";
  if ("previous" in a) return a.previous === true ? null : "amount.previous must be true.";
  return "amount needs exact, percent, all or previous.";
}

export function validateActions(actions: unknown): ActionIssue[] {
  if (!Array.isArray(actions) || actions.length === 0) return [{ index: -1, message: "Send at least one action." }];
  if (actions.length > 12) return [{ index: -1, message: "At most 12 actions per plan." }];
  const issues: ActionIssue[] = [];
  actions.forEach((raw, index) => {
    const add = (message: string) => issues.push({ index, message });
    if (typeof raw !== "object" || raw === null) return add("An action is an object.");
    const a = raw as Record<string, unknown>;
    if (!ACTION_VERBS.includes(a.verb as ActionVerb)) return add(`verb must be one of ${ACTION_VERBS.join(", ")}.`);
    if (a.verb !== "rebalance") {
      const problem = amountProblem(a.amount);
      if (problem) add(problem);
      else if (index === 0 && typeof a.amount === "object" && a.amount !== null && "previous" in a.amount) add("amount.previous needs a step before it.");
    }
    const token = (key: string, value: unknown = a[key]) => {
      if (typeof value !== "string" || findToken("mainnet", value) === null) add(`${key} must be a registry token (see GET /v1/tokens).`);
    };
    switch (a.verb) {
      case "send":
        token("token");
        if (!isAddress(a.to)) add("to must be an address.");
        if (a.memo !== undefined && (typeof a.memo !== "string" || a.memo.length > 256)) add("memo is at most 256 characters.");
        break;
      case "fx":
      case "swap":
        token("from");
        token("to");
        if (a.from === a.to) add("from and to must differ.");
        if (a.slippageBps !== undefined && !(Number.isInteger(a.slippageBps) && (a.slippageBps as number) >= 0 && (a.slippageBps as number) <= 1000)) add("slippageBps must be 0 to 1000.");
        break;
      case "earn":
        token("token");
        if (a.maxRisk !== undefined && !RISK_ORDER.includes(a.maxRisk as RiskTier)) add("maxRisk must be low, medium or high.");
        break;
      case "withdraw":
      case "supply":
      case "repay":
      case "reserve":
        token("token");
        break;
      case "borrow": {
        token("token");
        if (a.minHealth !== undefined && (typeof a.minHealth !== "string" || !RATIO_PATTERN.test(a.minHealth) || Number(a.minHealth) < 1)) add('minHealth must be a ratio of at least "1.0".');
        if (a.collateral !== undefined) {
          const c = a.collateral as Record<string, unknown> | null;
          if (typeof c !== "object" || c === null) add("collateral must be an object.");
          else {
            token("collateral.token", c.token);
            if (c.amount !== undefined) {
              const problem = amountProblem(c.amount);
              if (problem) add(`collateral.${problem}`);
            }
          }
        }
        break;
      }
      case "bridge":
        token("token");
        if (typeof a.destination !== "string" || findCctpDestination(a.destination) === null) add("destination must be a CCTP chain (base, ethereum, arbitrum, ...).");
        break;
      case "unify":
        break;
      case "rebalance": {
        const targets = a.targets as unknown;
        if (!Array.isArray(targets) || targets.length < 2 || targets.length > 4) {
          add("targets must list 2 to 4 tokens.");
          break;
        }
        let sum = 0;
        const seen = new Set<string>();
        targets.forEach((t: unknown, i: number) => {
          const target = t as Record<string, unknown> | null;
          if (typeof target !== "object" || target === null) return add(`targets.${i} must be an object.`);
          token(`targets.${i}.token`, target.token);
          if (typeof target.token === "string") {
            if (seen.has(target.token.toUpperCase())) add(`targets.${i}.token is listed twice.`);
            seen.add(target.token.toUpperCase());
          }
          if (!Number.isInteger(target.weightBps) || (target.weightBps as number) < 0 || (target.weightBps as number) > 10_000) add(`targets.${i}.weightBps must be 0 to 10000.`);
          else sum += target.weightBps as number;
        });
        if (sum !== 10_000) add("target weights must add up to 100%.");
        if (a.toleranceBps !== undefined && !(Number.isInteger(a.toleranceBps) && (a.toleranceBps as number) >= 0 && (a.toleranceBps as number) <= 2_000)) add("toleranceBps must be 0 to 2000.");
        break;
      }
    }
  });
  return issues;
}
