/**
 * The connect modal: a passkey smart account (Circle Modular Wallet) or a
 * browser wallet found through EIP-6963. No WalletConnect, no QR codes.
 */
import { useMemo, useState } from "react";
import { useConnect, useConnectors } from "wagmi";

import { useUiStore } from "../../app/state/uiStore";
import { LykoFace, Modal, Tag } from "../../mosaic";
import { passkeyConfig, usernameProblem } from "./passkeyConfig";
import { storedCredential } from "./passkey";
import { useWallet } from "./store";
import { browserWallets } from "./wallets";

export function ConnectModal() {
  const open = useWallet((s) => s.modalOpen);
  const close = useWallet((s) => s.closeModal);
  const opening = useWallet((s) => s.opening);
  const error = useWallet((s) => s.error);
  const connectPasskey = useWallet((s) => s.connectPasskey);
  const mode = useUiStore((s) => s.mode);
  const connectors = useConnectors();
  const { connectAsync, isPending, variables } = useConnect();
  const [name, setName] = useState("");
  const [walletError, setWalletError] = useState<string | null>(null);
  const configured = passkeyConfig() !== null;
  const stored = storedCredential();
  const hasInjected = typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum);
  const wallets = useMemo(() => browserWallets(connectors, hasInjected), [connectors, hasInjected]);
  const nameProblem = name ? usernameProblem(name) : null;

  const connectBrowser = async (id: string) => {
    setWalletError(null);
    const connector = connectors.find((c) => c.id === id);
    if (!connector) return;
    try {
      await connectAsync({ connector });
      close();
    } catch (e) {
      const text = e instanceof Error ? e.message.split("\n")[0]! : String(e);
      setWalletError(/rejected|denied/i.test(text) ? "The wallet request was rejected." : text);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Connect to Lykia">
      <div className="m-connect">
        <section className="m-connect__opt" aria-labelledby="cx-passkey">
          <div className="m-connect__head">
            <LykoFace mood="proud" scale={1.4} label="" />
            <div>
              <h4 id="cx-passkey">Passkey wallet</h4>
              <p className="m-small m-muted">A Circle smart account on Arc, unlocked with Face ID, Touch ID or Windows Hello. No extension, no seed phrase.</p>
            </div>
          </div>
          {configured ? (
            <div className="m-connect__body">
              {stored ? (
                <button type="button" className="m-btn" disabled={opening} onClick={() => void connectPasskey(mode, "login")}>
                  {opening ? "WAITING FOR YOUR DEVICE…" : `SIGN IN${stored.username ? ` AS ${stored.username.toUpperCase()}` : " WITH PASSKEY"}`}
                </button>
              ) : null}
              <label className="m-connect__field">
                <span className="m-small m-muted">{stored ? "Or create another passkey" : "Name your passkey"}</span>
                <input className="m-input" value={name} maxLength={40} placeholder="e.g. treasury-laptop" onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(nameProblem)} />
              </label>
              {nameProblem ? <p className="m-note m-note--bad">{nameProblem}</p> : null}
              <div className="m-connect__row">
                <button type="button" className="m-btn m-btn--sea" disabled={opening || !name || Boolean(nameProblem)} onClick={() => void connectPasskey(mode, "register", name)}>
                  CREATE PASSKEY WALLET
                </button>
                {!stored ? (
                  <button type="button" className="m-btn m-btn--ghost" disabled={opening} onClick={() => void connectPasskey(mode, "login")}>
                    I HAVE ONE
                  </button>
                ) : null}
              </div>
              <p className="m-small m-muted">Plan steps go out as user operations through Circle's bundler on Arc {mode}.</p>
            </div>
          ) : (
            <p className="m-note">Not configured on this deployment: set VITE_CIRCLE_CLIENT_KEY and VITE_CIRCLE_CLIENT_URL to offer passkey wallets.</p>
          )}
          {error ? <p className="m-note m-note--bad" role="alert">{error}</p> : null}
        </section>

        <section className="m-connect__opt" aria-labelledby="cx-browser">
          <div className="m-connect__head">
            <span className="m-connect__icon" aria-hidden="true">⌂</span>
            <div>
              <h4 id="cx-browser">Browser wallet</h4>
              <p className="m-small m-muted">Wallets installed in this browser, found automatically (EIP-6963).</p>
            </div>
          </div>
          {wallets.length > 0 ? (
            <ul className="m-connect__list">
              {wallets.map((w) => (
                <li key={w.id}>
                  <button type="button" className="m-connect__wallet" disabled={isPending} onClick={() => void connectBrowser(w.id)}>
                    {w.icon ? <img src={w.icon} alt="" width={28} height={28} /> : <span className="m-connect__icon" aria-hidden="true">◆</span>}
                    <span>{w.id === "injected" ? "Browser wallet" : w.name}</span>
                    {isPending && variables?.connector && "id" in variables.connector && variables.connector.id === w.id ? <Tag tone="sea">OPENING…</Tag> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-note">No browser wallet found. Install one (MetaMask, Rabby, OKX, Coinbase Wallet…) or use a passkey wallet.</p>
          )}
          {walletError ? <p className="m-note m-note--bad" role="alert">{walletError}</p> : null}
        </section>
      </div>
      <p className="m-small m-muted m-center" style={{ marginTop: 12 }}>Lykia never holds keys. Everything you sign is shown first.</p>
    </Modal>
  );
}
