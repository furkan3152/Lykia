/** The ⌘K box's store and the line handler every composer shares. */
import { create } from "zustand";

import { navigate } from "../app/routes/history";
import { useAsk } from "../features/ask/store";
import { resolveInput, type Destination } from "../lib/commands";
import { runCommand } from "../lib/runCommand";
import { toast } from "../mosaic/toast";

interface PaletteState {
  readonly isOpen: boolean;
  readonly wag: number;
  open(): void;
  close(): void;
  wagTail(): void;
}

export const usePalette = create<PaletteState>()((set, get) => ({
  isOpen: false,
  wag: 0,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  wagTail: () => set({ wag: get().wag + 1 }),
}));

const DEST: Record<Destination, string> = { ask: "/app", flock: "/app/flock", move: "/app/move", pastures: "/app/pastures", orders: "/app/orders", settings: "/app/you", pack: "/app/pack", fence: "/app/fence", scent: "/app/scent", tag: "/app/tag", build: "/mint", league: "/league", landing: "/" };

/** Handles one submitted line from any composer. Returns true when it was not a question (already handled). */
export function handleLine(text: string): boolean {
  const r = resolveInput(text);
  switch (r.kind) {
    case "empty":
      return true;
    case "command":
      runCommand(r.action);
      return true;
    case "egg":
      toast.info(r.word.toUpperCase(), { description: r.line, from: "LYKO" });
      if (r.href) navigate(r.href);
      return true;
    case "page":
      navigate(DEST[r.destination]);
      return true;
    case "token":
      navigate(`/app/scent/${r.address}`);
      return true;
    case "agent":
      navigate(`/app/tag/${r.agentId}`);
      return true;
    case "sentence":
      useAsk.getState().begin(r.text);
      if (!window.location.pathname.startsWith("/app/ask") && window.location.pathname !== "/app") navigate("/app");
      return false;
  }
  return true;
}

