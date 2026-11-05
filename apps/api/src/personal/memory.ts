/**
 * Intent memory, per owner: remembered plans (with what actually moved),
 * contacts (manual and learned from confirmed, settled sends), derived
 * preferences and recurring patterns. Every item is visible, editable,
 * exportable and forgettable; retention follows the owner's profile.
 */
import {
  computePreferences,
  detectPatterns,
  normalizeName,
  summarizeMemory,
  validateContact,
  type Address,
  type Contact,
  type IntentGraph,
  type IntentOutcome,
  type IntentRecord,
  type MemorySnapshot,
  type PlanAction,
  type ResolvedStep,
} from "@lykia/core";
import type { ContactView, IntentView, MemoryExport, MemoryView, PreferenceItem } from "@lykia/core/api/memory";
import type { Preferences } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { randomHex } from "../platform/crypto.js";
import { typedCollection } from "../platform/typed.js";
import { getProfile } from "./profile.js";

const intents = (ctx: AppContext) => typedCollection<IntentRecord>(ctx, "memory_intents");
const contacts = (ctx: AppContext) => typedCollection<Contact>(ctx, "memory_contacts");
const index = (ctx: AppContext) => typedCollection<{ key: string }>(ctx, "memory_index");
const ignored = (ctx: AppContext) => typedCollection<{ ids: string[] }>(ctx, "memory_prefs_ignored");

export const contactView = (c: Contact): ContactView => ({ ...c, confirmed: c.origin === "manual" || c.confirmedSends > 0, learned: c.origin === "learned" });
export const intentView = (r: IntentRecord): IntentView => ({ ...r, text: r.source });

/** Learned preferences as rows: venue per step kind, typical amounts, slippage habit, destinations. */
function preferenceItems(p: Preferences): PreferenceItem[] {
  const out: PreferenceItem[] = [];
  for (const [verb, venue] of Object.entries(p.venues)) if (venue) out.push({ id: `pref_venue_${verb}`, key: `Usual venue for ${verb}`, value: venue, source: "learned from settled plans" });
  for (const [k, v] of Object.entries(p.typicalAmounts)) out.push({ id: `pref_amount_${k.replace(/[^a-zA-Z0-9]/gu, "_")}`, key: `Typical ${k.replace(":", " ")}`, value: v, source: "median of your plans" });
  if (p.slippageBps !== null) out.push({ id: "pref_slippage", key: "Slippage habit", value: `${p.slippageBps} bps`, source: "median of your swaps" });
  if (p.destinations.length) out.push({ id: "pref_destinations", key: "Bridge destinations", value: p.destinations.join(", "), source: "most used" });
  return out;
}

const key = (owner: string) => owner.toLowerCase();
const DAY = 86_400_000;

