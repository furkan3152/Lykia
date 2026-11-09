/**
 * The Whistle, on the server. One call stops everything that could act for
 * the owner without a fresh signature:
 *
 *   automations (unified, and the standing orders behind them)
 *   standing orders and recurring payments
 *   agent automations
 *   Pack agents
 *   leashes (the key is refused at the gate until resumed)
 *   Autopilot (server signing pauses; nothing is signed until resumed)
 *
 * Each stopped thing is recorded, so the answer lists exactly what was
 * stopped and each one can be let go again on its own ("Resume"), or all of
 * them at once. Things that were already paused are left alone and are not
 * resumed later. When the owner has a LykiaAccount, the answer carries the
 * unsigned blowWhistle() so every on-chain session stops too (only homeward
 * calls pass there).
 */
import { encodeFunctionData, type Hex } from "viem";
import type { Address, ArcEnvironment, UnsignedTransaction } from "@lykia/core";
import type { WhistleItem, WhistleItemKind, WhistleResponse } from "@lykia/core/api/fold";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { agentServices } from "../agents/index.js";
import { listAutomations as listAgentAutomations, setAutomationEnabled } from "../agents/automations.js";
import { lykiaAccountFor } from "../agents/onchain.js";
import { autopilotService } from "../autopilot/service.js";
import type { StoredAutomation } from "../devflows/automations.js";
import { automations, RECORD_TTL_MS } from "../devflows/stores.js";
import { leashService } from "../leash/service.js";
import { typedCollection } from "../platform/typed.js";
import { services } from "../services.js";
import { listAll } from "../store/types.js";

