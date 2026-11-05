/**
 * One automation API over Lykia's triggers. A unified automation has a
 * trigger (price, schedule, balance or a flow event) and an action
 * (plan an intent under the Fence, or notify the developer's webhooks).
 *
 *  - price or schedule + plan  -> a standing order (the existing engine
 *    plans it when it fires; /cron/standing drives it on Vercel)
 *  - everything else           -> Lykia's own evaluator (flow tick) or
 *    the flow event bus
 *
 * Standing orders, alerts, agent automations and LykiaOrders keep their
 * routes; GET /v1/automations?owner= lists them beside the unified ones and
 * pause/resume/delete work on them where that needs no signature.
 */
import {
  describeAutomationTrigger,
  describeAlert,
  describeTrigger,
  findToken,
  compareDecimalStrings,
  fromBaseUnits,
  nextScheduleRun,
  projectFence,
  tightenFence,
  tokenAddress,
  validateActions,
  validateAutomationTrigger,
  DEFAULT_FENCE,
  type Address,
  type ArcEnvironment,
  type AutomationAction,
  type AutomationListEntry,
  type AutomationTrigger,
  type Fence,
  type PlanAction,
  type StandingTrigger,
  type UnifiedAutomation,
} from "@lykia/core";
import { erc20Abi } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { listAutomations as listAgentAutomations, setAutomationEnabled } from "../agents/automations.js";
import { planActions, planSentence } from "../agents/engine.js";
import { alertsService } from "../alerts/service.js";
import { readSentence } from "../language/reader.js";
import { ordersService } from "../orders/service.js";
import { randomHex } from "../platform/crypto.js";
import { services } from "../services.js";
import { actsFor, assertActsFor, type FlowCaller } from "./access.js";
import { businessEvent, onBusinessEvent, type BusinessEvent } from "./events.js";
import { automations, listOwned, RECORD_TTL_MS } from "./stores.js";
import { lockedOr } from "../platform/requestState.js";

export type StoredAutomation = UnifiedAutomation & { readonly fence: Fence };

export interface AutomationInput {
  readonly owner: Address;
  readonly name: string;
  readonly environment?: ArcEnvironment;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly fence?: Fence;
  readonly maxFiresPerDay?: number;
}

function actionsOf(action: AutomationAction): PlanAction[] | null {
  if (action.type !== "plan") return null;
  if (action.actions) return [...action.actions];
  if (action.sentence) {
    const parsed = readSentence(action.sentence);
    if (parsed.clarify.length > 0 || parsed.actions.length === 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.clarify.join(" ") || parsed.reply, { clarify: parsed.clarify });
    return [...parsed.actions];
  }
  throw new LykiaHttpError("INVALID_REQUEST", 400, "A plan action needs actions or a sentence.");
}

function standingTrigger(trigger: AutomationTrigger): StandingTrigger | null {
  if (trigger.type === "price") return { kind: "price", feed: trigger.feed, op: trigger.op, value: trigger.value };
  if (trigger.type === "schedule") return { kind: "schedule", every: trigger.every, ...(trigger.weekday ? { weekday: trigger.weekday } : {}), ...(trigger.day ? { day: trigger.day } : {}), at: trigger.at, timezone: trigger.timezone };
  return null;
}

