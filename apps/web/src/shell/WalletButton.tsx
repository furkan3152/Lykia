import { ConnectButton } from "@rainbow-me/rainbowkit";

/** RainbowKit's connect flow in a mosaic button. */
export default function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted) return <span className="m-btn m-btn--sm" aria-hidden="true">…</span>;
        if (!account || !chain)
          return (
            <button type="button" className="m-btn m-btn--sm" onClick={openConnectModal}>
              CONNECT
            </button>
          );
        if (chain.unsupported)
          return (
            <button type="button" className="m-btn m-btn--sm m-btn--ochre" onClick={openChainModal}>
              SWITCH TO ARC
            </button>
          );
        return (
          <button type="button" className="m-btn m-btn--sm" onClick={openAccountModal}>
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