const BLOW_WHISTLE_ABI = [{ type: "function", name: "blowWhistle", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const;
const KINDS: readonly WhistleItemKind[] = ["automation", "standing", "agent-automation", "agent", "leash", "autopilot", "alert"];

interface WhistleRecord {
  readonly owner: string;
  readonly blownAt: string | null;
  readonly items: readonly WhistleItem[];
}

const records = (ctx: AppContext) => typedCollection<WhistleRecord>(ctx, "whistles");

function counts(items: readonly WhistleItem[]): Record<WhistleItemKind, number> {
  const out = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<WhistleItemKind, number>;
  for (const i of items) if (i.state === "paused") out[i.kind] += 1;
  return out;
}

async function accountTransaction(ctx: AppContext, owner: Address, environment: ArcEnvironment): Promise<{ account: Address | null; transaction: UnsignedTransaction | null }> {
  const info = await lykiaAccountFor(ctx, owner, environment).catch(() => null);
  if (!info?.deployed) return { account: info?.address ?? null, transaction: null };
  return {
    account: info.address,
    transaction: { chainId: environment === "mainnet" ? 5042 : 5042002, from: owner, to: info.address, data: encodeFunctionData({ abi: BLOW_WHISTLE_ABI, functionName: "blowWhistle" }) as Hex, value: "0", label: "Blow the whistle on your LykiaAccount" },
  };
}

function view(owner: Address, record: WhistleRecord | null, tx: { account: Address | null; transaction: UnsignedTransaction | null }): WhistleResponse {
  const items = record?.items ?? [];
  const paused = items.filter((i) => i.state === "paused").length;
  return {
    owner: owner.toLowerCase() as Address,
    blownAt: record?.blownAt ?? null,
    items,
    transaction: tx.transaction,
    account: tx.account,
    counts: counts(items),
    note: paused === 0
      ? "Nothing is held by the Whistle."
      : tx.transaction
        ? `${paused} thing${paused === 1 ? " is" : "s are"} stopped on Lykia's side. Send the blowWhistle transaction too, so every on-chain session stops (homeward calls still pass).`
        : `${paused} thing${paused === 1 ? " is" : "s are"} stopped on Lykia's side. You have no LykiaAccount yet, so there is no on-chain session to stop.`,
  };
}

export async function whistleState(ctx: AppContext, owner: Address, environment: ArcEnvironment): Promise<WhistleResponse> {
  const record = (await records(ctx).get(owner.toLowerCase()))?.value ?? null;
  return view(owner, record, record && record.items.some((i) => i.state === "paused") ? await accountTransaction(ctx, owner, environment) : { account: null, transaction: null });
}

/** Stops everything that acts for the owner and records what it stopped. Blowing twice adds what started since. */
export async function blowWhistle(ctx: AppContext, owner: Address, environment: ArcEnvironment, reason?: string): Promise<WhistleResponse> {
  const me = owner.toLowerCase();
  const now = new Date(ctx.clock.now()).toISOString();
  const why = reason ? `The Whistle was blown: ${reason}` : "The Whistle was blown.";
  const prior = (await records(ctx).get(me))?.value ?? null;
  const items: WhistleItem[] = [...(prior?.items.filter((i) => i.state === "paused") ?? [])];
  const add = (kind: WhistleItemKind, id: string, label: string, env: ArcEnvironment | null) => {
    if (!items.some((i) => i.kind === kind && i.id === id)) items.push({ kind, id, label: label.slice(0, 160), environment: env, state: "paused" });
  };

  // Automations (unified); their standing orders pause with them.
  const unified = (await listAll(automations(ctx))).map((d) => d.value as StoredAutomation).filter((a) => a.owner.toLowerCase() === me && a.status === "active");
  const backed = new Set<string>();
  for (const a of unified) {
    if (a.backing.kind === "standing" && a.backing.id) {
      backed.add(a.backing.id);
      await services(ctx).standing.setStatus(a.backing.id, "paused").catch(() => undefined);
    }
    await automations(ctx).put(a.id, { ...a, status: "paused" }, { ttlMs: RECORD_TTL_MS });
    add("automation", a.id, a.name, a.environment);
  }
  // Standing orders and recurring payments not behind an automation.
  for (const o of await services(ctx).standing.list(owner).catch(() => [])) {
    if (o.status !== "active" || backed.has(o.id)) continue;
    await services(ctx).standing.setStatus(o.id, "paused");
    add("standing", o.id, o.text, o.environment);
  }
  // Agent automations.
  for (const a of await listAgentAutomations(ctx, owner)) {
    if (!a.enabled) continue;
    await setAutomationEnabled(ctx, owner, a.id, false);
    add("agent-automation", a.id, a.sentence, a.environment);
  }
  // Pack agents.
  const pack = agentServices(ctx).pack;
  for (const a of await pack.ownedBy(owner)) {
    if (a.status !== "active") continue;
    await pack.setStatus(a.id, owner, "paused");
    add("agent", a.id, a.name, a.environment);
  }
  // Leashes: the key is refused at the gate while the Whistle holds it. Autopilot's own leash pauses with Autopilot below.
  const autopilot = autopilotService(ctx);
  const pilots = (await Promise.all((["mainnet", "testnet"] as const).map((env) => autopilot.get(owner, env).catch(() => null)))).filter((ap) => ap !== null);
  const pilotLeashes = new Set(pilots.map((ap) => ap.leashId));
  const leashes = leashService(ctx);
  for (const l of await leashes.ownedBy(owner)) {
    if ((l.status !== "active" && l.status !== "pending") || l.paused || pilotLeashes.has(l.id)) continue;
    await leashes.put({ ...l, paused: { at: now, by: "whistle" } });
    add("leash", l.id, `${l.agentName} · leash`, l.environment);
  }
  // Autopilot: server signing pauses (resumable); a stop would revoke its leash for good.
  for (const ap of pilots) {
    if (ap.status !== "on") continue;
    await autopilot.pause(ap, "owner", why);
    add("autopilot", `autopilot:${ap.environment}`, `Autopilot on Arc ${ap.environment}`, ap.environment);
  }

  const record: WhistleRecord = { owner: me, blownAt: now, items };
  await records(ctx).put(me, record);
  void agentServices(ctx).webhooks.emit("whistle.blown", owner, { by: "owner", reason: reason ?? null, environment, stopped: items.length }).catch(() => undefined);
  return view(owner, record, await accountTransaction(ctx, owner, environment));
}

/** Lets one item (or every item when none is named) run again. Only what the Whistle stopped is resumed. */
export async function resumeWhistle(ctx: AppContext, owner: Address, environment: ArcEnvironment, which?: { readonly kind: WhistleItemKind; readonly id: string }): Promise<WhistleResponse> {
  const me = owner.toLowerCase();
  const record = (await records(ctx).get(me))?.value ?? null;
  if (!record) return view(owner, null, { account: null, transaction: null });
  const targets = record.items.filter((i) => i.state === "paused" && (!which || (i.kind === which.kind && i.id === which.id)));
  if (which && targets.length === 0) throw new LykiaHttpError("NOT_FOUND", 404, "The Whistle is not holding that.");
  for (const item of targets) await resumeOne(ctx, owner, item);
  const done = new Set(targets.map((t) => `${t.kind}:${t.id}`));
  const items = record.items.map((i) => (done.has(`${i.kind}:${i.id}`) ? { ...i, state: "resumed" as const } : i));
  const next: WhistleRecord = { owner: me, blownAt: items.some((i) => i.state === "paused") ? record.blownAt : null, items };
  await records(ctx).put(me, next);
  return view(owner, next, items.some((i) => i.state === "paused") ? await accountTransaction(ctx, owner, environment) : { account: null, transaction: null });
}

async function resumeOne(ctx: AppContext, owner: Address, item: WhistleItem): Promise<void> {
  switch (item.kind) {
    case "automation": {
      const doc = (await automations(ctx).get(item.id))?.value as StoredAutomation | undefined;
      if (!doc || doc.owner.toLowerCase() !== owner.toLowerCase()) return;
      if (doc.backing.kind === "standing" && doc.backing.id) await services(ctx).standing.setStatus(doc.backing.id, "active").catch(() => undefined);
      await automations(ctx).put(item.id, { ...doc, status: "active" }, { ttlMs: RECORD_TTL_MS });
      return;
    }
    case "standing":
      await services(ctx).standing.setStatus(item.id, "active").catch(() => undefined);
      return;
    case "agent-automation":
      await setAutomationEnabled(ctx, owner, item.id, true).catch(() => undefined);
      return;
    case "agent":
      await agentServices(ctx).pack.setStatus(item.id, owner, "active").catch(() => undefined);
      return;
    case "leash": {
      const leash = await leashService(ctx).get(item.id).catch(() => null);
      if (!leash || leash.owner.toLowerCase() !== owner.toLowerCase()) return;
      const { paused: _p, ...rest } = leash;
      await leashService(ctx).put(rest);
      return;
    }
    case "autopilot": {
      const env = item.id.split(":")[1] as ArcEnvironment;
      await autopilotService(ctx).resume(owner, env).catch(() => undefined);
      return;
    }
    case "alert":
      return;
  }
}
