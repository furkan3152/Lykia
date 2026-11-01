/**
 * Arc's pulse, shared: the header strip, the lighthouse lamps in every scene
 * and the chat strip read it. The lamp flashes on each new block number.
 */
import { create } from "zustand";

import type { ArcPulse } from "./types";

interface PulseState {
  readonly pulse: ArcPulse | null;
  readonly source: "stream" | "api" | "rpc" | null;
  readonly lit: boolean;
  readonly blocks: number;
  receive(pulse: ArcPulse, source: "stream" | "api" | "rpc"): void;
  dim(): void;
}

export const usePulse = create<PulseState>()((set, get) => ({
  pulse: null,
  source: null,
  lit: false,
  blocks: 0,
  receive: (pulse, source) => {
    const prev = get().pulse;
    const fresh = !prev || prev.block !== pulse.block || prev.environment !== pulse.environment;
    set({ pulse, source, lit: fresh ? true : get().lit, blocks: fresh ? get().blocks + 1 : get().blocks });
  },
  dim: () => set({ lit: false }),
}));

export function useLamp(): boolean {
  return usePulse((s) => s.lit);
}
