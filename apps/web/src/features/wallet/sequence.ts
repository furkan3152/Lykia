/**
 * Sending a step's calls from a browser wallet (pure, effects injected).
 */
import type { WalletTx } from "./useLykiaWallet";
import { t } from "../../i18n";

/**
 * Sends calls one after another, waiting for each receipt before the next:
 * the wallet estimates gas against the current state, so a venue call sent
 * before its approval lands is estimated as a revert. A reverted receipt
 * before the last call stops the sequence (the error says it ran on Arc);
 * the last call reverting is returned, so submit records the failed step.
 */
export async function sendSequentially(
  txs: readonly WalletTx[],
  effects: {
    readonly currentChainId: () => number | undefined;
    readonly switchChain: (chainId: number) => Promise<void>;
    readonly sendOne: (tx: WalletTx) => Promise<`0x${string}`>;
    readonly waitFor: (hash: `0x${string}`, chainId: number) => Promise<{ readonly status: "success" | "reverted" }>;
  },
): Promise<`0x${string}`[]> {
  const hashes: `0x${string}`[] = [];
  for (const tx of txs) {
    let hash: `0x${string}`;
    try {
      if (effects.currentChainId() !== tx.chainId) await effects.switchChain(tx.chainId);
      hash = await effects.sendOne(tx);
    } catch (error) {
      // Earlier calls (an approval) already landed: say so, so the owner is not told "nothing was sent".
      if (hashes.length > 0 && typeof error === "object" && error !== null) Object.assign(error, { partialHashes: [...hashes] });
      throw error;
    }
    hashes.push(hash);
    const receipt = await effects.waitFor(hash, tx.chainId);
    // The last call reverting is the step failing: submit records it. An earlier one stops the rest.
    if (receipt.status !== "success" && hashes.length < txs.length) throw Object.assign(new Error(t("wallet.sequence.executionRevertedRevertedOnArc", { value: tx.label ?? t("wallet.sequence.aCall") })), { hashes, onChain: true });
  }
  return hashes;
}
