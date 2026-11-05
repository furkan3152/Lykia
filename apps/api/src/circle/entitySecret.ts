/**
 * Entity secret registration for Circle developer-controlled wallets, for
 * owners who only have a phone (no openssl or npx). Mirrors what Circle's
 * SDK `registerEntitySecretCiphertext` does (checked against
 * @circle-fin/developer-controlled-wallets 10.8.1):
 *   1. a 32-byte secret as 64 hex characters,
 *   2. GET /v1/w3s/config/entity/publicKey -> data.publicKey (PEM),
 *   3. RSA-OAEP with SHA-256 over the secret bytes -> base64 ciphertext,
 *   4. POST /v1/w3s/config/entity/entitySecret { entitySecretCiphertext }
 *      -> data.recoveryFile.
 * The secret and the recovery file are returned to the caller once and are
 * never logged or stored by Lykia. The owner then sets CIRCLE_ENTITY_SECRET
 * in the deployment's environment.
 */
import { constants, publicEncrypt, randomBytes } from "node:crypto";
import type { FetchLike } from "../health/dependencies.js";

const CIRCLE_API = "https://api.circle.com";

export class EntitySecretError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface RegisteredEntitySecret {
  readonly entitySecret: string;
  /** The recovery file content from Circle, base64-encoded so it can be saved from a phone. */
  readonly recoveryFile: string;
  readonly recoveryFileName: string;
}

function encryptEntitySecret(publicKeyPem: string, entitySecretHex: string): string {
  return publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(entitySecretHex, "hex")).toString("base64");
}

/** Circle's own error text (code + message), trimmed; never echoes headers or keys. */
async function circleReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    const parts = [body.code !== undefined ? `code ${String(body.code)}` : "", typeof body.message === "string" ? body.message : ""].filter(Boolean);
    return parts.length > 0 ? ` Circle says: ${parts.join(", ").replace(/(LIVE|TEST)_API_KEY:[^\s,]*/gu, "[key]").slice(0, 200)}.` : "";
  } catch {
    return "";
  }
}

function keyHint(status: number): string {
  if (status === 401) return " The key is not valid: copy the whole value including the LIVE_API_KEY: or TEST_API_KEY: prefix.";
  if (status === 403) return " The key is not allowed to use Wallets: give it Wallets permission (or use a Standard key), remove any IP allowlist (Vercel's addresses change), and for a LIVE key make sure Wallets is enabled for production in the Circle Console.";
  return "";
}

export async function registerEntitySecret(fetchImpl: FetchLike, apiKey: string, now: number): Promise<RegisteredEntitySecret> {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  const keyResponse = await fetchImpl(`${CIRCLE_API}/v1/w3s/config/entity/publicKey`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!keyResponse.ok) throw new EntitySecretError(502, `Circle did not return the entity public key (HTTP ${keyResponse.status}).${await circleReason(keyResponse)}${keyHint(keyResponse.status)}`);
  const publicKey = ((await keyResponse.json()) as { data?: { publicKey?: unknown } }).data?.publicKey;
  if (typeof publicKey !== "string" || !publicKey.includes("PUBLIC KEY")) throw new EntitySecretError(502, "Circle's entity public key response had no PEM key.");
  const entitySecret = randomBytes(32).toString("hex");
  const entitySecretCiphertext = encryptEntitySecret(publicKey, entitySecret);
  const registerResponse = await fetchImpl(`${CIRCLE_API}/v1/w3s/config/entity/entitySecret`, { method: "POST", headers, body: JSON.stringify({ entitySecretCiphertext }), signal: AbortSignal.timeout(15_000) });
  if (!registerResponse.ok) {
    const status = registerResponse.status;
    throw new EntitySecretError(status === 409 || status === 400 ? 409 : 502, status === 409 || status === 400 ? "Circle refused the registration: this entity probably has an entity secret already. Rotate it from the Circle Console with your recovery file." : `Circle did not register the entity secret (HTTP ${status}).${await circleReason(registerResponse)}${keyHint(status)}`);
  }
  const recovery = ((await registerResponse.json()) as { data?: { recoveryFile?: unknown } }).data?.recoveryFile;
  if (typeof recovery !== "string" || recovery.length === 0) throw new EntitySecretError(502, "Circle registered the secret but returned no recovery file. Contact Circle support before using it.");
  return { entitySecret, recoveryFile: Buffer.from(recovery, "utf8").toString("base64"), recoveryFileName: `recovery_file_${new Date(now).toISOString().replace(/[:.]/gu, "-")}.dat` };
}
