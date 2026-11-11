/** The header's wallet control: connect (passkey or browser wallet), switch to Arc, or the connected account. */
import { shortAddress } from "@lykia/core";
import { useEffect, useRef, useState } from "react";

import { useUiStore } from "../app/state/uiStore";
import { useWalletPresence } from "../app/state/walletPresence";
import { ConnectModal } from "../features/wallet/ConnectModal";
import { canRestorePasskey, useWallet } from "../features/wallet/store";
import { useLykiaWallet } from "../features/wallet/useLykiaWallet";
import { toast } from "../mosaic";
import { classifyTxError } from "../features/route/txErrors";


export default function WalletButton() {
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const passkey = useWallet((s) => s.passkey);
  const connectPasskey = useWallet((s) => s.connectPasskey);
  const mode = useUiStore((s) => s.mode);
  const [menu, setMenu] = useState(false);
  const tried = useRef<string | null>(null);
  const present = useWalletPresence((s) => s.set);
  useEffect(() => present(Boolean(wallet.connected && wallet.address)), [present, wallet.connected, wallet.address]);

  // Restore a stored passkey account without a prompt, and follow the network toggle.
  useEffect(() => {
    if (wallet.kind === "browser" || !canRestorePasskey()) return;
    if (passkey && passkey.environment === mode) return;
    if (tried.current === mode) return;
    tried.current = mode;
    void connectPasskey(mode, "restore");
  }, [mode, passkey, wallet.kind, connectPasskey]);

  let control;
  if (!wallet.connected || !wallet.address) {
    control = (
      <button type="button" className="m-btn m-btn--sm" onClick={openModal}>
        CONNECT
      </button>
    );
  } else if (wallet.wrongChain) {
    control = (
      <button type="button" className="m-btn m-btn--sm m-btn--ochre" onClick={() => void wallet.switchToArc().catch((e: unknown) => toast.error("Could not switch", { description: classifyTxError(e, "chain").title, from: "LYKO" }))}>
        SWITCH TO ARC
      </button>
    );
  } else {
    control = (
      <div style={{ position: "relative" }}>
        <button type="button" className="m-btn m-btn--sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} title={wallet.label ?? undefined}>
          {wallet.kind === "passkey" ? "◉ " : ""}
          {shortAddress(wallet.address)}
        </button>
        {menu ? (
          <div role="menu" className="m-frame m-frame--thin m-walletmenu">
            <p className="m-small m-muted">{wallet.label}</p>
            <button type="button" role="menuitem" className="m-thread" onClick={() => { void navigator.clipboard?.writeText(wallet.address!); setMenu(false); toast.info("Address copied", { from: "LYKO" }); }}>
              COPY ADDRESS
            </button>
            <button type="button" role="menuitem" className="m-thread" onClick={() => { wallet.disconnect(); setMenu(false); }}>
              DISCONNECT
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <>
      {control}
      <ConnectModal />
    </>
  );
}
