/**
 * Lykia's local state: the owner's Fence (persisted through the guarded
 * storage, never required), the last outrun, and the last whistle command
 * so Lyko and the deck can react to it.
 */
import { DEFAULT_FENCE, type CommandAction, type Fence } from "@lykia/core";
import { create } from "zustand";

import { readStorage, writeStorage } from "../app/state/storage";

const FENCE_KEY = "lykia.fence";
const LAST_OUTRUN_KEY = "lykia.lastOutrun";

function storedFence(): Fence {
  const raw = readStorage(FENCE_KEY);
  if (!raw) return DEFAULT_FENCE;
  try {
    const value = JSON.parse(raw) as Fence;
    return value && value.schema === "lykia.fence/v1" ? value : DEFAULT_FENCE;
  } catch {
    return DEFAULT_FENCE;
  }
}

export interface LastCommand {
  readonly action: CommandAction;
  readonly at: number;
}

interface LykiaState {
  readonly fence: Fence;
  readonly lastOutrun: string | null;
  readonly lastCommand: LastCommand | null;
  setFence(fence: Fence): void;
  setWhistle(on: boolean): void;
  setLastOutrun(id: string): void;
  issue(action: CommandAction): void;
}

export const useLykiaStore = create<LykiaState>()((set, get) => ({
  fence: storedFence(),
  lastOutrun: readStorage(LAST_OUTRUN_KEY),
  lastCommand: null,
  setFence: (fence) => {
    writeStorage(FENCE_KEY, JSON.stringify(fence));
    set({ fence });
  },
  setWhistle: (on) => {
    const current = get().fence;
    const next: Fence = { ...current, mode: on ? "whistle" : current.mode === "whistle" ? "live" : (current.mode ?? "live") };
    get().setFence(next);
  },
  setLastOutrun: (id) => {
    writeStorage(LAST_OUTRUN_KEY, id);
    set({ lastOutrun: id });
  },
  issue: (action) => set({ lastCommand: { action, at: Date.now() } }),
}));

export function whistleOn(fence: Fence): boolean {
  return fence.mode === "whistle";
}
