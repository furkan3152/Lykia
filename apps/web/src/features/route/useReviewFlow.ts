/**
 * The review modal's engine: quote the next step as soon as the modal opens
 * (the server rebuilds the calls fresh), sign it in the owner's wallet when
 * asked (re-quoting a stale quote first), submit and follow it to settled.
 * Failures arrive classified (txErrors.ts) with the one retry that fits.
 */
import type { CreateIntentResponse, PrepareStepResponse, SubmitStepResponse } from "@lykia/core/api/intents";
import type { SecurityReport } from "@lykia/core/security/index";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { apiPost } from "../../lib/api";
import { reportFromError } from "../security/model";
import { useWallet } from "../wallet/store";
import { useLykiaWallet } from "../wallet/useLykiaWallet";
import { quoteStep, signStep, StepFlowError, type FlowPhase, type Prepared, type Sent, type StepEffects } from "./stepFlow";
import type { TxFailure } from "./txErrors";

export type ReviewPhase = "idle" | "quoting" | "quoted" | "switching" | "signing" | "submitting" | "submitted" | "settled" | "failed";

export interface ReviewFlow {
  readonly phase: ReviewPhase;
  readonly stepId: string | null;
  readonly prepared: Prepared | null;
  readonly security: SecurityReport | null;
  readonly failure: TxFailure | null;
  /** Quote refreshes in this session (0 on the first quote). */
  readonly refreshes: number;
  readonly lastTx: `0x${string}` | null;
  readonly connected: boolean;
  readonly walletKind: "browser" | "passkey" | null;
  quote(stepId: string, confirmed: boolean): Promise<void>;
  sign(stepId: string, confirmed: boolean): Promise<void>;
  retry(stepId: string, confirmed: boolean): Promise<void>;
  connect(): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useReviewFlow(intentId: string | null, network: string): ReviewFlow {
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const qc = useQueryClient();
  const [phase, setPhase] = useState<ReviewPhase>("idle");
  const [stepId, setStepId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [security, setSecurity] = useState<SecurityReport | null>(null);
  const [failure, setFailure] = useState<TxFailure | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);
  // What the wallet sent per step: a retry resubmits it instead of signing again.
  const sentRef = useRef<Record<string, Sent>>({});
  const busy = useRef(false);
  const quotedOnce = useRef(false);
  // State belongs to one intent: callers key the modal by intent id, so a new plan starts clean.
  const effects = (): StepEffects => ({
      prepare: async (sid, confirmed) => {
        const response = await apiPost<PrepareStepResponse & { readonly security?: unknown }>(`/v1/intents/${encodeURIComponent(intentId!)}/steps/${encodeURIComponent(sid)}/prepare`, { confirm: confirmed });
        setSecurity((response.security as SecurityReport | undefined) ?? null);
        return response;
      },
      // The wallet re-reads its live chain itself (useLykiaWallet), so a switch mid-flow counts.
      ensureChain: (chainId) => wallet.ensureChain(chainId),
      send: (txs) => wallet.sendForSubmit(txs),
      submit: (sid, sent) => apiPost<SubmitStepResponse>(`/v1/intents/${encodeURIComponent(intentId!)}/steps/${encodeURIComponent(sid)}/submit`, sent),
      sleep,
      now: () => Date.now(),
    });

  const hooks = {
    onPhase: (p: FlowPhase) => setPhase(p),
    onPrepared: (p: Prepared) => {
      if (quotedOnce.current) setRefreshes((n) => n + 1);
      quotedOnce.current = true;
      setPrepared(p);
    },
    onSent: (sent: Sent, sid: string) => {
      sentRef.current[sid] = sent;
      setLastTx("hashes" in sent ? (sent.hashes[sent.hashes.length - 1] ?? null) : sent.userOpHash);
    },
  };

  const settle = (r: SubmitStepResponse) => {
    qc.setQueryData<CreateIntentResponse>(["intent", intentId], (old) => (old ? { ...old, outrun: r.outrun, intent: { ...old.intent, steps: old.intent.steps.map((s) => (s.id === r.step.id ? r.step : s)) } } : old));
    const refs = r.step.references;
    if (refs && refs.length > 0) setLastTx(refs[refs.length - 1]!);
  };

  const onError = (error: unknown) => {
    const blocked = reportFromError(error instanceof StepFlowError ? error.original : error);
    if (blocked) setSecurity(blocked);
    setFailure(error instanceof StepFlowError ? error.failure : { kind: "unknown", title: "The step did not go through", detail: String(error), retry: "sign-again", retryLabel: "Try again", sent: false, raw: String(error) });
    setPhase("failed");
  };

  const quote = async (sid: string, confirmed: boolean) => {
    if (!intentId || busy.current) return;
    busy.current = true;
    setStepId(sid);
    setFailure(null);
    try {
      await quoteStep(effects(), sid, confirmed, hooks);
    } catch (error) {
      onError(error);
    } finally {
      busy.current = false;
    }
  };

  const sign = async (sid: string, confirmed: boolean) => {
    if (!intentId || busy.current) return;
    if (!wallet.address) {
      openModal();
      return;
    }
    busy.current = true;
    setStepId(sid);
    setFailure(null);
    try {
      const result = await signStep(effects(), { stepId: sid, confirmed, prepared: stepId === sid ? prepared : null, sent: sentRef.current[sid] ?? null, network }, hooks);
      delete sentRef.current[sid];
      setPrepared(null);
      settle(result);
    } catch (error) {
      onError(error);
    } finally {
      busy.current = false;
    }
  };

  const retry = async (sid: string, confirmed: boolean) => {
    const kind = failure?.retry;
    if (kind === "switch-chain") {
      try {
        await wallet.switchToArc();
      } catch {
        /* the sign below reports the chain problem again */
      }
    }
    if (kind === "sign-again" || kind === "switch-chain" || kind === "confirm") {
      // A fresh quote: never sign the one that just failed.
      setPrepared(null);
      delete sentRef.current[sid];
    }
    return sign(sid, confirmed);
  };

  return { phase, stepId, prepared, security, failure, refreshes, lastTx, connected: Boolean(wallet.address), walletKind: wallet.kind, quote, sign, retry, connect: openModal };
}
