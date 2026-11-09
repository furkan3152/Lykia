/**
 * Trails: the owner's timeline. Settled steps with their Arc Memo, the Fence
 * verdict and its digest, plans still running, failed and refused attempts,
 * the fees paid, orders, watches that fired and every proposal transition.
 */
import { deriveIntentStatus, formatUsdMicros, memoString, usdMicros, verdictTag, type Address, type IntentGraph } from "@lykia/core";
import type { FoldTrailEntry, FoldTrailsResponse } from "@lykia/core/api/fold";
import type { AppContext } from "../context.js";
import { alertsService } from "../alerts/service.js";
import { ordersService } from "../orders/service.js";
import type { JsonValue } from "../store/types.js";
import { listFeed } from "./proposals.js";

const SCAN_LIMIT = 1000;
const FEED_WORDS = { proposed: "Drafted by Lyko", approved: "Signing started", done: "Done", stopped: "Stopped" } as const;

/** The owner's intents (both networks), newest first. */
export async function ownerIntents(ctx: AppContext, owner: Address): Promise<IntentGraph[]> {
  const me = owner.toLowerCase();
  const docs = await ctx.store.collection<JsonValue>("intents").list({ limit: SCAN_LIMIT }).catch(() => []);
  const out: IntentGraph[] = [];
  for (const d of docs) {
    const graph = (d.value as unknown as { graph?: IntentGraph }).graph;
    if (graph && graph.owner.toLowerCase() === me) out.push(graph);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function memoOf(graph: IntentGraph, stepId: string): string | null {
  try {
    return memoString({ intentId: graph.id, stepId, verdict: verdictTag(graph.verdict.digest) });
  } catch {
    return null;
  }
}

function feeUsdOf(graph: IntentGraph, settledOnly: boolean): bigint {
  let sum = 0n;
  for (const s of graph.steps) {
    if (settledOnly && s.status !== "settled") continue;
    if (s.fee?.usd) {
      try {
        sum += usdMicros(s.fee.usd);
      } catch {
        /* unpriced fee */
      }
    }
  }
  return sum;
}

function trailsFromIntents(graphs: readonly IntentGraph[]): FoldTrailEntry[] {
  const out: FoldTrailEntry[] = [];
  for (const g of graphs) {
    const status = deriveIntentStatus(g);
    const verdict = { decision: g.verdict.decision, digest: g.verdict.digest };
    if (status === "denied") {
      out.push({ id: g.id, at: g.createdAt, kind: "refused", title: g.source.slice(0, 140), detail: g.verdict.reasons.filter((r) => r.decision === "deny").map((r) => r.message).join(" ") || "The Fence said no.", environment: g.environment, memo: null, verdict, transactions: [], feeUsd: null, link: `/app/outrun/${g.id}` });
      continue;
    }
    for (const s of g.steps) {
      if (s.status !== "settled") continue;
      const fee = s.fee?.usd ?? null;
      out.push({ id: `${g.id}:${s.id}`, at: s.settledAt ?? g.createdAt, kind: "settled", title: s.summary, detail: `${g.source.slice(0, 100)} · ${s.venue}`, environment: g.environment, memo: memoOf(g, s.id), verdict, transactions: [...(s.references ?? [])], feeUsd: fee, link: `/app/outrun/${g.id}` });
    }
    if (status === "failed") {
      const failed = g.steps.find((s) => s.status === "failed");
      out.push({ id: `${g.id}:failed`, at: g.createdAt, kind: "failed", title: g.source.slice(0, 140), detail: failed?.failure?.message ?? "A step failed.", environment: g.environment, memo: null, verdict, transactions: [...(failed?.references ?? [])], feeUsd: null, link: `/app/outrun/${g.id}` });
    } else if (status === "planned" || status === "running") {
      const settled = g.steps.filter((s) => s.status === "settled").length;
      out.push({ id: `${g.id}:open`, at: g.createdAt, kind: status, title: g.source.slice(0, 140), detail: `${settled} of ${g.steps.length} steps settled${g.steps.some((s) => s.status === "settling" && s.settlement.kind !== "receipt") ? " · a cross-chain leg is settling" : ""}`, environment: g.environment, memo: null, verdict, transactions: [], feeUsd: null, link: `/app/outrun/${g.id}` });
    }
  }
  return out;
}

export async function trailsFor(ctx: AppContext, owner: Address): Promise<FoldTrailsResponse> {
  const graphs = await ownerIntents(ctx, owner);
  const items = trailsFromIntents(graphs);
  for (const environment of ["mainnet", "testnet"] as const) {
    for (const o of await ordersService(ctx).list(environment, owner).catch(() => [])) {
      items.push({ id: o.hash, at: o.lastExecutedAt ?? o.createdAt, kind: "order", title: o.summary, detail: `${o.status} · ${o.executed} of ${o.order.executions} executed`, environment, memo: null, verdict: null, transactions: [], feeUsd: null, link: "/app/fold/herding" });
    }
  }
  for (const f of (await alertsService(ctx).inbox(owner).catch(() => [])).slice(0, 50)) {
    items.push({ id: f.id, at: f.at, kind: "alert", title: f.title, detail: f.body, environment: ctx.config.mode, memo: null, verdict: null, transactions: [], feeUsd: null, link: f.link ?? null });
  }
  for (const e of await listFeed(ctx, owner, 60)) {
    items.push({ id: e.id, at: e.at, kind: "proposal", title: e.title, detail: `${FEED_WORDS[e.status]}${e.note ? `: ${e.note}` : ""}`, environment: ctx.config.mode, memo: null, verdict: null, transactions: [], feeUsd: null, link: "/app/fold/herding" });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  const fees = graphs.reduce((sum, g) => sum + feeUsdOf(g, true), 0n);
  return {
    owner: owner.toLowerCase() as Address,
    items: items.slice(0, 300),
    totals: { settled: items.filter((i) => i.kind === "settled").length, failed: items.filter((i) => i.kind === "failed").length, refused: items.filter((i) => i.kind === "refused").length, feesUsd: formatUsdMicros(fees) },
  };
}
