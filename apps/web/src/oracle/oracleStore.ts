import { create } from "zustand";

export interface OracleState {
  readonly open: boolean;
  /** Text the dialog opens with (an example prompt, a landing-page sentence). */
  readonly draft: string;
  /** True once opened: the router mounts the dialog chunk lazily on first use. */
  readonly everOpened: boolean;
  openOracle(draft?: string): void;
  closeOracle(): void;
  setDraft(draft: string): void;
}

/**
 * The command box (⌘K, "the whistle") is global: the keyboard layer, the top bar trigger, empty
 * states and example chips all open it through this store. The typed
 * sentence stays in memory only, never in storage.
 */
export const useOracleStore = create<OracleState>()((set) => ({
  open: false,
  draft: "",
  everOpened: false,
  openOracle: (draft) => set((state) => ({ open: true, everOpened: true, draft: draft ?? state.draft })),
  closeOracle: () => set({ open: false }),
  setDraft: (draft) => set({ draft }),
}));

export function openOracle(draft?: string): void {
  useOracleStore.getState().openOracle(draft);
}
