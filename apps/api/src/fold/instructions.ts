/**
 * Herding · Running: one read model over everything in motion for an owner,
 * whatever engine holds it. Each row is one of a few nouns:
 *
 *   automation  unified automations, standing orders, recurring payments,
 *               agent automations and Autopilot tasks, each with who signs
 *   order       LykiaOrders limit, stop, TWAP and DCA orders
 *   watch       alerts and watch tasks, with their channels
 *   leash       leashes (Stile included) and the Pack agents that hold them
 *   autopilot   Autopilot itself
 *   plan        chat plans still in progress
 *   payment     payment links and invoices from Pay
 *
 * Each row says what it is, its state, what happens next and when, and the
 * one control that fits (Pause, Resume, Stop or Cancel) as the HTTP call
 * that does it. Changing anything goes through Ask Lyko.
 */
import { describeAlert, describeAutomationTrigger, describeTrigger, deriveIntentStatus, findToken, fromBaseUnits, nextScheduleRun, type Address, type ArcEnvironment, type StandingOrder } from "@lykia/core";
import type { FoldInstruction, FoldInstructionsResponse, RunningControl, RunningKind } from "@lykia/core/api/fold";
import { agentServices } from "../agents/index.js";
import { autopilotService } from "../autopilot/service.js";
import { invoices } from "../devflows/stores.js";
import { leashService } from "../leash/service.js";
import type { AppContext } from "../context.js";
import { ownerInstructionSources, type StoredAutomation } from "../devflows/automations.js";
import { automations, listOwned } from "../devflows/stores.js";
import { invoiceStatusOf, type Invoice } from "@lykia/core";
import { services } from "../services.js";
import { listProposals } from "./proposals.js";
import { listInstructions } from "../agents/instructions.js";
import { orderVerdict } from "../orders/verdict.js";
import { ownerIntents } from "./trails.js";
import type { WatchPayload } from "@lykia/core";

const iso = (ms: number) => new Date(ms).toISOString();
/** Plans older than this are not listed as in progress (their quotes are long stale). */
const PLAN_WINDOW_MS = 7 * 86_400_000;

/** The Fence and beta verdict one execution of an open order would get now; unknown when it cannot be judged. */
async function orderNextVerdict(ctx: AppContext, owner: Address, environment: ArcEnvironment, o: { readonly tokenIn: string; readonly tokenOut: string; readonly amountIn: string; readonly minAmountOut: string; readonly maxFeeBps: number; readonly maxTip: string; readonly triggerPrice: string; readonly oracle: string }): Promise<{ decision: "allow" | "confirm" | "deny" | "unknown"; reason: string }> {
  const sell = findToken(environment, o.tokenIn);
  const buy = findToken(environment, o.tokenOut);
  if (!sell || !buy) return { decision: "unknown", reason: "Not a registry pair: checked by LykiaOrders on chain only." };
  try {
    const triggered = o.oracle !== "0x0000000000000000000000000000000000000000" && BigInt(o.triggerPrice) > 0n;
    const swapped = BigInt(o.amountIn) - (BigInt(o.amountIn) * BigInt(o.maxFeeBps)) / 10_000n - BigInt(o.maxTip);
    const quote = { swapped: fromBaseUnits(swapped, sell.decimals), expectedOut: fromBaseUnits((BigInt(o.minAmountOut) * 10_000n) / 9_900n, buy.decimals), ...(triggered ? { triggerPrice: fromBaseUnits(BigInt(o.triggerPrice), 8) } : {}) };
    const verdict = await orderVerdict(ctx, { environment, owner, sell: sell.symbol, buy: buy.symbol, perExecution: fromBaseUnits(BigInt(o.amountIn), sell.decimals), quote });
    return { decision: verdict.decision, reason: verdict.reasons.find((r) => r.decision !== "allow")?.message ?? "One execution fits your Fence and the beta cap today; LykiaOrders enforces the price, size and deadline on chain." };
  } catch (error) {
    return { decision: "unknown", reason: error instanceof Error ? error.message.slice(0, 160) : "The Fence could not judge it now." };
  }
}


