/**
 * One plan step from "quote" to "settled", as plain async steps with
 * injected effects (pure, so it is tested without a wallet or a server).
 *
 *   quote   POST prepare: the server rebuilds the calls fresh (quotes and
 *           allowances re-read; a price past the planned minimum refuses).
 *   sign    re-quotes first when the quote is older than QUOTE_TTL_MS, so a
 *           stale quote is never signed; switches the wallet to the plan's
 *           chain; sends; remembers what was sent.
 *   submit  POST submit with the hashes; "Arc does not know it yet" and
 *           transport errors are retried with backoff. A retry after the
 *           wallet sent never signs again: it resubmits the same hashes.
 */
import type { PrepareStepResponse, SubmitStepResponse } from "@lykia/core/api/intents";

import { ApiError } from "../../lib/apiErrors";
import type { WalletTx } from "../wallet/useLykiaWallet";
import { classifyTxError, type TxFailure, type TxStage } from "./txErrors";
import { t } from "../../i18n";

/** A prepared step is re-quoted before signing once it is older than this. */
export const QUOTE_TTL_MS = 30_000;
const SUBMIT_DELAYS_MS = [800, 1_500, 2_500, 4_000] as const;

export type Sent = { readonly hashes: readonly `0x${string}`[] } | { readonly userOpHash: `0x${string}` };

export interface Prepared {
  readonly response: PrepareStepResponse;
  readonly at: number;
}

export interface StepEffects {
  prepare(stepId: string, confirmed: boolean): Promise<PrepareStepResponse>;
  /** Switch the wallet to `chainId` when it is elsewhere (no-op for smart accounts). */
  ensureChain(chainId: number): Promise<void>;
  send(txs: readonly WalletTx[]): Promise<Sent>;
  submit(stepId: string, sent: Sent): Promise<SubmitStepResponse>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type FlowPhase = "quoting" | "quoted" | "switching" | "signing" | "submitting" | "settled" | "submitted";

export interface FlowHooks {
  onPhase?(phase: FlowPhase, stepId: string): void;
  onPrepared?(prepared: Prepared, stepId: string): void;
  onSent?(sent: Sent, stepId: string): void;
}

export class StepFlowError extends Error {
  constructor(readonly failure: TxFailure, readonly original: unknown) {
    super(failure.title);
    this.name = "StepFlowError";
  }
}

export function isQuoteStale(prepared: Prepared | null | undefined, now: number, ttlMs = QUOTE_TTL_MS): boolean {
  return !prepared || now - prepared.at > ttlMs;
}

function fail(error: unknown, stage: TxStage, network?: string): never {
  if (error instanceof StepFlowError) throw error;
  throw new StepFlowError(classifyTxError(error, stage, network ? { network } : {}), error);
}

export async function quoteStep(effects: StepEffects, stepId: string, confirmed: boolean, hooks: FlowHooks = {}): Promise<Prepared> {
  hooks.onPhase?.("quoting", stepId);
  let response: PrepareStepResponse;
  try {
    response = await effects.prepare(stepId, confirmed);
  } catch (error) {
    fail(error, "prepare");
  }
  const prepared = { response, at: effects.now() };
  hooks.onPrepared?.(prepared, stepId);
  hooks.onPhase?.("quoted", stepId);
  return prepared;
}

/** True for submit failures worth waiting out: the node has not seen the hash yet, or a transport hiccup. */
export function submitRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return (error.code === "NOT_FOUND" && /does not know/iu.test(error.message)) || error.retryable;
}

export async function submitWithRetry(effects: Pick<StepEffects, "submit" | "sleep">, stepId: string, sent: Sent): Promise<SubmitStepResponse> {
  let last: unknown = null;
  for (let attempt = 0; attempt <= SUBMIT_DELAYS_MS.length; attempt++) {
    try {
      return await effects.submit(stepId, sent);
    } catch (error) {
      last = error;
      if (!submitRetryable(error) || attempt === SUBMIT_DELAYS_MS.length) break;
      await effects.sleep(SUBMIT_DELAYS_MS[attempt]!);
    }
  }
  return fail(last, "submit");
}

export interface SignInput {
  readonly stepId: string;
  readonly confirmed: boolean;
  /** The last quote, if any; re-quoted when stale. */
  readonly prepared?: Prepared | null;
  /** What the wallet already sent for this step: resubmitted, never re-signed. */
  readonly sent?: Sent | null;
  readonly network?: string;
}

/** Signs and submits one step. Resolves with the server's view of the step; throws StepFlowError. */
export async function signStep(effects: StepEffects, input: SignInput, hooks: FlowHooks = {}): Promise<SubmitStepResponse> {
  const { stepId } = input;
  let sent = input.sent ?? null;
  if (!sent) {
    const prepared = isQuoteStale(input.prepared, effects.now()) ? await quoteStep(effects, stepId, input.confirmed, hooks) : (input.prepared as Prepared);
    const txs = prepared.response.transactions;
    const chainId = txs[0]?.chainId;
    if (chainId !== undefined) {
      hooks.onPhase?.("switching", stepId);
      try {
        await effects.ensureChain(chainId);
      } catch (error) {
        fail(error, "chain", input.network);
      }
    }
    hooks.onPhase?.("signing", stepId);
    try {
      sent = await effects.send(txs as readonly WalletTx[]);
    } catch (error) {
      fail(error, "sign", input.network);
    }
    hooks.onSent?.(sent, stepId);
  }
  hooks.onPhase?.("submitting", stepId);
  const result = await submitWithRetry(effects, stepId, sent);
  if (result.step.status === "failed") {
    const message = result.step.failure?.message ?? t("route.stepFlow.theTransactionRevertedOnArc");
    throw new StepFlowError(classifyTxError(new Error(t("route.stepFlow.executionReverted", { message })), "submit"), null);
  }
  hooks.onPhase?.(result.step.status === "settled" ? "settled" : "submitted", stepId);
  return result;
}
