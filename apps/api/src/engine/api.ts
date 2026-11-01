/**
 * The engine's surface for other layers (the Lyko agent, sub-agents, MCP,
 * standing orders). Three calls, all deterministic and side-effect free
 * except that `planActions` stores the plan (unless dryRun). None of them
 * signs anything. See README.md in this folder.
 */
import { getToken, ratioBps, toBaseUnitsBig, type Address, type ArcEnvironment, type PlanAction, type RiskTier, type RouteChoice, type StandingOrderDraft, type VenueOption } from "@lykia/core";
import type { ClarifyChoice } from "@lykia/core/api/language";
import type { CreateIntentResponse } from "@lykia/core/api/intents";
import { readSentence, type ReadOptions } from "../language/reader.js";
import type { VenueRouter } from "./router.js";
import type { CreateInput, IntentService } from "./service.js";

export interface CompiledGoals {
  readonly actions: readonly PlanAction[];
  readonly standing: readonly StandingOrderDraft[];
  readonly clarify: readonly string[];
  readonly clarifyChoices: readonly ClarifyChoice[];
}

/** Sentence -> plan actions now + standing orders for later, or questions. */
export function compileGoals(text: string, options: ReadOptions = {}): CompiledGoals {
  const r = readSentence(text, options);
  return { actions: r.actions, standing: r.standing ?? [], clarify: r.clarify, clarifyChoices: r.clarifyChoices ?? [] };
}

/** Plan actions into an intent graph with routed venues and the Fence verdict (stored unless dryRun). */
export function planActions(intents: IntentService, input: CreateInput): Promise<CreateIntentResponse> {
  return intents.create(input);
}

export type QuoteRequest =
  | { readonly kind: "swap"; readonly environment: ArcEnvironment; readonly from: string; readonly to: string; readonly amount: string }
  | { readonly kind: "earn"; readonly environment: ArcEnvironment; readonly token: string; readonly maxRisk?: RiskTier }
  | { readonly kind: "borrow"; readonly environment: ArcEnvironment; readonly token: string; readonly amount: string; readonly collateral?: string; readonly collateralAmount?: string; readonly minHealth?: string; readonly account: Address };

export interface QuoteResponse {
  readonly kind: QuoteRequest["kind"];
  readonly environment: ArcEnvironment;
  readonly options: readonly VenueOption[];
  readonly choice: RouteChoice | null;
}

/** Every live venue's option for one action, priced the same way, plus the engine's pick. */
export async function quoteVenues(router: VenueRouter, request: QuoteRequest): Promise<QuoteResponse> {
  switch (request.kind) {
    case "swap": {
      const from = getToken(request.from);
      if (!from || !getToken(request.to)) return { kind: "swap", environment: request.environment, options: [], choice: null };
      const units = toBaseUnitsBig(request.amount, from.decimals);
      const { candidates, readOnly } = await router.swap(request.environment, request.from, request.to, units);
      const best = await router.bestSwap(request.environment, request.from, request.to, units);
      return { kind: "swap", environment: request.environment, options: [...candidates.map((c) => c.option), ...readOnly], choice: best?.route ?? null };
    }
    case "earn": {
      const candidates = await router.earn(request.environment, request.token);
      const choice = router.chooseEarn(candidates, request.maxRisk ?? "medium");
      return { kind: "earn", environment: request.environment, options: candidates.map((c) => c.option), choice: choice?.route ?? null };
    }
    case "borrow": {
      const loan = getToken(request.token);
      const coll = getToken(request.collateral ?? "cirBTC");
      if (!loan || !coll) return { kind: "borrow", environment: request.environment, options: [], choice: null };
      const minHealth = request.minHealth ?? "1.5";
      const candidates = await router.borrow(request.environment, {
        loan: loan.symbol,
        amount: toBaseUnitsBig(request.amount, loan.decimals),
        collateral: coll.symbol,
        collateralUnits: request.collateralAmount ? toBaseUnitsBig(request.collateralAmount, coll.decimals) : null,
        walletCollateral: 10n ** 30n,
        minHealthWad: ratioBps(minHealth) * 10n ** 14n,
        account: request.account,
      });
      const choice = router.chooseBorrow(candidates, minHealth);
      return { kind: "borrow", environment: request.environment, options: candidates.map((c) => c.option), choice: choice?.route ?? null };
    }
  }
}