export async function createAutomation(ctx: AppContext, caller: FlowCaller, input: AutomationInput): Promise<StoredAutomation> {
  const issues = validateAutomationTrigger(input.trigger);
  if (issues.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `Invalid trigger: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, { issues });
  const environment = input.environment ?? lockedOr(caller.project?.network ?? ctx.config.mode);
  if (input.trigger.type === "balance" && !findToken(environment, input.trigger.token)) throw new LykiaHttpError("INVALID_REQUEST", 400, "trigger.token is not a registry token.");
  const actions = actionsOf(input.action);
  if (actions) {
    const actionIssues = validateActions(actions);
    if (actionIssues.length > 0) throw new LykiaHttpError("INVALID_ACTIONS", 400, "The plan actions are invalid.", { issues: actionIssues });
  }
  let fence = input.fence ?? (caller.project ? projectFence(caller.project) : DEFAULT_FENCE);
  if (caller.project) fence = tightenFence(fence, caller.project);
  const owner = input.owner.toLowerCase() as Address;
  const mine = await listOwned(automations(ctx), caller.developer);
  if (mine.length >= 100) throw new LykiaHttpError("CONFLICT", 409, "At most 100 automations per developer.");
  const st = standingTrigger(input.trigger);
  let backing: StoredAutomation["backing"] = { kind: "native", id: null };
  if (st && actions) {
    const order = await services(ctx).standing.create({ owner, environment, draft: { trigger: st, actions, text: input.name.slice(0, 500), maxFires: st.kind === "price" ? 1 : null }, fence });
    backing = { kind: "standing", id: order.id };
  }
  const automation: StoredAutomation = {
    schema: "lykia.automation/v1",
    id: `atm_${randomHex(6)}`,
    developer: caller.developer,
    owner,
    projectId: caller.project?.id ?? null,
    environment,
    name: input.name,
    trigger: input.trigger,
    action: actions ? { type: "plan", actions } : input.action,
    status: "active",
    backing,
    maxFiresPerDay: Math.min(Math.max(input.maxFiresPerDay ?? 1, 1), 24),
    fired: 0,
    lastFiredAt: null,
    lastIntentId: null,
    lastObservation: null,
    createdAt: new Date(ctx.clock.now()).toISOString(),
    fence,
  };
  await automations(ctx).put(automation.id, automation, { ttlMs: RECORD_TTL_MS });
  return automation;
}

async function loadOwn(ctx: AppContext, caller: FlowCaller, id: string): Promise<StoredAutomation> {
  const doc = (await automations(ctx).get(id))?.value as StoredAutomation | undefined;
  if (!doc || doc.developer !== caller.developer) throw new LykiaHttpError("NOT_FOUND", 404, "No such automation.");
  return doc;
}

export async function getAutomation(ctx: AppContext, caller: FlowCaller, id: string): Promise<StoredAutomation> {
  return loadOwn(ctx, caller, id);
}

/** pause | resume | delete, for unified ids and the older objects they list beside. */
export async function controlAutomation(ctx: AppContext, caller: FlowCaller, id: string, action: "pause" | "resume" | "delete", owner?: Address): Promise<unknown> {
  if (id.startsWith("atm_")) {
    const a = await loadOwn(ctx, caller, id);
    if (a.backing.kind === "standing" && a.backing.id) await services(ctx).standing.setStatus(a.backing.id, action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled").catch(() => undefined);
    if (action === "delete") {
      await automations(ctx).delete(id);
      return { deleted: true, id };
    }
    const next: StoredAutomation = { ...a, status: action === "pause" ? "paused" : "active" };
    await automations(ctx).put(id, next, { ttlMs: RECORD_TTL_MS });
    return next;
  }
  if (id.startsWith("so_")) {
    const order = await services(ctx).standing.get(id);
    assertActsFor(caller, order.owner);
    return services(ctx).standing.setStatus(id, action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled");
  }
  if (id.startsWith("al_")) {
    if (!owner) throw new LykiaHttpError("INVALID_REQUEST", 400, "Alerts need the owner (?owner=0x…).");
    assertActsFor(caller, owner);
    if (action === "delete") return { deleted: await alertsService(ctx).remove(owner, id), id };
    return alertsService(ctx).update(owner, id, { paused: action === "pause" });
  }
  if (/^0x[0-9a-f]{40}:aut_/u.test(id)) {
    const who = id.split(":")[0] as Address;
    assertActsFor(caller, who);
    if (action === "delete") return setAutomationEnabled(ctx, who, id, false);
    return setAutomationEnabled(ctx, who, id, action === "resume");
  }
  throw new LykiaHttpError("INVALID_REQUEST", 400, "LykiaOrders orders are cancelled with a signed transaction: GET /v1/orders/:hash/cancel-tx.");
}

/**
 * Everything else an owner has standing, read once for both listings
 * (GET /v1/automations and the Fold's Herding): standing orders, alerts,
 * agent automations and LykiaOrders orders on both networks. A failing
 * source reads as empty.
 */
export async function ownerInstructionSources(ctx: AppContext, owner: Address) {
  const [standing, alerts, agent, mainnetOrders, testnetOrders] = await Promise.all([
    services(ctx).standing.list(owner).catch(() => []),
    alertsService(ctx).list(owner).catch(() => []),
    listAgentAutomations(ctx, owner).catch(() => []),
    ordersService(ctx).list("mainnet", owner).catch(() => []),
    ordersService(ctx).list("testnet", owner).catch(() => []),
  ]);
  const orders = [...mainnetOrders.map((order) => ({ environment: "mainnet" as const, order })), ...testnetOrders.map((order) => ({ environment: "testnet" as const, order }))];
  return { standing, alerts, agent, orders };
}

/**
 * Unified automations, plus the owner's standing orders, alerts, agent
 * automations and orders when `owner` is given and the caller may act for
 * that owner (their own session, or a secret key). A session for another
 * address only sees its own unified automations.
 */
export async function listAllAutomations(ctx: AppContext, caller: FlowCaller, owner?: Address): Promise<{ automations: StoredAutomation[]; entries: AutomationListEntry[] }> {
  const mine = (await listOwned(automations(ctx), caller.developer)) as StoredAutomation[];
  const entries: AutomationListEntry[] = mine.map((a) => ({ id: a.id, source: "automation", name: a.name, trigger: describeAutomationTrigger(a.trigger), action: a.action.type === "plan" ? "plan intent" : "notify webhook", status: a.status, controllable: true }));
  if (owner && actsFor(caller, owner)) {
    const backed = new Set(mine.map((a) => a.backing.id).filter(Boolean));
    const { standing, alerts, agent, orders } = await ownerInstructionSources(ctx, owner);
    for (const o of standing) if (!backed.has(o.id)) entries.push({ id: o.id, source: "standing", name: o.text, trigger: describeTrigger(o.trigger), action: "plan intent", status: o.status, controllable: o.status === "active" || o.status === "paused" });
    for (const r of alerts) entries.push({ id: r.id, source: "alert", name: describeAlert(r), trigger: r.kind, action: `notify ${r.channels.join(", ")}`, status: r.paused ? "paused" : "active", controllable: true });
    for (const a of agent) entries.push({ id: a.id, source: "agent", name: a.sentence, trigger: "insight" in a.when ? `insight ${a.when.insight}` : `every ${a.when.everyMinutes} min`, action: a.mode === "session" ? "plan (agent session)" : "plan intent", status: a.enabled ? "active" : "paused", controllable: true });
    for (const { order } of orders) {
      const view = order as unknown as { hash?: string; summary?: string; kind?: string; status?: string };
      entries.push({ id: String(view.hash ?? ""), source: "order", name: String(view.summary ?? "order"), trigger: String(view.kind ?? "order"), action: "execute on chain (keeper)", status: String(view.status ?? "open"), controllable: false });
    }
  }
  return { automations: mine, entries };
}

/* ------------------------------------------------------------ evaluation */

async function fire(ctx: AppContext, a: StoredAutomation, observation: string): Promise<void> {
  const now = ctx.clock.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const counter = ctx.store.counters("business_automation_fires");
  if ((await counter.get(`${a.id}:${day}`)) >= a.maxFiresPerDay) return;
  await counter.increment(`${a.id}:${day}`, 1, { ttlMs: 2 * 86_400_000 });
  let intentId: string | null = null;
  let outcome = "notified";
  if (a.action.type === "plan") {
    const request = { environment: a.environment, owner: a.owner, fence: a.fence, proposedByAgent: true };
    const planned = a.action.actions ? await planActions(ctx, a.action.actions, a.name, request) : await planSentence(ctx, a.action.sentence ?? a.name, request);
    if (planned.kind === "planned") {
      intentId = planned.result.stored ? planned.result.intent.id : null;
      outcome = `planned (${planned.result.intent.verdict.decision})`;
    } else outcome = planned.kind === "refused" ? `refused: ${planned.message}` : `clarify: ${planned.questions.join(" ")}`;
  }
  const latest = ((await automations(ctx).get(a.id))?.value as StoredAutomation | undefined) ?? a;
  await automations(ctx).put(a.id, { ...latest, fired: latest.fired + 1, lastFiredAt: new Date(now).toISOString(), lastIntentId: intentId ?? latest.lastIntentId, lastObservation: observation }, { ttlMs: RECORD_TTL_MS });
  await businessEvent(ctx, "automation.fired", { id: a.id, name: a.name, observation, outcome, intentId }, { developer: a.developer, projectId: a.projectId, owner: a.owner });
}

/** One pass over native price, schedule and balance automations. */
export async function tickAutomations(ctx: AppContext): Promise<{ checked: number; fired: number }> {
  let checked = 0;
  let fired = 0;
  const now = ctx.clock.now();
  const all = (await automations(ctx).list({ limit: 5000 })).map((d) => d.value as StoredAutomation).filter((a) => a.status === "active" && a.backing.kind === "native" && a.trigger.type !== "event");
  for (const a of all) {
    try {
      checked += 1;
      const t = a.trigger;
      let observation: string | null = null;
      if (t.type === "price") {
        const price = (await services(ctx).standing.prices([t.feed]))[t.feed] ?? null;
        if (price !== null && (t.op === "above" ? compareDecimalStrings(price, t.value) >= 0 : compareDecimalStrings(price, t.value) <= 0)) observation = `${t.feed} ${price} ${t.op} ${t.value}`;
      } else if (t.type === "schedule") {
        const st = standingTrigger(t) as Extract<StandingTrigger, { kind: "schedule" }>;
        const due = nextScheduleRun(st, Date.parse(a.lastFiredAt ?? a.createdAt));
        if (now >= due) observation = `schedule due at ${new Date(due).toISOString()}`;
      } else if (t.type === "balance") {
        const token = findToken(a.environment, t.token);
        const address = token ? tokenAddress(token, a.environment) : null;
        if (!token || !address) continue;
        const client = ctx.chains.client(a.environment) as unknown as { readContract(x: unknown): Promise<unknown> };
        const raw = (await client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [(t.address ?? a.owner) as Address] })) as bigint;
        const balance = fromBaseUnits(raw, token.decimals);
        if (t.op === "above" ? compareDecimalStrings(balance, t.value) > 0 : compareDecimalStrings(balance, t.value) < 0) observation = `${token.symbol} balance ${balance} ${t.op} ${t.value}`;
      }
      if (observation) {
        await fire(ctx, a, observation);
        fired += 1;
      }
    } catch (error) {
      ctx.log.debug("automation check failed", { id: a.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked, fired };
}

const WIRED = new WeakSet<AppContext>();

/** Event-triggered automations listen to the flow event bus (once per context). */
export function wireAutomationEvents(ctx: AppContext): void {
  if (WIRED.has(ctx)) return;
  WIRED.add(ctx);
  onBusinessEvent(ctx, async (event: BusinessEvent) => {
    if (event.type === "automation.fired") return;
    const all = (await automations(ctx).list({ limit: 5000 })).map((d) => d.value as StoredAutomation);
    for (const a of all) {
      if (a.status !== "active" || a.developer !== event.developer || a.trigger.type !== "event" || a.trigger.event !== event.type) continue;
      if (a.projectId && event.projectId && a.projectId !== event.projectId) continue;
      await fire(ctx, a, `${event.type} ${(event.data as { id?: string } | null)?.id ?? ""}`.trim());
    }
  });
}
