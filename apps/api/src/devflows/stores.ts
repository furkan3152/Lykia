/** Collections for the developer flow records. Keyed by id; every record names its developer. */
import type { Invoice, Payout, UnifiedAutomation } from "@lykia/core";
import type { AppContext } from "../context.js";
import { typedCollection } from "../platform/typed.js";
import type { StoredAgent } from "./agents.js";
import { listAll, type ListOptions, type StoredDoc } from "../store/types.js";

export const RECORD_TTL_MS = 400 * 86_400_000;

export const payouts = (ctx: AppContext) => typedCollection<Payout>(ctx, "business_payouts");
export const invoices = (ctx: AppContext) => typedCollection<Invoice>(ctx, "business_invoices");
export const automations = (ctx: AppContext) => typedCollection<UnifiedAutomation>(ctx, "business_automations");
export const apiAgents = (ctx: AppContext) => typedCollection<StoredAgent>(ctx, "business_agents");

/** Every record of a developer (newest first). */
export async function listOwned<T extends { readonly developer: string; readonly createdAt: string }>(col: { list(o?: ListOptions): Promise<Array<StoredDoc<T>>> }, developer: string, filter: (t: T) => boolean = () => true): Promise<T[]> {
  return (await listAll(col)).map((d) => d.value).filter((t) => t.developer === developer && filter(t)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