const usdShort = (v: string | number) => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${v}`;
};

/** Pause or resume through /v1/automations/:id (automations, standing orders, recurring payments, alerts, agent automations). */
function automationControl(id: string, owner: Address, paused: boolean): RunningControl {
  return { action: paused ? "resume" : "pause", label: paused ? "Resume" : "Pause", method: "post", path: `/v1/automations/${encodeURIComponent(id)}/${paused ? "resume" : "pause"}`, query: { owner: owner.toLowerCase() } };
}

/** "in 3 h", "in 2 d", "now" — for a next-run time. */
export function inWords(at: string | null, now: number): string {
  if (!at) return "—";
  const ms = Date.parse(at) - now;
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 60_000) return "due now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} d`;
}

async function verdictOfIntent(ctx: AppContext, intentId: string | null | undefined): Promise<{ decision: "allow" | "confirm" | "deny"; reason: string; result: string } | null> {
  if (!intentId) return null;
  const intent = await services(ctx).intents.get(intentId).then((r) => r.intent).catch(() => null);
  if (!intent) return null;
  const reason = intent.verdict.reasons.find((r) => r.decision !== "allow")?.message ?? (intent.verdict.decision === "allow" ? "Every rule passed last time." : "The Fence asked for a confirmation.");
  return { decision: intent.verdict.decision, reason, result: deriveIntentStatus(intent) };
}

function isRecurringPayment(o: StandingOrder): boolean {
  return o.trigger.kind === "schedule" && o.actions.length > 0 && o.actions.every((a) => a.verb === "send");
}

function standingRow(o: StandingOrder, now: number, verdict: Awaited<ReturnType<typeof verdictOfIntent>>, owner: Address): FoldInstruction {
  const recurring = isRecurringPayment(o);
  const next = o.status === "active" ? (o.nextRunAt ?? (o.trigger.kind === "schedule" ? iso(nextScheduleRun(o.trigger, now)) : null)) : null;
  const status: FoldInstruction["status"] = o.status === "done" ? "done" : o.status === "cancelled" ? "cancelled" : o.status === "paused" ? "paused" : "active";
  return {
    id: o.id,
    source: recurring ? "recurring" : "standing",
    sourceLabel: recurring ? "Recurring payment" : "Automation",
    name: o.text,
    status,
    trigger: describeTrigger(o.trigger),
    nextRunAt: next,
    nextRunLabel: status !== "active" ? status : next ? inWords(next, now) : o.trigger.kind === "price" ? "on price" : "on health factor",
    lastRunAt: o.lastFiredAt ?? o.lastCheckedAt ?? null,
    lastResult: o.lastObservation ?? (verdict ? `Plan ${verdict.result}` : o.fired > 0 ? `Fired ${o.fired} time(s)` : "Not run yet"),
    nextVerdict: verdict ? { decision: verdict.decision, reason: verdict.reason } : { decision: "unknown", reason: "Planned and checked by the Fence when it fires." },
    controllable: o.status === "active" || o.status === "paused",
    editSentence: `Change my automation "${o.text}": `,
    environment: o.environment,
    kind: "automation",
    signs: o.signer === "agent" ? "leash" : "you",
    nextLine: status !== "active" ? (status === "paused" ? "Paused: nothing runs until you resume it." : "Finished.") : next ? `Runs ${inWords(next, now)}; you sign what it plans.` : `Runs when its ${o.trigger.kind === "price" ? "price" : "health factor"} condition holds.`,
    control: o.status === "active" || o.status === "paused" ? automationControl(o.id, owner, o.status === "paused") : null,
  };
}

