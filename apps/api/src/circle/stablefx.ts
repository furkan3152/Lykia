/**
 * Circle StableFX taker flow (needs a Circle API key with StableFX access):
 * quote (reference or tradable) → the taker signs the quote's Permit2 typed
 * data in their wallet → create the trade → follow it to settlement in
 * FxEscrow on Arc. Lykia relays; it never signs and never invents a quote.
 * OpenAPI: https://developers.circle.com/openapi/stablefx.yaml
 */
import { randomUUID } from "node:crypto";
import type { FetchLike } from "../health/dependencies.js";
import { circleFetch } from "./http.js";
import { LykiaHttpError } from "../http/errors.js";

const BASE = "https://api.circle.com/v1/exchange/stablefx";

async function call(fetchImpl: FetchLike, apiKey: string, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
  const response = await circleFetch(fetchImpl, `${BASE}${path}`, {
    method: init.method,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(10_000),
  }, "StableFX");
  const text = await response.text();
  if (!response.ok) throw new LykiaHttpError(response.status === 401 || response.status === 403 ? "FORBIDDEN" : "UPSTREAM_UNAVAILABLE", response.status === 401 || response.status === 403 ? 403 : 502, `StableFX answered ${response.status}.`, { stablefx: text.slice(0, 500) });
  const json = JSON.parse(text) as { data?: unknown };
  return json.data ?? json;
}

export function stablefxQuote(fetchImpl: FetchLike, apiKey: string, input: { from: "USDC" | "EURC"; to: "USDC" | "EURC"; amount: string; side: "from" | "to"; type: "reference" | "tradable"; tenor: "instant" | "hourly" | "daily"; recipientAddress?: string }) {
  const body = {
    from: { currency: input.from, ...(input.side === "from" ? { amount: input.amount } : {}) },
    to: { currency: input.to, ...(input.side === "to" ? { amount: input.amount } : {}) },
    tenor: input.tenor,
    type: input.type,
    ...(input.recipientAddress ? { recipientAddress: input.recipientAddress } : {}),
  };
  return call(fetchImpl, apiKey, "/quotes", { method: "POST", body });
}

export function stablefxTrade(fetchImpl: FetchLike, apiKey: string, input: { quoteId: string; address: string; message: unknown; signature: string }) {
  return call(fetchImpl, apiKey, "/trades", { method: "POST", body: { idempotencyKey: randomUUID(), quoteId: input.quoteId, address: input.address, message: input.message, signature: input.signature } });
}

export function stablefxTradeStatus(fetchImpl: FetchLike, apiKey: string, tradeId: string) {
  if (!/^[A-Za-z0-9-]{8,64}$/u.test(tradeId)) throw new LykiaHttpError("INVALID_REQUEST", 400, "Not a trade id.");
  return call(fetchImpl, apiKey, `/trades/${tradeId}`, { method: "GET" });
}
