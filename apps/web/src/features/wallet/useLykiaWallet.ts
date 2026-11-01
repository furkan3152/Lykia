/**
 * One wallet interface for every page, whichever way the owner came in:
 * a browser wallet (EIP-6963 / injected, through wagmi) or a passkey smart
 * account (Circle Modular Wallet, through user operations).
 */
import type { Hex } from "viem";
import { useAccount, useDisconnect, useSendTransaction, useSignMessage, useSignTypedData, useSwitchChain } from "wagmi";

import { useUiStore } from "../../app/state/uiStore";
import { chainFor } from "../../app/wallet/chains";
import { useWallet } from "./store";

export interface WalletTx {
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  readonly value: string | bigint;
  readonly chainId: number;
}

export interface LykiaWallet {
  readonly kind: "browser" | "passkey" | null;
  readonly address: `0x${string}` | undefined;
  readonly chainId: number | undefined;
  readonly connected: boolean;
  /** Browser wallets on another chain need a switch first. */
  readonly wrongChain: boolean;
  readonly label: string | null;
  /** Sends the calls in order; a passkey account sends them as one user operation (one hash). */
  send(txs: readonly WalletTx[]): Promise<`0x${string}`[]>;
  /** Sends a prepared plan step and returns what the API's submit expects: transaction hashes, or a user operation hash for passkey accounts. */
  sendForSubmit(txs: readonly WalletTx[]): Promise<{ readonly hashes: `0x${string}`[] } | { readonly userOpHash: `0x${string}` }>;
  signMessage(message: string): Promise<Hex>;
  signTypedData(typedData: Record<string, unknown>): Promise<Hex>;
  switchToArc(): Promise<void>;
  disconnect(): void;
}

export function useLykiaWallet(): LykiaWallet {
  const mode = useUiStore((s) => s.mode);
  const passkey = useWallet((s) => s.passkey);
  const disconnectPasskey = useWallet((s) => s.disconnectPasskey);
  const { address, chainId, connector } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { disconnect } = useDisconnect();
  const arc = chainFor(mode);

  if (passkey) {
    const sendPasskey = (txs: readonly WalletTx[]) => {
      if (txs.some((t) => t.chainId !== chainFor(passkey.environment).id)) throw new Error(`This passkey wallet is on Arc ${passkey.environment}; switch the network toggle to match the plan.`);
      return passkey.sendCalls(txs.map((t) => ({ to: t.to, data: t.data, value: BigInt(t.value) })));
    };
    return {
      kind: "passkey",
      address: passkey.address,
      chainId: chainFor(passkey.environment).id,
      connected: true,
      wrongChain: false,
      label: passkey.username ? `Passkey · ${passkey.username}` : "Passkey wallet",
      async send(txs) {
        return [(await sendPasskey(txs)).transactionHash];
      },
      async sendForSubmit(txs) {
        return { userOpHash: (await sendPasskey(txs)).userOpHash };
      },
      signMessage: (m) => passkey.signMessage(m),
      signTypedData: (td) => passkey.signTypedData(td),
      switchToArc: async () => undefined,
      disconnect: disconnectPasskey,
    };
  }

  const sendBrowser = async (txs: readonly WalletTx[]) => {
    const hashes: `0x${string}`[] = [];
    let current = chainId;
    for (const tx of txs) {
      if (current !== tx.chainId) {
        await switchChainAsync({ chainId: tx.chainId });
        current = tx.chainId;
      }
      hashes.push(await sendTransactionAsync({ to: tx.to, data: tx.data, value: BigInt(tx.value), chainId: tx.chainId }));
    }
    return hashes;
  };
  return {
    kind: address ? "browser" : null,
    address,
    chainId,
    connected: Boolean(address),
    wrongChain: Boolean(address) && chainId !== arc.id,
    label: connector?.name ?? null,
    send: sendBrowser,
    sendForSubmit: async (txs) => ({ hashes: await sendBrowser(txs) }),
    signMessage: (message) => signMessageAsync({ message }),
    signTypedData: (td) => signTypedDataAsync(td as never),
    switchToArc: async () => {
      await switchChainAsync({ chainId: arc.id });
    },
    disconnect: () => disconnect(),
  };
}
