/** Lyko's look as app state: repaints PAL and bumps a version so canvases redraw. */
import { create } from "zustand";

import { readStorage, writeStorage } from "../app/state/storage";
import { applyLook, DEFAULT_LOOK, type LykoLook } from "./sprites";

const KEY = "lykia.look";

function stored(): LykoLook {
  try {
    const raw = readStorage(KEY);
    const v = raw ? (JSON.parse(raw) as LykoLook) : DEFAULT_LOOK;
    return { ...DEFAULT_LOOK, ...v, tag: String(v.tag ?? DEFAULT_LOOK.tag).slice(0, 12) };
  } catch {
    return DEFAULT_LOOK;
  }
}

interface LookState {
  readonly look: LykoLook;
  readonly version: number;
  setLook(look: LykoLook): void;
}

const initial = stored();
applyLook(initial);

export const useLook = create<LookState>()((set, get) => ({
  look: initial,
  version: 0,
  setLook: (look) => {
    const next = { ...look, tag: look.tag.toUpperCase().slice(0, 12) };
    applyLook(next);
    writeStorage(KEY, JSON.stringify(next));
    set({ look: next, version: get().version + 1 });
  },
}));

export function useLookVersion(): number {
  return useLook((s) => s.version);
}
