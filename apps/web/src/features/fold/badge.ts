/** The Lyko badge on the Fold's bottom-bar tab: what Lyko on watch has not shown you yet. The Fold page keeps it current. */
import { create } from "zustand";

export const useFoldBadge = create<{ readonly count: number; set(count: number): void }>()((set) => ({
  count: 0,
  set: (count) => set({ count }),
}));
