import { ConnectButton } from "@rainbow-me/rainbowkit";

import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";

/**
 * The wallet control in Survey dress, on RainbowKit's ConnectButton.Custom:
 * connect, wrong network, or the connected Arc chain and account (the account
 * opens RainbowKit's account modal). Your key never leaves your wallet.
 */
export function WalletButton({ compact = false }: { readonly compact?: boolean }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal, authenticationStatus }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain;
        if (!ready) return <span aria-hidden="true" className="el-skeleton h-9 w-28 px-frame-thin" />;
        if (!connected) {
          return (
            <Button variant="ink" size="sm" onClick={openConnectModal} className="h-9">
              {compact ? "Connect" : "Connect wallet"}
            </Button>
          );
        }
        if (chain.unsupported) {
          return (
            <Button variant="danger" size="sm" onClick={openChainModal} className="h-9">
              Wrong network
            </Button>
          );
        }
        const mainnet = chain.id === 5042;
        return (
          <span className="inline-flex h-9 items-stretch gap-[2px] bg-rule px-frame-thin px-drop">
            {compact ? null : (
              <button
                type="button"
                onClick={openChainModal}
                title={`Network: ${chain.name ?? "unknown"}`}
                aria-label={`Network ${chain.name ?? ""}, change network`}
                className={cx("inline-flex items-center gap-1.5 bg-card px-2 font-tag text-[11px] uppercase hover:bg-paper-2", mainnet ? "text-summit-ink" : "text-warn-ink", FOCUS_RING)}
              >
                <span aria-hidden="true" className={cx("h-2 w-2", mainnet ? "bg-accent" : "bg-signal")} />
                <span className="hidden xl:inline">{mainnet ? "ARC" : "ARC TEST"}</span>
              </button>
            )}
            <button type="button" onClick={openAccountModal} aria-label={`Account ${account.address}`} className={cx("inline-flex items-center gap-2 bg-card px-2.5 font-mono text-xs text-ink hover:bg-paper-2", FOCUS_RING)}>
              <span aria-hidden="true" className="h-2 w-2 bg-up" />
              <span className="tnum">{account.displayName}</span>
            </button>
          </span>
        );
      }}
    </ConnectButton.Custom>
  );
}
