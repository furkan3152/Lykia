/**
 * Execution from a Circle developer-controlled wallet the developer set up
 * (CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET on this server and the wallet's id
 * on the payout). Lykia hands Circle the exact batch calldata it prepared
 * and checked; Circle signs and broadcasts from the developer's own wallet.
 * The entity secret never leaves the server and is never logged.
 * https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-developer-transaction-contract-execution
 */
import { randomUUID } from "node:crypto";
import type { Address } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { circleFetch, upstreamReason } from "../circle/http.js";
import { entitySecretCiphertext } from "../circle/wallets.js";

const API = "https://api.circle.com/v1/w3s";

function creds(ctx: AppContext): { apiKey: string; entitySecret: string; walletSetId: string | null } {
  const { apiKey, entitySecret, walletSetId } = ctx.config.circle;
  if (!apiKey || !entitySecret) throw new LykiaHttpError("CIRCLE_NOT_CONFIGURED", 503, "Circle execution needs CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET on this server.");
  return { apiKey, entitySecret, walletSetId };
}

export function circleConfigured(ctx: AppContext): boolean {
  return Boolean(ctx.config.circle.apiKey && ctx.config.circle.entitySecret);
}

export async function circleContractExecution(ctx: AppContext, input: { readonly walletId: string; readonly contract: Address; readonly callData: `0x${string}`; readonly refId: string }): Promise<{ id: string; state: string }> {
  const c = creds(ctx);
  const body = {
    idempotencyKey: randomUUID(),
    walletId: input.walletId,
    contractAddress: input.contract,
    callData: input.callData,
    feeLevel: "MEDIUM",
    refId: input.refId.slice(0, 50),
    entitySecretCiphertext: await entitySecretCiphertext(ctx.fetch, c, ctx.clock.now()),
  };
  const response = await circleFetch(ctx.fetch, `${API}/developer/transactions/contractExecution`, { method: "POST", headers: { authorization: `Bearer ${c.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }, "Circle Wallets");
  const text = await response.text();
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Circle Wallets answered ${response.status}.`, { circle: upstreamReason(text) });
  const data = (JSON.parse(text) as { data?: { id?: string; state?: string } }).data ?? {};
  if (!data.id) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Circle returned no transaction id.");
  return { id: data.id, state: data.state ?? "INITIATED" };
}

export async function circleTransaction(ctx: AppContext, id: string): Promise<{ state: string; txHash: string | null }> {
  const c = creds(ctx);
  if (!/^[0-9a-f-]{36}$/u.test(id)) throw new LykiaHttpError("INVALID_REQUEST", 400, "Not a Circle transaction id.");
  const response = await circleFetch(ctx.fetch, `${API}/transactions/${id}`, { method: "GET", headers: { authorization: `Bearer ${c.apiKey}` }, signal: AbortSignal.timeout(10_000) }, "Circle Wallets");
  if (!response.ok) return { state: "UNKNOWN", txHash: null };
  const tx = ((await response.json()) as { data?: { transaction?: { state?: string; txHash?: string } } }).data?.transaction ?? {};
  return { state: tx.state ?? "UNKNOWN", txHash: tx.txHash ?? null };
}
