/**
 * Verdict verification. A verdict digest rides in every Arc Memo (its first
 * 16 hex characters) and in ERC-8354 attestations. Given the digest, Lykia
 * finds the stored plan, recomputes the verdict from the stored Fence and
 * facts with core's evaluateFence and says whether it matches. Anyone can
 * also send a Fence and facts and get the same recomputation.
 */
import { evaluateFence, fenceHash, type Fence, type FenceFacts, type FenceVerdict } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { services } from "../services.js";
import type { JsonValue } from "../store/types.js";
import { listAll } from "../store/types.js";

const INDEX_TTL_MS = 30 * 86_400_000;

export async function indexVerdict(ctx: AppContext, digest: string, intentId: string): Promise<void> {
  await ctx.store.collection<JsonValue>("verdict_index").put(digest, { intentId } as JsonValue, { ttlMs: INDEX_TTL_MS }).catch(() => undefined);
}

export interface VerdictCheck {
  readonly digest: string;
  readonly found: boolean;
  readonly match: boolean;
  readonly intentId: string | null;
  readonly decision: FenceVerdict["decision"] | null;
  readonly fenceHash: string | null;
  readonly factsDigest: string | null;
  readonly recomputed: string | null;
  readonly memoTag: string;
  readonly reasons: FenceVerdict["reasons"];
  readonly fence: Fence | null;
  readonly checkedAt: string;
}

/** Recomputes a verdict with the server's beta cap, and without it (the cap may have changed since). */
function recompute(ctx: AppContext, fence: Fence, facts: FenceFacts): FenceVerdict[] {
  const beta = ctx.config.beta;
  return beta ? [evaluateFence(fence, facts, { beta }), evaluateFence(fence, facts)] : [evaluateFence(fence, facts)];
}

async function locate(ctx: AppContext, digest: string): Promise<string | null> {
  const hit = (await ctx.store.collection<JsonValue>("verdict_index").get(digest))?.value as { intentId?: string } | undefined;
  if (hit?.intentId) return hit.intentId;
  // Fallback: recent stored intents.
  for (const doc of await listAll(ctx.store.collection<JsonValue>("intents"))) {
    const graph = (doc.value as { graph?: { verdict?: { digest?: string } } }).graph;
    if (graph?.verdict?.digest === digest) {
      await indexVerdict(ctx, digest, doc.id);
      return doc.id;
    }
  }
  return null;
}

export async function verifyVerdict(ctx: AppContext, digest: string): Promise<VerdictCheck> {
  const checkedAt = new Date(ctx.clock.now()).toISOString();
  const memoTag = digest.replace(/^sha256:/u, "").slice(0, 16);
  const intentId = await locate(ctx, digest);
  if (!intentId) return { digest, found: false, match: false, intentId: null, decision: null, fenceHash: null, factsDigest: null, recomputed: null, memoTag, reasons: [], fence: null, checkedAt };
  const { doc } = await services(ctx).intents.load(intentId);
  const results = recompute(ctx, doc.fence, doc.facts);
  const hit = results.find((v) => v.digest === digest) ?? results[0]!;
  return { digest, found: true, match: hit.digest === digest && fenceHash(doc.fence) === doc.graph.verdict.fenceHash, intentId, decision: hit.decision, fenceHash: hit.fenceHash, factsDigest: hit.factsDigest, recomputed: hit.digest, memoTag, reasons: hit.reasons, fence: doc.fence, checkedAt };
}

export function verifySupplied(ctx: AppContext, digest: string, fence: Fence, facts: FenceFacts): Pick<VerdictCheck, "digest" | "match" | "recomputed" | "decision" | "fenceHash" | "factsDigest" | "reasons"> {
  if (facts.now === undefined) throw new LykiaHttpError("INVALID_REQUEST", 400, "facts.now is part of the digest; send the original value.");
  const results = recompute(ctx, fence, facts);
  const hit = results.find((v) => v.digest === digest) ?? results[0]!;
  return { digest, match: hit.digest === digest, recomputed: hit.digest, decision: hit.decision, fenceHash: hit.fenceHash, factsDigest: hit.factsDigest, reasons: hit.reasons };
}
