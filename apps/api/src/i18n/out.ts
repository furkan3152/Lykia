/**
 * The last step before an answer leaves the API: any string that is exactly
 * a known phrase (a card label, a status word, a constant sentence read at
 * module load before any request had a language) is shown in the request's
 * language. Sentences built per request are already translated where they
 * are written (tx); identifiers, kinds, addresses and codes are left alone.
 */
import { tx, txKnown } from "@lykia/core";
import { currentLocale } from "./context.js";

const KEEP_KEYS = new Set(["id", "kind", "type", "event", "threadId", "code", "href", "url", "link", "address", "owner", "to", "from_", "token", "symbol", "tokens", "chain", "protocol", "venue_", "hash", "txHash", "tool", "role", "mode", "decision", "status", "tone", "icon", "action", "source", "environment", "data", "abi", "calldata", "sentence", "intent", "meant"]);

export function localizeOut<T>(value: T): T {
  if (currentLocale() === "en") return value;
  return walk(value, 0) as T;
}

function walk(v: unknown, depth: number): unknown {
  if (depth > 12) return v;
  if (typeof v === "string") return txKnown(v);
  if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = KEEP_KEYS.has(k) ? x : walk(x, depth + 1);
    return out;
  }
  return v;
}

/** Every "**Next:**" label in an answer, in the request's language (the reply the owner reads and the streamed text agree). */
export function nextLabel(text: string): string {
  if (currentLocale() === "en" || !text.includes("**Next:**")) return text;
  const label = tx("**Next:**");
  return label === "**Next:**" ? text : text.split("**Next:**").join(label);
}
