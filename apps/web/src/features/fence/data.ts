/**
 * The owner's Fence, read from and written to the server (GET and PUT
 * /v1/me/fence). One control: picking a preset (Careful, Balanced, Bold) is
 * the same as Your Lyko's risk profile. Tightening applies at once; when the
 * server answers that a change loosens the Fence, the owner's wallet signs
 * the message it returned and the change is sent again with the signature.
 */
import { fenceHash, loosenedRules, type Fence, type FoldRisk } from "@lykia/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../../lib/apiErrors";
import { apiPost, apiPut } from "../../lib/api";
import type { OwnerFenceView } from "./sync";
import { useSession } from "../../lib/session";
import { useLykiaWallet } from "../wallet/useLykiaWallet";

/** Sends a Fence change; a loosening is signed by the owner's wallet first, with the message the server names. */
export function useFenceWrite() {
  const qc = useQueryClient();
  const wallet = useLykiaWallet();
  const session = useSession((s) => s.session);
  const send = async (body: { preset?: FoldRisk; fence?: Fence; migrated?: boolean }): Promise<OwnerFenceView> => {
    try {
      return await apiPut<OwnerFenceView>("/v1/me/fence", body);
    } catch (error) {
      const message = error instanceof ApiError && error.code === "FENCE_SIGNATURE_REQUIRED" ? error.details?.message : null;
      if (typeof message !== "string") throw error;
      const signature = await wallet.signMessage(message);
      return apiPut<OwnerFenceView>("/v1/me/fence", { ...body, signature });
    }
  };
  const done = (view: OwnerFenceView) => {
    qc.setQueryData(["me-fence", session?.address], view);
    for (const k of ["me-preferences", "fold-summary", "fold-insights"]) void qc.invalidateQueries({ queryKey: [k] });
  };
  const preset = useMutation({ mutationFn: (p: FoldRisk) => send({ preset: p }), onSuccess: done });
  const save = useMutation({ mutationFn: (input: { fence: Fence; migrated?: boolean }) => send(input), onSuccess: done });
  const settled = useMutation({ mutationFn: () => apiPost<OwnerFenceView>("/v1/me/fence/migrated", {}), onSuccess: done });
  return { preset, save, settled };
}

/** What a browser-held Fence from before would change: the lines it loosens, and whether it differs at all. */
export function legacyDiff(server: Fence, legacy: Fence): { readonly differs: boolean; readonly loosens: readonly string[] } {
  const strip = (f: Fence): Fence => ({ ...f, mode: f.mode === "whistle" ? "live" : (f.mode ?? "live"), label: "" });
  return { differs: fenceHash(strip(server)) !== fenceHash(strip(legacy)), loosens: loosenedRules(server, strip(legacy)) };
}
