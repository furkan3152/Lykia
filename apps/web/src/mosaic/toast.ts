/** Toasts as small mosaic tiles. A tiny store, no dependency. */
import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastItem {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description?: string;
  readonly from?: string;
}

interface ToastState {
  readonly items: readonly ToastItem[];
  push(item: Omit<ToastItem, "id"> & { id?: string }): void;
  dismiss(id: string): void;
}

let seq = 0;

export const useToasts = create<ToastState>()((set, get) => ({
  items: [],
  push: (item) => {
    const id = item.id ?? `t${(seq += 1)}`;
    set({ items: [...get().items.filter((t) => t.id !== id), { ...item, id }].slice(-4) });
    setTimeout(() => get().dismiss(id), item.tone === "error" ? 7000 : 4200);
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

type Opts = { description?: string; from?: string; id?: string };
const make = (tone: ToastTone) => (title: string, opts: Opts = {}) => useToasts.getState().push({ tone, title, ...opts });

export const toast = { info: make("info"), success: make("success"), warning: make("warning"), error: make("error") };
