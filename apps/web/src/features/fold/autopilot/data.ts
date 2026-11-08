/** The owner's Autopilot (signed in), or the sample on the sample flock; and the one-tap Stop shared by the Fold and Ask Lyko. */
import type { AutopilotView, StopAutopilotResponse } from "@lykia/core/api/autopilot";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiGet, apiPost, describeError } from "../../../lib/api";
import { toast } from "../../../mosaic";
import { useLykiaWallet } from "../../wallet/useLykiaWallet";
import { useWallet } from "../../wallet/store";
import type { FoldOwner } from "../data";
import { sampleAutopilot } from "./model";

export function useAutopilot(o: FoldOwner) {
  const q = useQuery({
    queryKey: ["autopilot", o.address, o.environment, o.signedIn],
    enabled: Boolean(o.address && o.signedIn),
    refetchInterval: 30_000,
    queryFn: ({ signal }) => apiGet<AutopilotView>("/v1/autopilot", { query: { environment: o.environment }, signal, timeoutMs: 20_000 }),
  });
  const [now] = useState(() => Date.now());
  const sample = useMemo(() => (o.sample ? sampleAutopilot(now) : undefined), [o.sample, now]);
  return { ...q, data: q.data ?? sample };
}

/** Stop Autopilot: the server stops signing first, then the wallet is offered revokeSession. */
export function useStopAutopilot(environment: FoldOwner["environment"]) {
  const qc = useQueryClient();
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const [busy, setBusy] = useState(false);
  const stop = async (reason?: string) => {
    setBusy(true);
    let r: StopAutopilotResponse;
    try {
      r = await apiPost<StopAutopilotResponse>("/v1/autopilot/stop", { environment, ...(reason ? { reason } : {}) });
      await qc.invalidateQueries({ queryKey: ["autopilot"] });
      await qc.invalidateQueries({ queryKey: ["leashes"] });
      toast.success("Autopilot stopped", { description: r.transaction ? "Lyko signs nothing more. Sign revokeSession to end its session on chain too." : r.note, from: "LYKO" });
    } catch (e) {
      setBusy(false);
      toast.error("Not stopped: try again", { description: `${describeError(e)} The Whistle also stops it.`, from: "LYKO" });
      return null;
    }
    try {
      if (r.transaction) {
        if (!wallet.connected) openModal();
        else {
          const [hash] = await wallet.send([{ to: r.transaction.to, data: r.transaction.data, value: r.transaction.value, chainId: r.transaction.chainId }]);
          toast.success("Session ended on chain", { description: hash, from: "LYKO" });
        }
      }
    } catch (e) {
      toast.warning("Signing is off; the session is still on chain", { description: `${describeError(e)} Revoke it later from the leash card.`, from: "LYKO" });
    } finally {
      setBusy(false);
    }
    return r;
  };
  return { stop, busy };
}

/** Signs the Autopilot session once from the owner's wallet, then tells the leash which transaction it was. */
export function useSignSession() {
  const qc = useQueryClient();
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const [busy, setBusy] = useState(false);
  const sign = async (leashId: string, txs: readonly { readonly to: `0x${string}`; readonly data: `0x${string}`; readonly value: string; readonly chainId: number }[]): Promise<string | null> => {
    if (!wallet.connected) {
      openModal();
      return null;
    }
    setBusy(true);
    try {
      const hashes = await wallet.send(txs.map((x) => ({ to: x.to, data: x.data, value: x.value, chainId: x.chainId })));
      const last = hashes[hashes.length - 1] ?? null;
      if (last) await apiPost(`/v1/leashes/${encodeURIComponent(leashId)}/session`, { txHash: last }).catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ["autopilot"] });
      toast.success("Signed once", { description: "Autopilot goes on as soon as Arc includes it.", from: "LYKO" });
      return last;
    } catch (e) {
      toast.error("Not signed", { description: `${describeError(e)} Autopilot waits for this signature and signs nothing until then.`, from: "LYKO" });
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { sign, busy, connected: wallet.connected };
}
