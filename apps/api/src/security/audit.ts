/**
 * The append-only, hash-chained audit log (layer 4). One chain per owner
 * (`owner:0x…`) and one for the platform (`platform`: halts, venue
 * switches). An entry is created with compare-and-set on its sequence
 * number, so two writers can never fork a chain; nothing in the API edits
 * or deletes entries.
 */
import { nextAuditEntry, verifyAuditChain, type AuditEntry, type AuditInput } from "@lykia/core/security/index";
import type { AppContext } from "../context.js";
import type { JsonValue } from "../store/types.js";

const ENTRIES = "security_audit";
const HEADS = "security_audit_head";
const pad = (n: number) => String(n).padStart(12, "0");

export function ownerChain(owner: string): string {
  return `owner:${owner.toLowerCase()}`;
}
export const PLATFORM_CHAIN = "platform";

async function auditAppend(ctx: AppContext, chain: string, input: AuditInput): Promise<AuditEntry> {
  const entries = ctx.store.collection<JsonValue>(ENTRIES);
  const heads = ctx.store.collection<JsonValue>(HEADS);
  for (let attempt = 0; attempt < 8; attempt++) {
    const head = (await heads.get(chain))?.value as unknown as { seq: number; hash: string } | undefined;
    const entry = nextAuditEntry(head ?? null, input, new Date(ctx.clock.now()).toISOString());
    const created = await entries.compareAndSet(`${chain}:${pad(entry.seq)}`, null, JSON.parse(JSON.stringify(entry)) as JsonValue);
    if (!created) continue;
    await heads.put(chain, { seq: entry.seq, hash: entry.hash });
    return entry;
  }
  throw new Error("The audit log is busy; try again.");
}

export async function auditRead(ctx: AppContext, chain: string, options: { readonly after?: number; readonly limit?: number } = {}): Promise<{ entries: AuditEntry[]; verified: { ok: boolean; brokenAt: number | null }; next: number | null }> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const docs = await ctx.store.collection<JsonValue>(ENTRIES).list({ prefix: `${chain}:`, ...(options.after ? { after: `${chain}:${pad(options.after)}` } : {}), limit });
  const entries = docs.map((d) => d.value as unknown as AuditEntry);
  return { entries, verified: verifyAuditChain(entries), next: entries.length === limit ? (entries[entries.length - 1]?.seq ?? null) : null };
}

/** Audit writes never break the flow they describe: a failure is logged, not thrown. */
export async function auditSafe(ctx: AppContext, chain: string, input: AuditInput): Promise<AuditEntry | null> {
  try {
    return await auditAppend(ctx, chain, input);
  } catch (error) {
    ctx.log.warn("security audit append failed", { chain, kind: input.kind, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
