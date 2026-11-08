/**
 * The Autopilot signer: one Circle developer-controlled wallet (MPC) per
 * owner per network, an EOA so the LykiaAccount sees it as msg.sender of
 * agentExecute and agentTransfer. Circle holds the key; Lykia holds the
 * operator's entity secret, which lets it ask Circle to sign. Nothing here
 * decides what is signed: the service hands over only a transaction the
 * leash prepared, checked and simulated.
 */
import type { Address, ArcEnvironment, AutopilotSigner } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { createAgentWallet } from "../circle/wallets.js";
import { recordWallet } from "../circle/walletRegistry.js";
import { circleContractExecution, circleTransaction } from "../devflows/circleExec.js";
import { autopilotSigners, keyOf } from "./store.js";

/** The signer for `owner`, made at Circle the first time. */
export async function signerFor(ctx: AppContext, owner: Address, environment: ArcEnvironment): Promise<AutopilotSigner> {
  const key = keyOf(environment, owner);
  const known = (await autopilotSigners(ctx).get(key))?.value;
  if (known) return { provider: "circle", walletId: known.walletId, address: known.address, blockchain: known.blockchain, accountType: "EOA" };
  const { apiKey, entitySecret, walletSetId } = ctx.config.circle;
  if (!apiKey || !entitySecret) throw new LykiaHttpError("CIRCLE_NOT_CONFIGURED", 503, "Autopilot needs CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET on this server.");
  const wallet = await createAgentWallet(ctx.fetch, { apiKey, entitySecret, walletSetId }, { environment, refId: `autopilot:${owner.slice(0, 18)}`, name: "Lyko Autopilot", accountType: "EOA" }, ctx.clock.now());
  if (wallet.accountType !== "EOA") throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Circle made a ${wallet.accountType} wallet; Autopilot needs an EOA. Nothing was turned on.`);
  const address = wallet.address.toLowerCase() as Address;
  if (!/^0x[0-9a-f]{40}$/u.test(address) || address === owner.toLowerCase()) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Circle returned an unusable wallet address. Nothing was turned on.");
  // Bound to the owner, like every server wallet: only this owner's Autopilot uses it.
  await recordWallet(ctx, { walletId: wallet.id, creator: owner, address, environment, blockchain: wallet.blockchain });
  await autopilotSigners(ctx).put(key, { provider: "circle", walletId: wallet.id, address, blockchain: wallet.blockchain, accountType: "EOA", owner: owner.toLowerCase() as Address, environment, createdAt: new Date(ctx.clock.now()).toISOString() });
  return { provider: "circle", walletId: wallet.id, address, blockchain: wallet.blockchain, accountType: "EOA" };
}

/** Asks Circle to sign and broadcast exactly this call from the owner's Autopilot wallet. */
export async function signWithCircle(ctx: AppContext, signer: AutopilotSigner, tx: { readonly to: Address; readonly data: `0x${string}` }, refId: string): Promise<{ id: string; state: string }> {
  return circleContractExecution(ctx, { walletId: signer.walletId, contract: tx.to, callData: tx.data, refId });
}

export async function circleState(ctx: AppContext, id: string): Promise<{ state: string; txHash: string | null }> {
  return circleTransaction(ctx, id);
}

/** Circle states after which the transaction will never land. */
export const CIRCLE_DEAD = new Set(["FAILED", "DENIED", "CANCELLED"]);
