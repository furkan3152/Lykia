/**
 * Passkey smart accounts (Circle Modular Wallets), loaded on demand so the
 * SDK never lands in the main bundle. The device passkey (Face ID, Touch ID,
 * Windows Hello) owns a Circle smart account on Arc; calls go out as user
 * operations through Circle's bundler. Only the WebAuthn credential's public
 * part is kept in storage to restore the account without a new prompt.
 */
import type { ArcEnvironment } from "@lykia/core";
import type { Hex } from "viem";

import { readStorage, removeStorage, writeStorage } from "../../app/state/storage";
import { chainFor } from "../../app/wallet/chains";
import { modularPath, type PasskeyConfig } from "./passkeyConfig";
import { t } from "../../i18n";

const CREDENTIAL_KEY = "lykia.passkey.credential";

export interface StoredCredential {
  readonly id: string;
  readonly publicKey: Hex;
  readonly rpId?: string;
  readonly username?: string;
}

export interface PasskeyCall {
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  readonly value: bigint;
}

export interface PasskeySession {
  readonly address: `0x${string}`;
  readonly environment: ArcEnvironment;
  readonly username: string | null;
  /** Sends the calls as one user operation and resolves once it lands on Arc. */
  sendCalls(calls: readonly PasskeyCall[]): Promise<{ readonly userOpHash: `0x${string}`; readonly transactionHash: `0x${string}` }>;
  signMessage(message: string): Promise<Hex>;
  signTypedData(typedData: Record<string, unknown>): Promise<Hex>;
}

export function storedCredential(): StoredCredential | null {
  const raw = readStorage(CREDENTIAL_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StoredCredential;
    return typeof v.id === "string" && typeof v.publicKey === "string" ? v : null;
  } catch {
    return null;
  }
}

export function forgetCredential(): void {
  removeStorage(CREDENTIAL_KEY);
}

/**
 * Registers a new passkey (`register`) or asks the device for an existing one
 * (`login`), or restores the stored credential (`restore`, no prompt), then
 * builds the smart account and bundler client for `environment`.
 */
export async function openPasskey(config: PasskeyConfig, environment: ArcEnvironment, mode: "register" | "login" | "restore", username?: string): Promise<PasskeySession> {
  const [sdk, aa, viem] = await Promise.all([import("@circle-fin/modular-wallets-core"), import("viem/account-abstraction"), import("viem")]);
  let credential: StoredCredential;
  if (mode === "restore") {
    const stored = storedCredential();
    if (!stored) throw new Error(t("wallet.passkey.noPasskeyOnThisDeviceYet"));
    credential = stored;
  } else {
    const passkeyTransport = sdk.toPasskeyTransport(config.clientUrl, config.clientKey);
    const fresh = await sdk.toWebAuthnCredential({
      transport: passkeyTransport as never,
      mode: mode === "register" ? sdk.WebAuthnMode.Register : sdk.WebAuthnMode.Login,
      ...(mode === "register" && username ? { username: username.trim() } : {}),
    });
    credential = { id: fresh.id, publicKey: fresh.publicKey as Hex, ...(fresh.rpId ? { rpId: fresh.rpId } : {}), ...(username ? { username: username.trim() } : {}) };
    writeStorage(CREDENTIAL_KEY, JSON.stringify(credential));
  }
  const chain = chainFor(environment);
  const transport = sdk.toModularTransport(`${config.clientUrl}/${modularPath(environment)}`, config.clientKey);
  const client = viem.createPublicClient({ chain, transport: transport as never });
  const owner = aa.toWebAuthnAccount({ credential: { id: credential.id, publicKey: credential.publicKey }, ...(credential.rpId ? { rpId: credential.rpId } : {}) } as never);
  const account = await sdk.toCircleSmartAccount({ client: client as never, owner: owner as never });
  const bundler = aa.createBundlerClient({ account: account as never, chain, transport: transport as never, client: client as never });
  return {
    address: account.address as `0x${string}`,
    environment,
    username: credential.username ?? null,
    async sendCalls(calls) {
      const hash = await bundler.sendUserOperation({ calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value })), paymaster: true } as never);
      const receipt = await bundler.waitForUserOperationReceipt({ hash });
      if (!receipt.success) throw new Error(t("wallet.passkey.theUserOperationRevertedOnArc"));
      return { userOpHash: hash as `0x${string}`, transactionHash: receipt.receipt.transactionHash as `0x${string}` };
    },
    signMessage: (message) => account.signMessage({ message }) as Promise<Hex>,
    signTypedData: (typedData) => account.signTypedData(typedData as never) as Promise<Hex>,
  };
}
