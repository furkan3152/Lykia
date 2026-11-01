/**
 * Plan actions: the typed input of the planner. The language reader turns
 * sentences into actions; SDK users and agents can send actions directly.
 * Amounts are decimal strings in whole tokens, a share of the balance, or
 * "all". Never floats.
 */
import { isDecimalAmount } from "./amounts.js";
import { isAddress, type Address } from "./contracts.js";
import { findToken } from "./assets.js";
import { findCctpDestination } from "./networks.js";

export type ActionAmount = { readonly exact: string } | { readonly percent: number } | { readonly all: true };

export type PlanAction =
  | { readonly verb: "send"; readonly token: string; readonly amount: ActionAmount; readonly to: Address; readonly memo?: string }
  | { readonly verb: "fx"; readonly from: string; readonly to: string; readonly amount: ActionAmount }
  | { readonly verb: "swap"; readonly from: string; readonly to: string; readonly amount: ActionAmount; readonly slippageBps?: number; readonly venue?: string }
  | { readonly verb: "earn"; readonly token: string; readonly amount: ActionAmount; readonly venue?: string }
  | { readonly verb: "withdraw"; readonly token: string; readonly amount: ActionAmount; readonly venue?: string }
  | { readonly verb: "borrow"; readonly token: string; readonly amount: ActionAmount; readonly venue?: string }
  | { readonly verb: "repay"; readonly token: string; readonly amount: ActionAmount; readonly venue?: string }
  | { readonly verb: "bridge"; readonly token: string; readonly amount: ActionAmount; readonly destination: string; readonly recipient?: string }
  | { readonly verb: "unify"; readonly amount: ActionAmount };

export type ActionVerb = PlanAction["verb"];

export const ACTION_VERBS: readonly ActionVerb[] = ["send", "fx", "swap", "earn", "withdraw", "borrow", "repay", "bridge", "unify"];

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
  return "amount needs exact, percent or all.";
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
    const problem = amountProblem(a.amount);
    if (problem) add(problem);
    const token = (key: string) => {
      if (typeof a[key] !== "string" || findToken("mainnet", a[key] as string) === null) add(`${key} must be a registry token (USDC, EURC, USYC, cirBTC).`);
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
      case "withdraw":
      case "borrow":
      case "repay":
        token("token");
        break;
      case "bridge":
        token("token");
        if (typeof a.destination !== "string" || findCctpDestination(a.destination) === null) add("destination must be a CCTP chain (base, ethereum, arbitrum, ...).");
        break;
      case "unify":
        break;
    }
  });
  return issues;
}
