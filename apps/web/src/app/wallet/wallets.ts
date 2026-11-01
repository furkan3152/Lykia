/**
 * The wallet list shown by RainbowKit.
 *
 * With a valid WalletConnect project id: MetaMask, Rabby, Coinbase Wallet,
 * WalletConnect and any other injected wallet. Without one, only wallets that
 * work without WalletConnect are offered: MetaMask (browser extension only;
 * RainbowKit's MetaMask entry would otherwise fall back to a WalletConnect QR
 * that cannot open), Rabby, Coinbase Wallet (its own relay) and the generic
 * injected wallet. EIP-6963 wallets are discovered by wagmi either way.
 *
 * Coinbase is pinned to EOA mode so signatures (EIP-3009 payment
 * authorizations, typed data) are plain ECDSA, which every Arc verifier accepts.
 */
import type { Wallet, WalletList } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConnector } from "wagmi";
import { injected } from "wagmi/connectors";

coinbaseWallet.preference = "eoaOnly";

/** Discarded placeholder: RainbowKit's MetaMask entry builds a WalletConnect factory we never use. */
const UNUSED_PROJECT_ID = "0".repeat(32);

/** MetaMask through the injected provider only (no WalletConnect fallback). */
function injectedMetaMask(options: Parameters<typeof metaMaskWallet>[0]): Wallet {
  const details = metaMaskWallet({ ...options, projectId: options.projectId || UNUSED_PROJECT_ID });
  return {
    ...details,
    installed: details.installed === true,
    mobile: undefined,
    qrCode: undefined,
    createConnector: (walletDetails) =>
      createConnector((config) => ({
        ...injected({ target: "metaMask" })(config),
        ...walletDetails,
      })),
  };
}

export function walletList(projectId: string | null): WalletList {
  if (projectId) {
    return [
      { groupName: "Popular", wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet] },
      { groupName: "Other", wallets: [injectedWallet] },
    ];
  }
  return [
    { groupName: "Popular", wallets: [injectedMetaMask, rabbyWallet, coinbaseWallet] },
    { groupName: "Other", wallets: [injectedWallet] },
  ];
}
