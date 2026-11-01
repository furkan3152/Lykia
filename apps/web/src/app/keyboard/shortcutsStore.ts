import { create } from "zustand";

export interface ShortcutsState {
  readonly open: boolean;
  setOpen(open: boolean): void;
}

/** The "?" shortcuts sheet, openable from the keyboard layer and from buttons. */
export const useShortcutsStore = create<ShortcutsState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