/** Every instruction the owner has, newest first within each source, active before paused. */
export async function instructionsFor(ctx: AppContext, owner: Address): Promise<FoldInstruction[]> {
  const now = ctx.clock.now();
  const me = owner.toLowerCase();
  const out: FoldInstruction[] = [];

  const unified = ((await listOwned(automations(ctx), me).catch(() => [])) as StoredAutomation[]).filter((a) => a.owner.toLowerCase() === me);
  const backed = new Set(unified.map((a) => a.backing.id).filter(Boolean));
  const { standing, alerts, agent, orders } = await ownerInstructionSources(ctx, owner);
  const standingById = new Map(standing.map((o) => [o.id, o]));

  for (const a of unified) {
    const backing = a.backing.id ? standingById.get(a.backing.id) : undefined;
    const verdict = await verdictOfIntent(ctx, a.lastIntentId ?? backing?.lastIntentId);
    const next = a.status !== "active" ? null : backing?.nextRunAt ?? (a.trigger.type === "schedule" ? iso(nextScheduleRun({ kind: "schedule", every: a.trigger.every, ...(a.trigger.weekday ? { weekday: a.trigger.weekday } : {}), ...(a.trigger.day ? { day: a.trigger.day } : {}), at: a.trigger.at, timezone: a.trigger.timezone }, now)) : null);
    out.push({
      id: a.id,
      source: "automation",
      sourceLabel: "Automation",
      name: a.name,
      status: a.status,
      trigger: describeAutomationTrigger(a.trigger),
      nextRunAt: next,
      nextRunLabel: a.status !== "active" ? "paused" : next ? inWords(next, now) : a.trigger.type === "price" ? "on price" : a.trigger.type === "balance" ? "on balance" : "on event",
      lastRunAt: a.lastFiredAt,
      lastResult: a.lastObservation ?? (verdict ? `Plan ${verdict.result}` : a.fired > 0 ? `Fired ${a.fired} time(s)` : "Not run yet"),
      nextVerdict: a.action.type === "notify" ? { decision: "allow", reason: "Notifies your webhooks; moves nothing." } : verdict ? { decision: verdict.decision, reason: verdict.reason } : { decision: "unknown", reason: "Planned and checked by the Fence when it fires." },
      controllable: true,
      editSentence: `Change my automation "${a.name}": `,
      environment: a.environment,
      kind: "automation",
      signs: "you",
      nextLine: a.status !== "active" ? "Paused: nothing runs until you resume it." : a.action.type === "notify" ? `Notifies your webhooks ${next ? inWords(next, now) : "when it fires"}; moves nothing.` : `Plans its sentence ${next ? inWords(next, now) : `on ${a.trigger.type}`}; you sign what it plans.`,
      control: automationControl(a.id, owner, a.status !== "active"),
    });
  }

  for (const o of standing) {
    if (backed.has(o.id)) continue;
    out.push(standingRow(o, now, await verdictOfIntent(ctx, o.lastIntentId), owner));
  }

  for (const r of alerts) {
    const name = describeAlert(r);
    out.push({
      id: r.id,
      source: "alert",
      sourceLabel: "Watch",
      name,
      status: r.paused ? "paused" : "active",
      trigger: r.kind.replace(/-/gu, " "),
      nextRunAt: null,
      nextRunLabel: r.paused ? "paused" : "when it happens",
      lastRunAt: r.lastFiredAt,
      lastResult: r.lastFiredAt ? `Told you on ${channelsOf(r.channels).join(", ")}` : "Quiet so far",
      nextVerdict: { decision: "allow", reason: "A watch only tells you; it moves nothing." },
      controllable: true,
      editSentence: `Change my watch "${name}": `,
      environment: r.environment,
      kind: "watch",
      channels: channelsOf(r.channels),
      nextLine: r.paused ? "Paused: it tells you nothing until you resume it." : `Tells you on ${channelsOf(r.channels).join(", ")} when it happens.`,
      control: automationControl(r.id, owner, r.paused === true),
    });
  }

  for (const a of agent) {
    const every = "everyMinutes" in a.when ? a.when.everyMinutes : null;
    const next = a.enabled && every !== null ? iso(a.lastRunAt ? Date.parse(a.lastRunAt) + every * 60_000 : now) : null;
    out.push({
      id: a.id,
      source: "agent",
      sourceLabel: "Automation",
      name: a.sentence,
      status: a.enabled ? "active" : "paused",
      trigger: "insight" in a.when ? `on the ${a.when.insight} insight` : `every ${every} min`,
      nextRunAt: next,
      nextRunLabel: !a.enabled ? "paused" : next ? inWords(next, now) : "on an insight",
      lastRunAt: a.lastRunAt ?? null,
      lastResult: a.lastRunAt ? "Proposed a plan" : "Not run yet",
      nextVerdict: { decision: a.mode === "session" ? "unknown" : "confirm", reason: a.mode === "session" ? "Runs through the agent's on-chain session, inside its Fence." : "Lands as a proposal; you sign." },
      controllable: true,
      editSentence: `Change my automation "${a.sentence}": `,
      environment: a.environment,
      kind: "automation",
      signs: a.mode === "session" ? "leash" : "you",
      nextLine: !a.enabled ? "Paused: nothing runs until you resume it." : `Plans ${next ? inWords(next, now) : "on an insight"}; ${a.mode === "session" ? "its agent signs inside its leash" : "you sign what it plans"}.`,
      control: automationControl(a.id, owner, !a.enabled),
    });
  }

  for (const { environment, order: o } of orders) {
    const open = o.status === "open" || o.status === "waiting";
    const interval = o.order.interval > 0 && o.order.executions > 1;
    const next = open && interval && o.lastExecutedAt ? iso(Date.parse(o.lastExecutedAt) + o.order.interval * 1000) : open && o.order.startTime * 1000 > now ? iso(o.order.startTime * 1000) : null;
    out.push({
      id: o.hash,
      source: "order",
      sourceLabel: "Order",
      name: o.summary,
      status: o.status === "filled" ? "done" : o.status === "cancelled" || o.status === "expired" ? "cancelled" : o.status === "invalid" ? "failed" : o.status === "waiting" ? "waiting" : "active",
      trigger: o.waitingFor ? `waiting for ${o.waitingFor}` : interval ? `${o.executed} of ${o.order.executions} slices` : "ready",
      nextRunAt: next,
      nextRunLabel: !open ? o.status : next ? inWords(next, now) : o.waitingFor ? `on ${o.waitingFor}` : "next keeper pass",
      lastRunAt: o.lastExecutedAt,
      lastResult: o.executed > 0 ? `${o.executed} of ${o.order.executions} executed` : "Not filled yet",
      // The real verdict: the owner's Fence and the beta cap on one execution today, as the keeper would face it.
      nextVerdict: open ? await orderNextVerdict(ctx, owner, environment, o.order) : null,
      controllable: false,
      editSentence: `Change my order "${o.summary}": `,
      environment,
      ...(open ? { cancel: { hash: o.hash, environment } } : {}),
      kind: "order",
      signs: "you",
      nextLine: !open ? `Order ${o.status}.` : next ? `Next slice ${inWords(next, now)}; a keeper executes it inside the terms you signed.` : o.waitingFor ? `Executes when ${o.waitingFor}; a keeper runs it inside the terms you signed.` : "A keeper executes it on its next pass.",
      control: open ? { action: "cancel", label: "Cancel", method: "get", path: `/v1/orders/${o.hash}/cancel-tx`, query: { environment }, sign: "order-cancel" } : null,
    });
  }

  // Plans started in Ask (or from a draft) that still have steps to sign: one row each, with Stop.
  const waitingIntents = new Set((await listProposals(ctx, owner).catch(() => [])).filter((p) => p.status === "proposed" || p.status === "approved").map((p) => p.intentId).filter(Boolean));
  for (const g of await ownerIntents(ctx, owner).catch(() => [])) {
    const state = deriveIntentStatus(g);
    if ((state !== "planned" && state !== "running") || waitingIntents.has(g.id) || now - Date.parse(g.createdAt) > PLAN_WINDOW_MS) continue;
    const steps = g.steps.filter((st) => st.kind !== "approve");
    const settled = steps.filter((st) => st.status === "settled").length;
    const next = steps.find((st) => st.status !== "settled");
    out.push({
      id: g.id,
      source: "plan",
      sourceLabel: "Plan",
      name: (g.source || steps.map((st) => st.summary).join(" → ")).slice(0, 160),
      status: "active",
      trigger: `${settled} of ${steps.length} step${steps.length === 1 ? "" : "s"} settled`,
      nextRunAt: null,
      nextRunLabel: next?.status === "submitted" || next?.status === "settling" ? "settling" : "your signature",
      lastRunAt: g.steps.map((st) => st.settledAt).filter((t): t is string => Boolean(t)).sort().pop() ?? g.createdAt,
      lastResult: next ? `Next: ${next.summary}`.slice(0, 160) : "All steps settled",
      nextVerdict: { decision: g.verdict.decision, reason: g.verdict.reasons.find((r) => r.decision !== "allow")?.message ?? "Every rule passed when it was planned; each step is checked again before you sign." },
      controllable: false,
      editSentence: `Change my plan "${(g.source || "").slice(0, 80)}": `,
      environment: g.environment,
      stop: { intentId: g.id },
      kind: "plan",
      signs: "you",
      nextLine: next ? (next.status === "submitted" || next.status === "settling" ? `Settling: ${next.summary}`.slice(0, 160) : `Waits for your signature: ${next.summary}`.slice(0, 160)) : "All steps settled.",
      control: { action: "stop", label: "Stop", method: "post", path: `/v1/intents/${encodeURIComponent(g.id)}/stop` },
    });
  }

  // Watch tasks Ask Lyko handed to Lyko on watch: checked each time Lyko on watch reads the Fold.
  for (const w of await listInstructions(ctx, owner, { kind: "watch" }).catch(() => [])) {
    const p = w.payload as WatchPayload;
    out.push({
      id: w.id,
      source: "watch",
      sourceLabel: "Watch",
      name: p.label,
      status: w.status === "paused" ? "paused" : "active",
      trigger: `watch task · ${p.condition.kind.replace(/-/gu, " ")}`,
      nextRunAt: null,
      nextRunLabel: w.status === "paused" ? "paused" : "on each Fold read",
      lastRunAt: p.lastFiredAt,
      lastResult: p.observation ?? "Not checked yet",
      nextVerdict: { decision: "allow", reason: "A watch only raises an insight; it moves nothing." },
      controllable: true,
      editSentence: `Change my watch "${p.label}": `,
      environment: w.environment,
      kind: "watch",
      channels: ["in-app"],
      nextLine: w.status === "paused" ? "Paused: Lyko on watch skips it until you resume it." : "Lyko on watch checks it each time it reads your Fold and raises an insight in-app.",
      control: { action: w.status === "paused" ? "resume" : "pause", label: w.status === "paused" ? "Resume" : "Pause", method: "post", path: `/v1/agent/instructions/${encodeURIComponent(w.id)}/${w.status === "paused" ? "resume" : "pause"}`, body: { owner: owner.toLowerCase() } },
    });
  }

  out.push(...(await spendingRows(ctx, owner, now)));
  out.push(...(await autopilotRows(ctx, owner, now)));
  out.push(...(await paymentRows(ctx, owner, now)));

  const rank = (s: FoldInstruction["status"]) => (s === "active" || s === "waiting" ? 0 : s === "paused" ? 1 : 2);
  return out.sort((a, b) => rank(a.status) - rank(b.status) || (a.nextRunAt ?? "9").localeCompare(b.nextRunAt ?? "9"));
}

