/**
 * Which signed-in address created which Circle developer-controlled wallet.
 *
 * Wallets made through this API live under the operator's Circle entity, so
 * the operator's entity secret can sign for every one of them. The registry
 * is what keeps one user's wallet out of another user's hands: a wallet id
 * is usable (payouts, execution, balances) only by the address that created
 * it, and only for the wallet address Circle returned at creation.
 *
 * Server-side Circle execution is opt-in (LYKIA_CIRCLE_SERVER_WALLETS=true
 * plus CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET).
 */
import type { ArcEnvironment } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "../platform/typed.js";

export interface CircleWalletRecord {
  readonly walletId: string;
  /** The signed-in address that created it (lowercase). */
  readonly creator: string;
  /** The wallet's own on-chain address (lowercase). */
  readonly address: string;
  readonly environment: ArcEnvironment;
  readonly blockchain: string;
  readonly createdAt: string;
}

const wallets = (ctx: AppContext) => typedCollection<CircleWalletRecord>(ctx, "circle_wallets");

export function serverWalletsEnabled(ctx: AppContext): boolean {
  return ctx.config.circle.serverWallets === true && Boolean(ctx.config.circle.apiKey && ctx.config.circle.entitySecret);
}

/** 403 unless the operator opted in; 503 when opted in but the credentials are missing. */
export function assertServerWallets(ctx: AppContext): void {
  if (ctx.config.circle.serverWallets !== true) throw new LykiaHttpError("CIRCLE_SERVER_WALLETS_OFF", 403, "Server-side Circle wallets are off on this server (opt in with LYKIA_CIRCLE_SERVER_WALLETS=true). Sign with your own wallet instead.");
  if (!ctx.config.circle.apiKey || !ctx.config.circle.entitySecret) throw new LykiaHttpError("CIRCLE_NOT_CONFIGURED", 503, "Circle wallets need CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET on this server.");
}

export async function recordWallet(ctx: AppContext, input: { walletId: string; creator: string; address: string; environment: ArcEnvironment; blockchain: string }): Promise<CircleWalletRecord> {
  const record: CircleWalletRecord = { walletId: input.walletId, creator: input.creator.toLowerCase(), address: input.address.toLowerCase(), environment: input.environment, blockchain: input.blockchain, createdAt: new Date(ctx.clock.now()).toISOString() };
  await wallets(ctx).put(input.walletId, record);
  return record;
}

/** The wallet, when `caller` created it; 404 otherwise (an id someone else owns reads as unknown). */
export async function ownedWallet(ctx: AppContext, walletId: string, caller: string): Promise<CircleWalletRecord> {
  const doc = /^[0-9a-f-]{36}$/u.test(walletId) ? await wallets(ctx).get(walletId) : null;
  if (!doc || doc.value.creator !== caller.toLowerCase()) throw new LykiaHttpError("NOT_FOUND", 404, "No Circle wallet with that id belongs to you.");
  return doc.value;
}