/** What each non-approve step moved, from the graph (inputs/outputs as decimal strings). */
function resolvedSteps(graph: IntentGraph, actions: readonly PlanAction[]): ResolvedStep[] {
  const sends = actions.filter((a): a is Extract<PlanAction, { verb: "send" }> => a.verb === "send");
  let sendIndex = 0;
  return graph.steps
    .filter((s) => s.kind !== "approve" && s.kind !== "attest")
    .map((s) => {
      const input = s.inputs[0];
      const output = s.outputs[0];
      const dec = (amount: string, decimals: number) => {
        const v = BigInt(amount);
        const scale = 10n ** BigInt(decimals);
        const frac = (v % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
        return `${v / scale}${frac ? `.${frac}` : ""}`;
      };
      const recipient = s.kind === "transfer" ? sends[sendIndex++]?.to : undefined;
      return {
        verb: s.kind,
        venue: s.venue,
        ...(input ? { tokenIn: input.symbol, amountIn: dec(input.amount, input.decimals) } : {}),
        ...(output ? { tokenOut: output.symbol, amountOut: dec(output.amount, output.decimals) } : {}),
        ...(recipient ? { recipient } : {}),
      };
    });
}

function outcomeOf(graph: IntentGraph): IntentOutcome {
  if (graph.verdict.decision === "deny") return "denied";
  const st = graph.steps.map((s) => s.status);
  if (st.length > 0 && st.every((s) => s === "settled")) return "settled";
  if (st.some((s) => s === "failed")) return "failed";
  if (st.some((s) => s === "stopped")) return "stopped";
  return "planned";
}

class MemoryService {
  private wired = false;

  constructor(private readonly ctx: AppContext) {}

  /** Follows intent updates: outcomes, and contacts learned from settled sends. */
  wire(): void {
    if (this.wired) return;
    this.wired = true;
    this.ctx.bus.on("intent.updated", (payload) => {
      void this.onIntentUpdated(payload.intent).catch((error: unknown) => this.ctx.log.debug("memory update failed", { error: error instanceof Error ? error.message : String(error) }));
    });
  }

  async record(owner: Address, graph: IntentGraph, input: { source: string; actions: readonly PlanAction[] }): Promise<IntentRecord | null> {
    const profile = await getProfile(this.ctx, owner);
    if (!profile.memory.enabled) return null;
    const at = new Date(this.ctx.clock.now()).toISOString();
    const usd = graph.steps.reduce<number | null>((sum, s) => {
      if (sum === null || s.kind === "approve") return sum;
      const v = s.inputs[0]?.usd;
      return v === null || v === undefined ? (s.inputs.length === 0 ? sum : null) : sum + Number(v);
    }, 0);
    const record: IntentRecord = {
      id: `mem_${randomHex(6)}`,
      intentId: graph.id,
      at,
      environment: graph.environment,
      source: input.source.slice(0, 500),
      actions: input.actions,
      resolved: resolvedSteps(graph, input.actions),
      venues: [...new Set(graph.steps.map((s) => s.venue))],
      usd: usd === null ? null : usd.toFixed(2),
      outcome: outcomeOf(graph),
    };
    const ttlMs = profile.memory.retentionDays * DAY;
    const id = `${key(owner)}:${at}:${record.id}`;
    await intents(this.ctx).put(id, record, { ttlMs });
    await index(this.ctx).put(graph.id, { key: id }, { ttlMs });
    return record;
  }

  private async onIntentUpdated(graph: IntentGraph): Promise<void> {
    const ref = await index(this.ctx).get(graph.id);
    if (!ref) return;
    const doc = await intents(this.ctx).get(ref.value.key);
    if (!doc) return;
    const before = doc.value.outcome;
    const outcome = outcomeOf(graph);
    if (before === outcome) return;
    const next: IntentRecord = { ...doc.value, outcome, resolved: resolvedSteps(graph, doc.value.actions) };
    await intents(this.ctx).put(ref.value.key, next);
    if (outcome === "settled") await this.learnFrom(graph.owner, next);
  }

  /** A settled send the owner signed confirms the recipient: manual contacts gain trust, unknown ones are learned (if allowed). */
  private async learnFrom(owner: Address, record: IntentRecord): Promise<void> {
    const profile = await getProfile(this.ctx, owner);
    const list = await this.contacts(owner);
    for (const a of record.actions) {
      if (a.verb !== "send" || a.to.toLowerCase() === owner.toLowerCase()) continue;
      const existing = list.find((c) => c.address.toLowerCase() === a.to.toLowerCase());
      const now = new Date(this.ctx.clock.now()).toISOString();
      if (existing) await contacts(this.ctx).put(`${key(owner)}:${existing.id}`, { ...existing, confirmedSends: existing.confirmedSends + 1, lastUsedAt: now });
      else if (profile.memory.learnContacts) {
        const id = `ct_${randomHex(5)}`;
        const name = a.memo ? a.memo.replace(/[^\p{L}\p{N} .'-]/gu, "").slice(0, 40) || `${a.to.slice(0, 6)}…${a.to.slice(-4)}` : `${a.to.slice(0, 6)}…${a.to.slice(-4)}`;
        const contact: Contact = { id, name, aliases: [], address: a.to, origin: "learned", confirmedSends: 1, createdAt: now, lastUsedAt: now };
        await contacts(this.ctx).put(`${key(owner)}:${id}`, contact, { ttlMs: profile.memory.retentionDays * DAY });
        list.push(contact);
      }
    }
  }

  async intents(owner: Address, limit = 200): Promise<IntentRecord[]> {
    const docs = await intents(this.ctx).list({ prefix: `${key(owner)}:`, limit });
    return docs.map((d) => d.value).sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  async contacts(owner: Address): Promise<Contact[]> {
    return (await contacts(this.ctx).list({ prefix: `${key(owner)}:`, limit: 500 })).map((d) => d.value).sort((a, b) => a.name.localeCompare(b.name));
  }

  async snapshot(owner: Address): Promise<MemorySnapshot> {
    const [i, c] = await Promise.all([this.intents(owner), this.contacts(owner)]);
    return { intents: i, contacts: c };
  }

  /** Preferences minus the ones the owner deleted. */
  async preferences(owner: Address, intentsList?: readonly IntentRecord[]): Promise<Preferences> {
    const prefs = computePreferences(intentsList ?? (await this.intents(owner)));
    const doc = await ignored(this.ctx).get(key(owner));
    const skip = new Set(doc?.value.ids ?? []);
    if (skip.size === 0) return prefs;
    return {
      ...prefs,
      venues: Object.fromEntries(Object.entries(prefs.venues).filter(([v]) => !skip.has(`pref_venue_${v}`))),
      typicalAmounts: Object.fromEntries(Object.entries(prefs.typicalAmounts).filter(([k]) => !skip.has(`pref_amount_${k.replace(/[^a-zA-Z0-9]/gu, "_")}`))),
      slippageBps: skip.has("pref_slippage") ? null : prefs.slippageBps,
      destinations: skip.has("pref_destinations") ? [] : prefs.destinations,
    };
  }

  async view(owner: Address): Promise<MemoryView> {
    const profile = await getProfile(this.ctx, owner);
    const snap = await this.snapshot(owner);
    const learned = await this.preferences(owner, snap.intents);
    const patterns = detectPatterns(snap.intents);
    return {
      owner: key(owner),
      enabled: profile.memory.enabled,
      retentionDays: profile.memory.retentionDays,
      preferences: preferenceItems(learned),
      learned,
      suggestions: patterns.map((p, i) => ({ id: `sug_${i}`, sentence: p.text, cadence: p.kind, count: p.occurrences })),
      patterns,
      contacts: snap.contacts.map(contactView),
      recent: snap.intents.slice(0, 20).map(intentView),
      summary: summarizeMemory(snap, learned),
    };
  }

  async summary(owner: Address | null): Promise<string | null> {
    if (!owner) return null;
    const profile = await getProfile(this.ctx, owner);
    if (!profile.memory.enabled) return null;
    const snap = await this.snapshot(owner);
    if (snap.intents.length === 0 && snap.contacts.length === 0) return null;
    return summarizeMemory(snap, await this.preferences(owner, snap.intents));
  }

  async forgetItem(owner: Address, id: string): Promise<boolean> {
    if (id.startsWith("pref_")) {
      const doc = await ignored(this.ctx).get(key(owner));
      await ignored(this.ctx).put(key(owner), { ids: [...new Set([...(doc?.value.ids ?? []), id])] });
      return true;
    }
    if (id.startsWith("ct_")) return contacts(this.ctx).delete(`${key(owner)}:${id}`);
    const docs = await intents(this.ctx).list({ prefix: `${key(owner)}:`, limit: 1000 });
    const hit = docs.find((d) => d.value.id === id || d.value.intentId === id);
    if (!hit) return false;
    await index(this.ctx).delete(hit.value.intentId);
    return intents(this.ctx).delete(hit.id);
  }

  async forgetAll(owner: Address, what: "intents" | "contacts" | "all" = "all"): Promise<{ intents: number; contacts: number }> {
    let i = 0;
    let c = 0;
    if (what !== "contacts") for (const d of await intents(this.ctx).list({ prefix: `${key(owner)}:`, limit: 5000 })) { await index(this.ctx).delete(d.value.intentId); if (await intents(this.ctx).delete(d.id)) i += 1; }
    if (what !== "intents") for (const d of await contacts(this.ctx).list({ prefix: `${key(owner)}:`, limit: 5000 })) if (await contacts(this.ctx).delete(d.id)) c += 1;
    if (what === "all") await ignored(this.ctx).delete(key(owner));
    return { intents: i, contacts: c };
  }

  async export(owner: Address): Promise<MemoryExport> {
    const snap = await this.snapshot(owner);
    return { schema: "lykia.memory/v1", owner: key(owner), exportedAt: new Date(this.ctx.clock.now()).toISOString(), intents: snap.intents, contacts: snap.contacts };
  }

  async upsertContact(owner: Address, input: { id?: string; name: string; address: string; aliases?: string[]; note?: string }): Promise<Contact> {
    const issues = validateContact(input);
    if (issues.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, "The contact is invalid.", { issues });
    const list = await this.contacts(owner);
    const clash = list.find((c) => c.id !== input.id && (normalizeName(c.name) === normalizeName(input.name) || c.aliases.some((a) => normalizeName(a) === normalizeName(input.name))));
    if (clash) throw new LykiaHttpError("INVALID_REQUEST", 400, `Another contact is already called ${clash.name}.`);
    const existing = input.id ? list.find((c) => c.id === input.id) : list.find((c) => c.address.toLowerCase() === input.address.toLowerCase());
    if (input.id && !existing) throw new LykiaHttpError("NOT_FOUND", 404, "No such contact.");
    const now = new Date(this.ctx.clock.now()).toISOString();
    const sameAddress = existing && existing.address.toLowerCase() === input.address.toLowerCase();
    const contact: Contact = {
      id: existing?.id ?? `ct_${randomHex(5)}`,
      name: input.name.trim(),
      aliases: (input.aliases ?? existing?.aliases ?? []).map((a) => a.trim()).filter(Boolean),
      address: input.address as Address,
      origin: "manual",
      // Changing a contact's address resets trust: the next send confirms again.
      confirmedSends: sameAddress ? existing.confirmedSends : 0,
      ...(input.note ?? existing?.note ? { note: input.note ?? existing?.note } : {}),
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: existing?.lastUsedAt ?? null,
    };
    await contacts(this.ctx).put(`${key(owner)}:${contact.id}`, contact);
    return contact;
  }
}

const SERVICES = new WeakMap<AppContext, MemoryService>();

export function memoryService(ctx: AppContext): MemoryService {
  let s = SERVICES.get(ctx);
  if (!s) {
    s = new MemoryService(ctx);
    s.wire();
    SERVICES.set(ctx, s);
  }
  return s;
}