function channelsOf(channels: readonly string[]): ("in-app" | "webhook" | "telegram")[] {
  return [...new Set(channels.map((c) => (c === "webhook" ? "webhook" : c === "telegram" ? "telegram" : "in-app") as "in-app" | "webhook" | "telegram"))];
}

/**
 * Leashes and the Pack agents that hold them: one row per agent. A leash's
 * control is Stop (Revoke: the key dies at once, then the owner signs
 * revokeSession); an agent without a leash is paused and resumed.
 */
async function spendingRows(ctx: AppContext, owner: Address, now: number): Promise<FoldInstruction[]> {
  const out: FoldInstruction[] = [];
  const leashes = await leashService(ctx).ownedBy(owner).catch(() => []);
  const pilots = new Set((await Promise.all((["mainnet", "testnet"] as const).map((env) => autopilotService(ctx).get(owner, env).catch(() => null)))).filter((a) => a !== null).map((a) => a.leashId));
  const leashed = new Set<string>();
  for (const l of leashes) {
    if (pilots.has(l.id)) continue;
    leashed.add(l.agentId);
    const live = l.status === "active" || l.status === "pending";
    if (!live) continue;
    const paused = Boolean(l.paused);
    const stile = l.spendFrom === "gateway";
    out.push({
      id: l.id,
      source: "leash",
      sourceLabel: stile ? "Leash · Stile" : "Leash",
      name: `${l.agentName}: ${usdShort(l.budget.perDayUsd)} a day, ${usdShort(l.budget.totalUsd)} in all`,
      status: paused ? "paused" : l.status === "pending" ? "waiting" : "active",
      trigger: stile ? "spends from your Gateway balance through your LykiaStile" : "spends from your LykiaAccount on Arc",
      nextRunAt: l.expiresAt,
      nextRunLabel: l.status === "pending" ? "your signature" : paused ? "paused" : `key stops ${inWords(l.expiresAt, now)}`,
      lastRunAt: null,
      lastResult: l.status === "pending" ? "Waiting for the session you sign" : null,
      nextVerdict: { decision: "allow", reason: "Every step is checked against the leash's Fence, its budget and the session's limits on chain." },
      controllable: true,
      editSentence: `Change ${l.agentName}'s leash: `,
      environment: l.environment,
      kind: "leash",
      nextLine: l.status === "pending" ? "Goes live once you sign its session." : paused ? "Held by the Whistle: its key is refused until resumed." : `May spend up to ${usdShort(l.budget.perDayUsd)} today, ${usdShort(l.budget.perStepUsd)} in one step; the key stops ${inWords(l.expiresAt, now)}.`,
      control: { action: "stop", label: "Revoke", method: "post", path: `/v1/leashes/${encodeURIComponent(l.id)}/revoke`, sign: "revoke-session" },
    });
  }
  for (const a of await agentServices(ctx).pack.ownedBy(owner).catch(() => [])) {
    if (leashed.has(a.id) || a.status === "revoked") continue;
    const paused = a.status === "paused";
    // Its budget is the tighter of its own Fence and what is carved for it from the owner's.
    const daily = (await agentServices(ctx).pack.view(a.id).catch(() => null))?.budget.caps.dailyUsd ?? a.fence.caps?.dailyUsd ?? null;
    out.push({
      id: a.id,
      source: "pack-agent",
      sourceLabel: "Leash",
      name: `${a.name}: ${a.role.replace(/-/gu, " ")} agent${daily ? `, ${usdShort(daily)} a day` : ""}`,
      status: paused ? "paused" : "active",
      trigger: a.session ? "signs through its on-chain session" : "proposes; you sign",
      nextRunAt: null,
      nextRunLabel: paused ? "paused" : "when you ask",
      lastRunAt: null,
      lastResult: null,
      nextVerdict: { decision: "allow", reason: "Its own Fence sits inside yours; its budget is carved from yours." },
      controllable: true,
      editSentence: `Change my agent ${a.name}: `,
      environment: a.environment,
      kind: "leash",
      nextLine: paused ? "Lying down: it proposes nothing until resumed." : daily ? `May propose up to ${usdShort(daily)} a day; you sign each plan.` : "Proposes plans inside its Fence; you sign each one.",
      control: { action: paused ? "resume" : "pause", label: paused ? "Resume" : "Pause", method: "post", path: `/v1/pack/${encodeURIComponent(a.id)}/${paused ? "resume" : "pause"}` },
    });
  }
  return out;
}

