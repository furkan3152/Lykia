/**
 * Canonical JSON and the digests built on it. Every hash Lykia compares
 * across processes (quote bindings, rule book hashes, journey digests) goes
 * through `canonicalJson`, so its rules are part of the wire contract:
 * object keys sorted by UTF-16 code unit, no whitespace, `undefined` members
 * dropped (`undefined` array slots become `null`), bigints as decimal
 * strings, and non-finite numbers refused.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export type Sha256Digest = `sha256:${string}`;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite numbers have no canonical JSON form.");
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : canonicalJson(entry))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

/** SHA-256 of bytes or a UTF-8 string, as lower-case hex without a prefix. */
export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256(typeof input === "string" ? utf8ToBytes(input) : input));
}

/** `sha256:` + hex of the canonical JSON of `value`. */
export function canonicalDigest(value: unknown): Sha256Digest {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

export function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}
