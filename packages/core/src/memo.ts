/**
 * Arc Memo encoding. Every value-moving step Lykia prepares is wrapped in
 * `Memo.memo(target, data, memoId, memoData)` (Arc's predeployed Memo
 * contract keeps the signer as msg.sender through the CallFrom precompile).
 *
 *   memoId   = keccak256("lykia:1:<intentId>:<stepId>")       indexed, for lookups
 *   memoData = UTF-8 "lykia:1:<intentId>:<stepId>:<verdict16>[|<note>]"
 *
 * `verdict16` is the first 16 hex characters of the Fence verdict digest,
 * so anyone reading the explorer can match a transfer to the verdict that
 * allowed it. The optional note carries a payment reference ("invoice 4411").
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export const MEMO_PREFIX = "lykia:1" as const;
export const MEMO_NOTE_MAX = 200;

export interface LykiaMemo {
  readonly intentId: string;
  readonly stepId: string;
  /** First 16 hex chars of the verdict digest (without the `sha256:` prefix). */
  readonly verdict: string;
  readonly note?: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/u;

export function memoString(memo: LykiaMemo): string {
  if (!ID.test(memo.intentId) || !ID.test(memo.stepId)) throw new Error("Memo ids must be 1-64 characters of A-Z, a-z, 0-9, _ or -.");
  if (!/^[0-9a-f]{16}$/u.test(memo.verdict)) throw new Error("Memo verdict must be 16 lower-case hex characters.");
  const note = memo.note === undefined ? "" : cleanNote(memo.note);
  return `${MEMO_PREFIX}:${memo.intentId}:${memo.stepId}:${memo.verdict}${note ? `|${note}` : ""}`;
}

/** Notes are single-line printable text, at most MEMO_NOTE_MAX characters. */
export function cleanNote(note: string): string {
  let out = "";
  for (const char of note) out += char === "|" || char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f ? " " : char;
  return out.replace(/\s+/gu, " ").trim().slice(0, MEMO_NOTE_MAX);
}

/** `sha256:abcd…` -> "abcd…" (16 chars). */
export function verdictTag(digest: string): string {
  return digest.replace(/^sha256:/u, "").slice(0, 16);
}

export function memoId(intentId: string, stepId: string): `0x${string}` {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(`${MEMO_PREFIX}:${intentId}:${stepId}`)))}`;
}

export function memoData(memo: LykiaMemo): `0x${string}` {
  return `0x${bytesToHex(utf8ToBytes(memoString(memo)))}`;
}

/** Parses memo bytes (hex) or a memo string; null when it is not a Lykia memo. */
export function decodeMemo(input: string): LykiaMemo | null {
  let text = input;
  if (/^0x[0-9a-fA-F]*$/u.test(input)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(input.slice(2)));
    } catch {
      return null;
    }
  }
  const [head, ...rest] = text.split("|");
  const match = /^lykia:1:([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64}):([0-9a-f]{16})$/u.exec(head ?? "");
  if (!match) return null;
  const note = rest.join("|");
  return { intentId: match[1] as string, stepId: match[2] as string, verdict: match[3] as string, ...(note ? { note } : {}) };
}

/** keccak256 of bytes or a UTF-8 string, 0x-prefixed. */
export function keccakHex(input: string | Uint8Array): `0x${string}` {
  return `0x${bytesToHex(keccak_256(typeof input === "string" ? utf8ToBytes(input) : input))}`;
}
