/**
 * LykiaOrders in the review modal (pure: node tests import it). An order is
 * signed once (EIP-712, no gas) after an allowance when one is needed, and a
 * cancel is one transaction; both are laid out as the same ReviewView the
 * plan review draws, so orders get the same mosaic, the same Fence seal and
 * the same step list.
 */
import type { AnswerBlock } from "@lykia/core/api/answer";
import type { ArcEnvironment } from "@lykia/core";
import type { ReviewView } from "./reviewModel";
import { t } from "../../i18n";

/** What POST /v1/orders/draft answers (the subset the review needs). */
export interface OrderDraft {
  readonly hash: string;
  readonly summary: string;
  readonly order: Record<string, unknown> & { readonly executions: number };
  readonly typedData: { readonly domain: Record<string, unknown>; readonly types: Record<string, { name: string; type: string }[]>; readonly primaryType: string; readonly message: Record<string, string | number | boolean> };
  readonly approval: { readonly to: string; readonly data: string; readonly value: string; readonly label: string; readonly chainId?: number } | null;
  readonly perExecution: { readonly fee: string; readonly maxTip: string; readonly swapped: string; readonly minOut: string; readonly symbolIn: string; readonly symbolOut: string };
  readonly notes: readonly string[];
  readonly verdict?: { readonly decision: "allow" | "confirm" | "deny"; readonly reasons: readonly { readonly decision: string; readonly message: string }[] };
}

export type OrderStepState = "pending" | "settled";

const NO_STAGES = { total: 1, stages: [], current: null, done: false, paused: false, stopped: false, headline: "" } as const;

/** viem wants bigint for the uint fields of the typed order. */
export function signableOrder(td: OrderDraft["typedData"]): Record<string, unknown> {
  const m = td.message;
  const big = (k: string) => (m[k] === undefined ? undefined : BigInt(String(m[k])));
  const message = { ...m, amountIn: big("amountIn"), minAmountOut: big("minAmountOut"), maxTip: big("maxTip"), triggerPrice: big("triggerPrice"), startTime: big("startTime"), deadline: big("deadline"), nonce: big("nonce") };
  const { EIP712Domain: _drop, ...types } = td.types as Record<string, unknown>;
  return { domain: td.domain, types, primaryType: td.primaryType, message };
}

/** The order's review: what each execution sends and gets, the allowance and the signature, and the Fence's verdict. */
export function orderReviewView(block: Extract<AnswerBlock, { kind: "order" }>, draft: OrderDraft | null, states: { readonly approval: OrderStepState; readonly sign: OrderStepState }): ReviewView {
  const pe = draft?.perExecution ?? { ...block.perExecution, maxTip: "0" };
  const decision = draft?.verdict?.decision ?? block.decision;
  const reasons = draft?.verdict ? draft.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message) : block.reasons;
  const needsApproval = draft ? draft.approval !== null : block.approval !== null;
  const steps: ReviewView["steps"][number][] = [
    ...(needsApproval ? [{ id: "approve", n: 1, summary: draft?.approval?.label ?? block.approval ?? t("route.orderReview.allowLykiaordersToPullEachExecution"), kind: "approve", venue: "LykiaOrders", status: states.approval === "settled" ? ("settled" as const) : ("awaiting-signature" as const), memo: t("route.orderReview.oneExactAllowanceRevocableAnyTime"), fee: null, why: t("route.orderReview.lykiaordersPullsEachExecutionFromYour"), tx: null, failure: null }] : []),
    { id: "sign", n: needsApproval ? 2 : 1, summary: t("route.orderReview.signTheOrderOnce", { value: draft?.summary ?? block.summary }).slice(0, 200), kind: "order", venue: "LykiaOrders", status: states.sign === "settled" ? ("settled" as const) : needsApproval && states.approval !== "settled" ? ("blocked" as const) : ("awaiting-signature" as const), memo: draft ? t("route.orderReview.eip712OrderNoGas", { value: draft.hash.slice(0, 10) }) : t("route.orderReview.eip712OrderNoGas2"), fee: t("route.orderReview.perExecution", { fee: pe.fee, symbolIn: pe.symbolIn }), why: t("route.orderReview.keepersExecuteItWhenChainlinkSays"), tx: null, failure: null },
  ];
  const next = steps.find((s) => s.status === "awaiting-signature")?.id ?? null;
  const settled = steps.filter((s) => s.status === "settled").length;
  return {
    id: draft ? draft.hash.slice(0, 12) : "order",
    environment: block.environment as ArcEnvironment,
    decision,
    signable: decision !== "deny" && draft !== null,
    reasons,
    send: [{ symbol: pe.symbolIn, amount: block.input.amount, where: block.executions > 1 ? t("route.orderReview.eachOfExecutions", { executions: block.executions }) : t("route.orderReview.onceWhenItTriggers"), usd: null, minimum: null }],
    get: [{ symbol: pe.symbolOut, amount: pe.minOut, where: t("route.orderReview.backInYourWallet"), usd: null, minimum: pe.minOut }],
    steps,
    fees: [t("route.orderReview.perExecution", { fee: pe.fee, symbolIn: pe.symbolIn })],
    feeBps: null,
    signatures: steps.length - settled,
    nextStepId: next,
    stage: decision === "deny" ? "denied" : settled === steps.length ? "settled" : settled > 0 ? "running" : "ready",
    settledCount: settled,
    lastTx: null,
    warnings: draft?.notes ?? [],
    staged: NO_STAGES as unknown as ReviewView["staged"],
  };
}

/** A cancel through the review modal: one transaction the maker sends. */
export function cancelReviewView(input: { readonly hash: string; readonly name: string; readonly environment: ArcEnvironment }, state: OrderStepState): ReviewView {
  const step = { id: "cancel", n: 1, summary: t("route.orderReview.cancel", { name: input.name }).slice(0, 200), kind: "cancel", venue: "LykiaOrders", status: state === "settled" ? ("settled" as const) : ("awaiting-signature" as const), memo: `cancel(${input.hash.slice(0, 10)}…)`, fee: null, why: t("route.orderReview.onlyYouTheMakerCanCancel"), tx: null, failure: null };
  return {
    id: input.hash.slice(0, 12),
    environment: input.environment,
    decision: "allow",
    signable: true,
    reasons: [],
    send: [],
    get: [],
    steps: [step],
    fees: [],
    feeBps: null,
    signatures: state === "settled" ? 0 : 1,
    nextStepId: state === "settled" ? null : "cancel",
    stage: state === "settled" ? "settled" : "ready",
    settledCount: state === "settled" ? 1 : 0,
    lastTx: null,
    warnings: [],
    staged: NO_STAGES as unknown as ReviewView["staged"],
  };
}