/** Autopilot itself, and each of its tasks as an automation Autopilot signs. */
async function autopilotRows(ctx: AppContext, owner: Address, now: number): Promise<FoldInstruction[]> {
  const out: FoldInstruction[] = [];
  for (const environment of ["mainnet", "testnet"] as const) {
    const ap = await autopilotService(ctx).get(owner, environment).catch(() => null);
    if (!ap || ap.status === "stopped") continue;
    const on = ap.status === "on";
    out.push({
      id: `autopilot:${environment}`,
      source: "autopilot",
      sourceLabel: "Autopilot",
      name: `Autopilot on Arc ${environment}: up to ${usdShort(ap.limits.perStepUsd)} a step, ${usdShort(ap.limits.perDayUsd)} a day`,
      status: on ? "active" : ap.status === "pending" ? "waiting" : "paused",
      trigger: `${ap.tasks.length} task${ap.tasks.length === 1 ? "" : "s"}`,
      nextRunAt: null,
      nextRunLabel: ap.status === "pending" ? "your signature" : on ? "runs its tasks" : "paused",
      lastRunAt: ap.updatedAt,
      lastResult: ap.paused?.reason ?? null,
      nextVerdict: { decision: "allow", reason: "Each run is checked against your Fence and its leash before Lyko signs." },
      controllable: ap.status !== "pending",
      editSentence: "Change my Autopilot: ",
      environment,
      kind: "autopilot",
      signs: "autopilot",
      nextLine: ap.status === "pending" ? "Starts once you sign its session." : on ? `Signs your own automations below, inside ${usdShort(ap.limits.perDayUsd)} a day.` : `Paused: ${ap.paused?.reason ?? "nothing is signed until resumed"}`.slice(0, 160),
      control: ap.status === "pending" ? null : { action: on ? "pause" : "resume", label: on ? "Pause" : "Resume", method: "post", path: `/v1/autopilot/${on ? "pause" : "resume"}`, body: { environment } },
    });
    for (const t of ap.tasks) {
      const schedule = t.when.kind === "schedule" ? t.when.every : null;
      const next = t.enabled && on && schedule ? new Date((t.lastRunAt ? Date.parse(t.lastRunAt) : now) + ({ day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const)[schedule]).toISOString() : null;
      out.push({
        id: t.id,
        source: "autopilot-task",
        sourceLabel: "Automation",
        name: t.label,
        status: t.enabled ? (on ? "active" : "paused") : "paused",
        trigger: schedule ? `every ${schedule}` : "when its condition holds",
        nextRunAt: next,
        nextRunLabel: !t.enabled ? "paused" : !on ? "Autopilot paused" : next ? inWords(next, now) : "on condition",
        lastRunAt: t.lastRunAt,
        lastResult: t.lastResult ?? (t.runs > 0 ? `Ran ${t.runs} time(s)` : "Not run yet"),
        nextVerdict: { decision: "allow", reason: `Autopilot signs at most ${usdShort(t.amountUsd)} a run, inside your Fence and its leash.` },
        controllable: true,
        editSentence: `Change my automation "${t.label}": `,
        environment,
        kind: "automation",
        signs: "autopilot",
        nextLine: !t.enabled ? "Paused: Autopilot skips it until you resume it." : `${next ? `Runs ${inWords(next, now)}` : "Runs when its condition holds"}; Autopilot signs up to ${usdShort(t.amountUsd)}.`,
        control: { action: t.enabled ? "pause" : "resume", label: t.enabled ? "Pause" : "Resume", method: "post", path: `/v1/autopilot/tasks/${encodeURIComponent(t.id)}/${t.enabled ? "pause" : "resume"}`, body: { environment } },
      });
    }
  }
  return out;
}

/** Open payment links and invoices from Pay: Cancel voids one (a paid one cannot be voided). */
async function paymentRows(ctx: AppContext, owner: Address, now: number): Promise<FoldInstruction[]> {
  const mine = (await listOwned(invoices(ctx), owner.toLowerCase()).catch(() => [])) as Invoice[];
  return mine
    .map((i) => ({ ...i, status: invoiceStatusOf(i, now) }))
    .filter((i) => i.status === "open" || i.status === "partially-paid" || i.status === "overdue")
    .map((i): FoldInstruction => {
      const link = i.lineItems.length === 0 && !i.reference && !i.dueDate;
      const amount = i.amount && Number(i.amount) > 0 ? `${i.amount} ${i.token}` : "any amount";
      return {
        id: i.id,
        source: "invoice",
        sourceLabel: link ? "Payment link" : "Invoice",
        name: `${i.memo ?? (link ? "Payment link" : "Invoice")}: ${amount}`.slice(0, 160),
        status: i.status === "overdue" ? "waiting" : "active",
        trigger: i.status === "partially-paid" ? `${i.paid} of ${i.amount} ${i.token} paid` : "open",
        nextRunAt: i.dueDate,
        nextRunLabel: i.dueDate ? `due ${inWords(i.dueDate, now)}` : "when paid",
        lastRunAt: i.payments.length > 0 ? i.updatedAt : null,
        lastResult: i.payments.length > 0 ? `${i.payments.length} payment(s)` : "Not paid yet",
        nextVerdict: { decision: "allow", reason: "Money comes in; nothing leaves your wallet." },
        controllable: true,
        editSentence: `Change my ${link ? "payment link" : "invoice"} "${i.memo ?? i.id}": `,
        environment: i.environment,
        kind: "payment",
        nextLine: i.status === "overdue" ? "Overdue: still payable until you cancel it." : `Waits for the payer${i.dueDate ? `, due ${inWords(i.dueDate, now)}` : ""}; Lykia records the payment from the chain.`,
        control: { action: "cancel", label: "Cancel", method: "post", path: `/v1/invoices/${encodeURIComponent(i.id)}/void` },
      };
    });
}

export async function instructionsView(ctx: AppContext, owner: Address): Promise<FoldInstructionsResponse> {
  const [instructions, proposals] = await Promise.all([instructionsFor(ctx, owner), listProposals(ctx, owner)]);
  const waiting = proposals.filter((p) => p.status === "proposed" || p.status === "approved");
  return {
    owner: owner.toLowerCase() as Address,
    at: iso(ctx.clock.now()),
    instructions,
    waiting,
    counts: {
      running: instructions.filter((i) => (i.status === "active" || i.status === "waiting") && i.source !== "plan").length,
      agentsWorking: instructions.filter((i) => i.kind === "leash" && (i.status === "active" || i.status === "waiting")).length,
      byKind: instructions.reduce<Partial<Record<RunningKind, number>>>((acc, i) => (i.kind && i.status !== "done" && i.status !== "cancelled" ? { ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 } : acc), {}),
      paused: instructions.filter((i) => i.status === "paused").length,
      ordersWaiting: instructions.filter((i) => i.source === "order" && (i.status === "active" || i.status === "waiting")).length,
      waitingSignature: waiting.length,
    },
  };
}
