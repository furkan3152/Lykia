/**
 * Layer 4, the audit log. Every plan verdict, prepare, submit, keeper
 * action and admin switch is appended as an entry whose hash covers the
 * previous entry's hash, so removing or editing any entry breaks every
 * hash after it. `verifyAuditChain` proves an exported log is intact.
 */
import { canonicalDigest } from "../canonical.js";

export const AUDIT_GENESIS = "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const;

export const AUDIT_KINDS = Object.freeze(["plan", "verdict", "prepare", "blocked", "submit", "keeper", "pause", "resume", "halt", "venue", "alert", "league", "proposal"] as const);
export type AuditKind = (typeof AUDIT_KINDS)[number];

export interface AuditInput {
  readonly kind: AuditKind;
  /** Who acted: an owner, an agent, `keeper` or an admin address. */
  readonly actor: string;
  /** What it is about: an intent id, a venue id, `platform`. */
  readonly subject: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface AuditEntry extends AuditInput {
  readonly seq: number;
  readonly at: string;
  readonly prev: string;
  readonly hash: string;
}

export function auditHash(entry: Omit<AuditEntry, "hash">): string {
  return canonicalDigest({ seq: entry.seq, at: entry.at, kind: entry.kind, actor: entry.actor, subject: entry.subject, data: entry.data, prev: entry.prev });
}

export function nextAuditEntry(previous: Pick<AuditEntry, "seq" | "hash"> | null, input: AuditInput, at: string): AuditEntry {
  const base = { ...input, seq: previous ? previous.seq + 1 : 1, at, prev: previous ? previous.hash : AUDIT_GENESIS };
  return { ...base, hash: auditHash(base) };
}

export function verifyAuditChain(entries: readonly AuditEntry[]): { readonly ok: boolean; readonly brokenAt: number | null } {
  let prev: string = entries[0] && entries[0].seq !== 1 ? entries[0].prev : AUDIT_GENESIS;
  let seq = entries[0] ? entries[0].seq - 1 : 0;
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (e.seq !== seq + 1 || e.prev !== prev || auditHash(rest) !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
    seq = e.seq;
  }
  return { ok: true, brokenAt: null };
}
