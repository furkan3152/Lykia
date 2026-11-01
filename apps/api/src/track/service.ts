/**
 * Activity tracker: one feed of everything Lykia did or is doing for an owner.
 * It covers intents with their derived status and step progress, conditional
 * orders with live status, and alert firings. It reads only what Lykia stored.
 * On-chain history beyond that is on the explorer.
 */
import { deriveIntentStatus, networkFor, protocolsAt, tokenByAddress, type Address, type ArcEnvironment, type IntentGraph } from "@lykia/core";
import type { JsonValue } from "../store/types.js";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { alertsService } from "../alerts/service.js";
import { ordersService } from "../orders/service.js";

export interface ActivityItem {
  readonly type: "intent" | "order" | "alert";
  readonly id: string;
  readonly at: string;
  readonly title: string;
  readonly status: string;
  readonly detail: string;
  readonly link: string;
}

const SCAN_LIMIT = 1000;

export async function ownerActivity(ctx: AppContext, environment: ArcEnvironment, owner: Address): Promise<{ items: ActivityItem[]; counts: Record<string, number> }> {
  const me = owner.toLowerCase();
  const docs = await ctx.store.collection<JsonValue>("intents").list({ limit: SCAN_LIMIT });
  const intents: ActivityItem[] = [];
  for (const d of docs) {
    const graph = (d.value as unknown as { graph?: IntentGraph }).graph;
    if (!graph || graph.owner.toLowerCase() !== me || graph.environment !== environment) continue;
    const settled = graph.steps.filter((s) => s.status === "settled").length;
    intents.push({
      type: "intent",
      id: graph.id,
      at: graph.createdAt,
      title: graph.source.slice(0, 140),
      status: deriveIntentStatus(graph),
      detail: `${settled}/${graph.steps.length} steps settled`,
      link: `/intents/${graph.id}`,
    });
  }
  const orders = (await ordersService(ctx).list(environment, owner).catch(() => [])).map<ActivityItem>((o) => ({
    type: "order",
    id: o.hash,
    at: o.createdAt,
    title: o.summary,
    status: o.status,
    detail: o.waitingFor ? `Waiting for ${o.waitingFor}` : `${o.executed} of ${o.order.executions} executed`,
    link: "/orders",
  }));
  const alerts = (await alertsService(ctx).inbox(owner).catch(() => [])).slice(0, 50).map<ActivityItem>((f) => ({
    type: "alert",
    id: f.id,
    at: f.at,
    title: f.title,
    status: f.read ? "read" : "new",
    detail: f.body,
    link: f.link ?? "/alerts",
  }));
  const items = [...intents, ...orders, ...alerts].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 200);
  return { items, counts: { intents: intents.length, orders: orders.length, alerts: alerts.length } };
}

export interface TrackedTx {
  readonly environment: ArcEnvironment;
  readonly hash: `0x${string}`;
  readonly status: "pending" | "success" | "reverted" | "not-found";
  readonly block: string | null;
  readonly from: Address | null;
  readonly to: Address | null;
  readonly toLabel: string | null;
  readonly gasUsed: string | null;
  readonly logs: readonly { readonly emitter: Address; readonly label: string | null; readonly topic: string | null }[];
  readonly explorer: string;
}

/** What a contract address is, from the token and protocol registries. */
function labelOf(environment: ArcEnvironment, address: string): string | null {
  // Arc logs every native USDC movement from this system emitter (EIP-7708).
  if (address.toLowerCase() === "0xfffffffffffffffffffffffffffffffffffffffe") return "Arc system · native USDC transfer";
  const token = tokenByAddress(environment, address);
  if (token) return token.symbol;
  const hit = protocolsAt(address, environment)[0];
  return hit ? `${hit.protocol.name} · ${hit.name}` : null;
}

/**
 * Any Arc transaction: status, block, and each log's emitter labelled from the
 * registry. Arc is final in under a second, so a receipt is final; "pending"
 * means the node knows the transaction but has not included it yet.
 */
export async function trackTx(ctx: AppContext, environment: ArcEnvironment, hash: `0x${string}`): Promise<TrackedTx> {
  const client = ctx.chains.client(environment);
  const explorer = `${networkFor(environment).explorerUrl}/tx/${hash}`;
  const receipt = await Promise.resolve().then(() => client.getTransactionReceipt({ hash })).catch(() => null);
  if (!receipt) {
    const tx = await Promise.resolve().then(() => client.getTransaction({ hash })).catch(() => null);
    return { environment, hash, status: tx ? "pending" : "not-found", block: null, from: (tx?.from as Address) ?? null, to: (tx?.to as Address) ?? null, toLabel: tx?.to ? labelOf(environment, tx.to) : null, gasUsed: null, logs: [], explorer };
  }
  return {
    environment,
    hash,
    status: receipt.status === "success" ? "success" : "reverted",
    block: receipt.blockNumber.toString(),
    from: receipt.from as Address,
    to: (receipt.to as Address) ?? null,
    toLabel: receipt.to ? labelOf(environment, receipt.to) : null,
    gasUsed: receipt.gasUsed.toString(),
    logs: receipt.logs.slice(0, 50).map((l) => ({ emitter: l.address as Address, label: labelOf(environment, l.address), topic: l.topics[0] ?? null })),
    explorer,
  };
}

const WATCH_LIMIT = 50;

/** Addresses an owner follows (wallets, treasuries, agents), with a label each. */
export async function watchlist(ctx: AppContext, owner: Address): Promise<{ address: Address; label: string; addedAt: string }[]> {
  const doc = await ctx.store.collection<JsonValue>("watchlists").get(owner.toLowerCase());
  return ((doc?.value as unknown as { items?: { address: Address; label: string; addedAt: string }[] } | undefined)?.items ?? []);
}

export async function watchAdd(ctx: AppContext, owner: Address, address: Address, label: string): Promise<{ address: Address; label: string; addedAt: string }[]> {
  const items = (await watchlist(ctx, owner)).filter((i) => i.address.toLowerCase() !== address.toLowerCase());
  if (items.length >= WATCH_LIMIT) throw new LykiaHttpError("INVALID_REQUEST", 400, `At most ${WATCH_LIMIT} watched addresses.`);
  const next = [{ address, label: label.slice(0, 40), addedAt: new Date(ctx.clock.now()).toISOString() }, ...items];
  await ctx.store.collection<JsonValue>("watchlists").put(owner.toLowerCase(), { items: next } as unknown as JsonValue);
  return next;
}

export async function watchRemove(ctx: AppContext, owner: Address, address: string): Promise<boolean> {
  const items = await watchlist(ctx, owner);
  const next = items.filter((i) => i.address.toLowerCase() !== address.toLowerCase());
  if (next.length === items.length) return false;
  await ctx.store.collection<JsonValue>("watchlists").put(owner.toLowerCase(), { items: next } as unknown as JsonValue);
  return true;
}
