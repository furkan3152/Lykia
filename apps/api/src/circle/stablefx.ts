/**
 * Circle StableFX taker flow (needs a Circle API key with StableFX access):
 * quote (reference or tradable) → the taker signs the quote's Permit2 typed
 * data in their wallet → create the trade → funding presign → the taker
 * signs the funding Permit2 data → fund (StableFX delivers the taker's side
 * on chain through Permit2) → follow it to settlement in FxEscrow on Arc.
 * Lykia relays; it never signs and never invents a quote. The taker must
 * have granted the token allowance to Permit2 first.
 * Base URLs: api.circle.com (mainnet) and api-sandbox.circle.com (testnet).
 * https://developers.circle.com/stablefx/quickstarts/fx-trade-taker
 * OpenAPI: https://developers.circle.com/openapi/stablefx.yaml
 */
import { randomUUID } from "node:crypto";
import type { ArcEnvironment } from "@lykia/core";
import type { FetchLike } from "../health/dependencies.js";
import { circleFetch } from "./http.js";
import { LykiaHttpError } from "../http/errors.js";

const STABLEFX_BASE: Readonly<Record<ArcEnvironment, string>> = {
  mainnet: "https://api.circle.com/v1/exchange/stablefx",
  testnet: "https://api-sandbox.circle.com/v1/exchange/stablefx",
};

async function call(fetchImpl: FetchLike, apiKey: string, environment: ArcEnvironment, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
  const response = await circleFetch(fetchImpl, `${STABLEFX_BASE[environment]}${path}`, {
    method: init.method,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(10_000),
  }, "StableFX");
  const text = await response.text();
  if (!response.ok) throw new LykiaHttpError(response.status === 401 || response.status === 403 ? "FORBIDDEN" : "UPSTREAM_UNAVAILABLE", response.status === 401 || response.status === 403 ? 403 : 502, `StableFX answered ${response.status}.`, { stablefx: text.slice(0, 500) });
  // The fund endpoint answers a blank 200.
  if (text.trim() === "") return {};
  const json = JSON.parse(text) as { data?: unknown };
  return json.data ?? json;
}

export function stablefxQuote(fetchImpl: FetchLike, apiKey: string, input: { from: "USDC" | "EURC"; to: "USDC" | "EURC"; amount: string; side: "from" | "to"; type: "reference" | "tradable"; tenor: "instant" | "hourly" | "daily"; recipientAddress?: string; environment?: ArcEnvironment }) {
  const body = {
    from: { currency: input.from, ...(input.side === "from" ? { amount: input.amount } : {}) },
    to: { currency: input.to, ...(input.side === "to" ? { amount: input.amount } : {}) },
    tenor: input.tenor,
    type: input.type,
    ...(input.recipientAddress ? { recipientAddress: input.recipientAddress } : {}),
  };
  return call(fetchImpl, apiKey, input.environment ?? "mainnet", "/quotes", { method: "POST", body });
}

export function stablefxTrade(fetchImpl: FetchLike, apiKey: string, input: { quoteId: string; address: string; message: unknown; signature: string; environment?: ArcEnvironment }) {
  return call(fetchImpl, apiKey, input.environment ?? "mainnet", "/trades", { method: "POST", body: { idempotencyKey: randomUUID(), quoteId: input.quoteId, address: input.address, message: input.message, signature: input.signature } });
}

export function stablefxTradeStatus(fetchImpl: FetchLike, apiKey: string, tradeId: string, environment: ArcEnvironment = "mainnet") {
  if (!/^[A-Za-z0-9-]{8,64}$/u.test(tradeId)) throw new LykiaHttpError("INVALID_REQUEST", 400, "Not a trade id.");
  return call(fetchImpl, apiKey, environment, `/trades/${tradeId}`, { method: "GET" });
}

/** Funding typed data for the taker to sign (POST /signatures/funding/presign with the trades' contractTradeIds). */
export function stablefxFundingPresign(fetchImpl: FetchLike, apiKey: string, input: { contractTradeIds: readonly string[]; environment?: ArcEnvironment }) {
  if (input.contractTradeIds.length === 0 || input.contractTradeIds.some((id) => !/^\d{1,78}$/u.test(id))) throw new LykiaHttpError("INVALID_REQUEST", 400, "contractTradeIds are the trades' numeric on-chain ids.");
  return call(fetchImpl, apiKey, input.environment ?? "mainnet", "/signatures/funding/presign", { method: "POST", body: { contractTradeIds: input.contractTradeIds, type: "taker" } });
}

/** Hands the signed funding Permit2 data to StableFX, which delivers the taker's side on chain (POST /fund; blank 200 on success). */
export function stablefxFund(fetchImpl: FetchLike, apiKey: string, input: { permit2: unknown; signature: string; environment?: ArcEnvironment }) {
  return call(fetchImpl, apiKey, input.environment ?? "mainnet", "/fund", { method: "POST", body: { type: "taker", signature: input.signature, permit2: input.permit2 } });
}
