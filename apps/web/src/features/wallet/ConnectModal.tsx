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
import { t } from "../../i18n";

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
      // Plain words only: raw wallet and RPC messages stay out of the interface.
      setWalletError(/rejected|denied/i.test(text) ? t("wallet.connectModal.theWalletRequestWasRejected") : /already pending|pending request/i.test(text) ? t("wallet.connectModal.theWalletAlreadyHasARequest") : /not (found|installed)|no provider/i.test(text) ? t("wallet.connectModal.thatWalletWasNotFoundIn") : t("wallet.connectModal.theWalletCouldNotConnectTry"));
    }
  };

  return (
    <Modal open={open} onClose={close} title={t("wallet.connectModal.connectToLykia")}>
      <div className="m-connect">
        <section className="m-connect__opt" aria-labelledby="cx-passkey">
          <div className="m-connect__head">
            <LykoFace mood="proud" scale={1.4} label="" />
            <div>
              <h4 id="cx-passkey">{t("wallet.connectModal.passkeyWallet")}</h4>
              <p className="m-small m-muted">{t("wallet.connectModal.aCircleSmartAccountOnArc")}</p>
            </div>
          </div>
          {configured ? (
            <div className="m-connect__body">
              {stored ? (
                <button type="button" className="m-btn" disabled={opening} onClick={() => void connectPasskey(mode, "login")}>
                  {opening ? t("wallet.connectModal.waitingForYourDevice") : (stored.username ? t("wallet.connectModal.signInAs", { name: stored.username.toUpperCase() }) : t("wallet.connectModal.signInWithPasskey"))}
                </button>
              ) : null}
              <label className="m-connect__field">
                <span className="m-small m-muted">{stored ? t("wallet.connectModal.orCreateAnotherPasskey") : t("wallet.connectModal.nameYourPasskey")}</span>
                <input className="m-input" value={name} maxLength={40} placeholder={t("wallet.connectModal.eGTreasuryLaptop")} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(nameProblem)} />
              </label>
              {nameProblem ? <p className="m-note m-note--bad">{nameProblem}</p> : null}
              <div className="m-connect__row">
                <button type="button" className="m-btn m-btn--sea" disabled={opening || !name || Boolean(nameProblem)} onClick={() => void connectPasskey(mode, "register", name)}>
                  CREATE PASSKEY WALLET
                </button>
                {!stored ? (
                  <button type="button" className="m-btn m-btn--ghost" disabled={opening} onClick={() => void connectPasskey(mode, "login")}>
                    {t("wallet.connectModal.iHaveOne")}
                  </button>
                ) : null}
              </div>
              <p className="m-small m-muted">{t("wallet.connectModal.planStepsGoOutAsUser")} {mode}.</p>
            </div>
          ) : (
            <p className="m-note">{t("wallet.connectModal.notConfiguredOnThisDeploymentSet")}</p>
          )}
          {error ? <p className="m-note m-note--bad" role="alert">{error}</p> : null}
        </section>

        <section className="m-connect__opt" aria-labelledby="cx-browser">
          <div className="m-connect__head">
            <span className="m-connect__icon" aria-hidden="true">⌂</span>
            <div>
              <h4 id="cx-browser">{t("wallet.connectModal.browserWallet")}</h4>
              <p className="m-small m-muted">{t("wallet.connectModal.walletsInstalledInThisBrowserFound")}</p>
            </div>
          </div>
          {wallets.length > 0 ? (
            <ul className="m-connect__list">
              {wallets.map((w) => (
                <li key={w.id}>
                  <button type="button" className="m-connect__wallet" disabled={isPending} onClick={() => void connectBrowser(w.id)}>
                    {w.icon ? <img src={w.icon} alt="" width={28} height={28} /> : <span className="m-connect__icon" aria-hidden="true">◆</span>}
                    <span>{w.id === "injected" ? t("wallet.connectModal.browserWallet") : w.name}</span>
                    {isPending && variables?.connector && "id" in variables.connector && variables.connector.id === w.id ? <Tag tone="sea">{t("wallet.connectModal.opening")}</Tag> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-note">{t("wallet.connectModal.noBrowserWalletFoundInstallOne")}</p>
          )}
          {walletError ? <p className="m-note m-note--bad" role="alert">{walletError}</p> : null}
        </section>
      </div>
      <p className="m-small m-muted m-center" style={{ marginTop: 12 }}>{t("wallet.connectModal.lykiaNeverHoldsKeysEverythingYou")}</p>
    </Modal>
  );
}
