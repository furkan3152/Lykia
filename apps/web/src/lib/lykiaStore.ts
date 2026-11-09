/**
 * Lykia's local state: a mirror of the owner's Fence as the server holds it
 * (GET /v1/me/fence once signed in; the Balanced preset before that), the
 * Whistle's night mode, the last outrun, and the last whistle command so
 * Lyko and the deck can react to it.
 *
 * The Fence is never kept in this browser any more. A Fence an older
 * version kept here (`lykia.fence`) is read once as `legacyFence`, so the
 * Fold can propose it to the owner one time; then it is forgotten.
 */
import { DEFAULT_FENCE, type CommandAction, type Fence } from "@lykia/core";
import { create } from "zustand";

import { readStorage, removeStorage, writeStorage } from "../app/state/storage";

const LEGACY_FENCE_KEY = "lykia.fence";
const WHISTLE_KEY = "lykia.whistle";
const LAST_OUTRUN_KEY = "lykia.lastOutrun";

function legacy(): Fence | null {
  const raw = readStorage(LEGACY_FENCE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Fence;
    return value && value.schema === "lykia.fence/v1" ? value : null;
  } catch {
    return null;
  }
}

export interface LastCommand {
  readonly action: CommandAction;
  readonly at: number;
}

interface LykiaState {
  /** The server's Fence for the signed-in owner, with the Whistle's night mode laid over it. */
  readonly fence: Fence;
  /** A Fence an older version kept in this browser; proposed to the owner once, then forgotten. */
  readonly legacyFence: Fence | null;
  readonly lastOutrun: string | null;
  readonly lastCommand: LastCommand | null;
  /** Mirrors the server's Fence (never persisted here). */
  setFence(fence: Fence): void;
  setWhistle(on: boolean): void;
  forgetLegacyFence(): void;
  setLastOutrun(id: string): void;
  issue(action: CommandAction): void;
}

const whistled = () => readStorage(WHISTLE_KEY) === "1" || legacy()?.mode === "whistle";
const overlay = (fence: Fence, whistle: boolean): Fence => ({ ...fence, mode: whistle ? "whistle" : fence.mode === "whistle" ? "live" : (fence.mode ?? "live") });

export const useLykiaStore = create<LykiaState>()((set, get) => ({
  fence: overlay(DEFAULT_FENCE, whistled()),
  legacyFence: legacy(),
  lastOutrun: readStorage(LAST_OUTRUN_KEY),
  lastCommand: null,
  setFence: (fence) => set({ fence: overlay(fence, get().fence.mode === "whistle") }),
  setWhistle: (on) => {
    writeStorage(WHISTLE_KEY, on ? "1" : "0");
    set({ fence: overlay(get().fence, on) });
  },
  forgetLegacyFence: () => {
    removeStorage(LEGACY_FENCE_KEY);
    set({ legacyFence: null });
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
