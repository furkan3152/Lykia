/**
 * Whether a wallet is connected, for the shell. The wallet stack (wagmi,
 * passkeys) loads only on app pages; the header reads this flag instead, so
 * the network switch shows only to someone with a wallet (or on testnet).
 */
import { create } from "zustand";

export const useWalletPresence = create<{ readonly connected: boolean; set(connected: boolean): void }>((set) => ({
  connected: false,
  set: (connected) => set({ connected }),
}));
