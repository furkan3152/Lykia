/**
 * One step, end to end, in the owner's wallet: prepare (unsigned calls +
 * binding) → switch to the Arc chain → send each call → submit the hashes.
 * The server never signs; Arc finality makes the receipt the settlement.
 */
import type { PrepareStepResponse, SubmitStepResponse } from "@lykia/core/api/intents";
import { useState } from "react";

import { apiPost, describeError } from "../../lib/api";
import { toast } from "../../mosaic";
import { useWallet } from "../wallet/store";
import { useLykiaWallet } from "../wallet/useLykiaWallet";

export type RunPhase = "idle" | "preparing" | "signing" | "submitting" | "done" | "error";

export function useStepRunner(intentId: string | null, onSettled?: (r: SubmitStepResponse) => void) {
  const wallet = useLykiaWallet();
  const address = wallet.address;
  const openModal = useWallet((s) => s.openModal);
  const [phase, setPhase] = useState<Record<string, RunPhase>>({});
  const [error, setError] = useState<string | null>(null);

  const run = async (stepId: string, confirmed: boolean) => {
    if (!intentId) return;
    if (!address) {
      openModal();
      return;
    }
    setError(null);
    try {
      setPhase((p) => ({ ...p, [stepId]: "preparing" }));
      const prepared = await apiPost<PrepareStepResponse>(`/v1/intents/${encodeURIComponent(intentId)}/steps/${encodeURIComponent(stepId)}/prepare`, { confirmed });
      setPhase((p) => ({ ...p, [stepId]: "signing" }));
      // A browser wallet sends each call; a passkey account sends them as one user operation.
      const sent = await wallet.sendForSubmit(prepared.transactions);
      setPhase((p) => ({ ...p, [stepId]: "submitting" }));
      const result = await apiPost<SubmitStepResponse>(`/v1/intents/${encodeURIComponent(intentId)}/steps/${encodeURIComponent(stepId)}/submit`, sent);
      setPhase((p) => ({ ...p, [stepId]: "done" }));
      toast.success("Step final on Arc", { description: result.step.summary, from: "LYKO" });
      onSettled?.(result);
    } catch (e) {
      const message = describeError(e);
      setError(message);
      setPhase((p) => ({ ...p, [stepId]: "error" }));
      toast.error("Step did not go through", { description: message, from: "LYKO" });
    }
  };
  return { run, phase, error, connected: Boolean(address), walletKind: wallet.kind };
}
