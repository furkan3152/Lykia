/**
 * Circle developer-controlled wallets on Arc (needs CIRCLE_API_KEY and
 * CIRCLE_ENTITY_SECRET). Lykia provisions an agent wallet (SCA, so Gas
 * Station can sponsor it) for a Pack agent and tags it with the agent id.
 * The entity secret never leaves the server; each request carries a fresh
 * RSA-OAEP ciphertext made with Circle's published public key.
 * https://developers.circle.com/wallets/dev-controlled/entity-secret-management
 */
import { constants, publicEncrypt, randomUUID } from "node:crypto";
import type { ArcEnvironment } from "@lykia/core";
import type { FetchLike } from "../health/dependencies.js";
import { circleFetch } from "./http.js";
import { LykiaHttpError } from "../http/errors.js";

const API = "https://api.circle.com/v1/w3s";

export interface CircleCreds {
  readonly apiKey: string;
  readonly entitySecret: string;
  readonly walletSetId: string | null;
}

let publicKeyCache: { key: string; at: number } | null = null;

async function request(fetchImpl: FetchLike, apiKey: string, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Record<string, unknown>> {
  const response = await circleFetch(fetchImpl, `${API}${path}`, { method: init.method, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, ...(init.body ? { body: JSON.stringify(init.body) } : {}), signal: AbortSignal.timeout(10_000) }, "Circle Wallets");
  const text = await response.text();
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Circle Wallets answered ${response.status}.`, { circle: text.slice(0, 500) });
  const json = JSON.parse(text) as { data?: Record<string, unknown> };
  return json.data ?? {};
}

export async function entitySecretCiphertext(fetchImpl: FetchLike, creds: CircleCreds, now: number): Promise<string> {
  if (!/^[0-9a-fA-F]{64}$/u.test(creds.entitySecret)) throw new LykiaHttpError("INVALID_REQUEST", 500, "CIRCLE_ENTITY_SECRET must be 32 bytes of hex.");
  if (!publicKeyCache || now - publicKeyCache.at > 3_600_000) {
    const data = await request(fetchImpl, creds.apiKey, "/config/entity/publicKey", { method: "GET" });
    if (typeof data.publicKey !== "string") throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Circle returned no entity public key.");
    publicKeyCache = { key: data.publicKey, at: now };
  }
  return publicEncrypt({ key: publicKeyCache.key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(creds.entitySecret, "hex")).toString("base64");
}

/** For tests: forget the cached public key. */
export function resetWalletKeyCache(): void {
  publicKeyCache = null;
}

async function ensureWalletSet(fetchImpl: FetchLike, creds: CircleCreds, now: number): Promise<string> {
  if (creds.walletSetId) return creds.walletSetId;
  const data = await request(fetchImpl, creds.apiKey, "/developer/walletSets", { method: "POST", body: { idempotencyKey: randomUUID(), entitySecretCiphertext: await entitySecretCiphertext(fetchImpl, creds, now), name: "Lykia Pack" } });
  const set = data.walletSet as { id?: string } | undefined;
  if (!set?.id) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Circle created no wallet set.");
  return set.id;
}

export async function createAgentWallet(fetchImpl: FetchLike, creds: CircleCreds, input: { environment: ArcEnvironment; refId: string; name: string }, now: number): Promise<{ id: string; address: string; blockchain: string; accountType: string; walletSetId: string }> {
  const walletSetId = await ensureWalletSet(fetchImpl, creds, now);
  const blockchain = input.environment === "mainnet" ? "ARC" : "ARC-TESTNET";
  const data = await request(fetchImpl, creds.apiKey, "/developer/wallets", {
    method: "POST",
    body: { idempotencyKey: randomUUID(), entitySecretCiphertext: await entitySecretCiphertext(fetchImpl, creds, now), walletSetId, blockchains: [blockchain], count: 1, accountType: "SCA", metadata: [{ name: input.name.slice(0, 50), refId: input.refId.slice(0, 50) }] },
  });
  const wallet = (data.wallets as { id: string; address: string; blockchain: string; accountType: string }[] | undefined)?.[0];
  if (!wallet) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "Circle created no wallet.");
  return { id: wallet.id, address: wallet.address, blockchain: wallet.blockchain, accountType: wallet.accountType, walletSetId };
}

export async function walletBalances(fetchImpl: FetchLike, apiKey: string, walletId: string): Promise<unknown> {
  if (!/^[0-9a-f-]{36}$/u.test(walletId)) throw new LykiaHttpError("INVALID_REQUEST", 400, "Not a Circle wallet id.");
  return request(fetchImpl, apiKey, `/wallets/${walletId}/balances`, { method: "GET" });
}
