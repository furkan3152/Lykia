/**
 * Connection state that is not wagmi's: the passkey session (Circle Modular
 * Wallet) and the connect modal. Browser wallets stay in wagmi.
 */
import type { ArcEnvironment } from "@lykia/core";
import { create } from "zustand";

import { forgetCredential, openPasskey, storedCredential, type PasskeySession } from "./passkey";
import { passkeyConfig } from "./passkeyConfig";
import { t } from "../../i18n";

interface WalletState {
  readonly passkey: PasskeySession | null;
  readonly opening: boolean;
  readonly error: string | null;
  readonly modalOpen: boolean;
  openModal(): void;
  closeModal(): void;
  connectPasskey(environment: ArcEnvironment, mode: "register" | "login" | "restore", username?: string): Promise<boolean>;
  disconnectPasskey(): void;
}

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/NotAllowedError|aborted|cancel/i.test(text)) return t("wallet.store.thePasskeyPromptWasDismissed");
  if (/not supported|PublicKeyCredential/i.test(text)) return t("wallet.store.thisBrowserCannotUsePasskeysHere");
  return text.split("\n")[0]!.slice(0, 200);
}

export const useWallet = create<WalletState>()((set, get) => ({
  passkey: null,
  opening: false,
  error: null,
  modalOpen: false,
  openModal: () => set({ modalOpen: true, error: null }),
  closeModal: () => set({ modalOpen: false }),
  async connectPasskey(environment, mode, username) {
    const config = passkeyConfig();
    if (!config) {
      set({ error: "Passkey wallets are not configured on this deployment." });
      return false;
    }
    if (get().opening) return false;
    set({ opening: true, error: null });
    try {
      const passkey = await openPasskey(config, environment, mode, username);
      set({ passkey, opening: false, modalOpen: false });
      return true;
    } catch (e) {
      set({ opening: false, error: message(e) });
      return false;
    }
  },
  disconnectPasskey() {
    forgetCredential();
    set({ passkey: null });
  },
}));

/** True when a passkey credential is stored and the deployment is configured. */
export function canRestorePasskey(): boolean {
  return passkeyConfig() !== null && storedCredential() !== null;
}
