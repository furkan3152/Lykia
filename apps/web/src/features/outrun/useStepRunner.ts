import type { ArcEnvironment, Outrun } from "@lykia/core";
import { useCallback, useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";

import { apiPost, describeError } from "../../lib/api";
import type { PrepareStepResponse, SubmitStepResponse } from "../../lib/types";
import { chainFor } from "../../app/wallet/chains";

export type RunPhase = "idle" | "preparing" | "switching" | "signing" | "submitting" | "done" | "error";

export interface StepRun {
  readonly phase: RunPhase;
  readonly message: string | null;
  readonly hashes: readonly `0x${string}`[];
  readonly memo: string | null;
}

const IDLE: StepRun = { phase: "idle", message: null, hashes: [], memo: null };

/**
 * Prepare → sign in the wallet → submit hashes, for one step at a time.
 * The server never signs: it hands out unsigned transactions and later
 * verifies the receipts. Arc finality is deterministic, so a receipt is final.
 */
export function useStepRunner(intentId: string | null, environment: ArcEnvironment, onOutrun: (outrun: Outrun) => void) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [runs, setRuns] = useState<Readonly<Record<string, StepRun>>>({});

  const update = (stepId: string, patch: Partial<StepRun>) => setRuns((prev) => ({ ...prev, [stepId]: { ...(prev[stepId] ?? IDLE), ...patch } }));

  const run = useCallback(
    async (stepId: string, confirmed: boolean) => {
      if (!intentId) return;
      if (!address) {
        update(stepId, { phase: "error", message: "Connect a wallet first." });
        return;
      }
      try {
        update(stepId, { phase: "preparing", message: null });
        const prepared = await apiPost<PrepareStepResponse>(`/v1/intents/${encodeURIComponent(intentId)}/steps/${encodeURIComponent(stepId)}/prepare`, { confirmed });
        update(stepId, { memo: prepared.memo });
        const target = chainFor(environment);
        if (chainId !== target.id) {
          update(stepId, { phase: "switching" });
          await switchChainAsync({ chainId: target.id });
        }
        const hashes: `0x${string}`[] = [];
        for (const tx of prepared.transactions) {
          update(stepId, { phase: "signing", message: tx.label });
          const hash = await sendTransactionAsync({ chainId: tx.chainId, to: tx.to, data: tx.data, value: BigInt(tx.value) });
          hashes.push(hash);
          update(stepId, { hashes: [...hashes] });
        }
        update(stepId, { phase: "submitting", message: null });
        const submitted = await apiPost<SubmitStepResponse>(`/v1/intents/${encodeURIComponent(intentId)}/steps/${encodeURIComponent(stepId)}/submit`, { hashes });
        onOutrun(submitted.outrun);
        update(stepId, { phase: "done", message: null });
      } catch (error) {
        update(stepId, { phase: "error", message: describeError(error) });
      }
    },
    [intentId, address, chainId, environment, switchChainAsync, sendTransactionAsync, onOutrun],
  );

  return { runs, run, connected: Boolean(address), address: address ?? null };
}
