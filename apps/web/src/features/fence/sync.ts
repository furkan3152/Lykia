/**
 * Keeps the deck's mirror of the owner's Fence in step with the server
 * (GET /v1/me/fence). No wallet code here: the app shell mounts it on every
 * page, so it must stay light.
 */
import type { Fence, FoldRisk } from "@lykia/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiGet } from "../../lib/api";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useSession } from "../../lib/session";

export interface OwnerFenceView {
  readonly owner: string;
  readonly fence: Fence;
  readonly hash: string;
  readonly preset: FoldRisk;
  readonly presetLabel: string;
  readonly custom: boolean;
  readonly updatedAt: string | null;
  readonly migrated: boolean;
}

/** The signed-in owner's Fence; mirrored into the store so every surface shows the same one. */
export function useOwnerFence() {
  const session = useSession((s) => s.session);
  const setFence = useLykiaStore((s) => s.setFence);
  const q = useQuery({
    queryKey: ["me-fence", session?.address],
    enabled: Boolean(session),
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => apiGet<OwnerFenceView>("/v1/me/fence", { signal }),
  });
  useEffect(() => {
    if (q.data) setFence(q.data.fence);
  }, [q.data, setFence]);
  return q;
}

