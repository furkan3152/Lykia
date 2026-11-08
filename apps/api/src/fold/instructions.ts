/**
 * Herding: one read model over every standing instruction an owner has,
 * whatever created it: unified automations (Rounds), standing orders and the
 * recurring payments the goal compiler saved, alerts (Barks), agent
 * automations and LykiaOrders orders. Each row says what it is, whether it
 * runs, when it runs next, how the last run went and what the Fence said
 * (or is expected to say) about the next one.
 */
import { describeAlert, describeAutomationTrigger, describeTrigger, deriveIntentStatus, nextScheduleRun, type Address, type StandingOrder } from "@lykia/core";
import type { FoldInstruction, FoldInstructionsResponse } from "@lykia/core/api/fold";
import type { AppContext } from "../context.js";
import { ownerInstructionSources, type StoredAutomation } from "../devflows/automations.js";
import { automations, listOwned } from "../devflows/stores.js";
import { services } from "../services.js";
import { listProposals } from "./proposals.js";
import { listInstructions } from "../agents/instructions.js";
import type { WatchPayload } from "@lykia/core";

const iso = (ms: number) => new Date(ms).toISOString();

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

function standingRow(o: StandingOrder, now: number, verdict: Awaited<ReturnType<typeof verdictOfIntent>>): FoldInstruction {
  const recurring = isRecurringPayment(o);
  const next = o.status === "active" ? (o.nextRunAt ?? (o.trigger.kind === "schedule" ? iso(nextScheduleRun(o.trigger, now)) : null)) : null;
  const status: FoldInstruction["status"] = o.status === "done" ? "done" : o.status === "cancelled" ? "cancelled" : o.status === "paused" ? "paused" : "active";
  return {
    id: o.id,
    source: recurring ? "recurring" : "standing",
    sourceLabel: recurring ? "Recurring" : "Standing",
    name: o.text,
    status,
    trigger: describeTrigger(o.trigger),
    nextRunAt: next,
    nextRunLabel: status !== "active" ? status : next ? inWords(next, now) : o.trigger.kind === "price" ? "on price" : "on health factor",
    lastRunAt: o.lastFiredAt ?? o.lastCheckedAt ?? null,
    lastResult: o.lastObservation ?? (verdict ? `Plan ${verdict.result}` : o.fired > 0 ? `Fired ${o.fired} time(s)` : "Not run yet"),
    nextVerdict: verdict ? { decision: verdict.decision, reason: verdict.reason } : { decision: "unknown", reason: "Planned and checked by the Fence when it fires." },
    controllable: o.status === "active" || o.status === "paused",
    editSentence: `Change my standing instruction "${o.text}": `,
    environment: o.environment,
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
      sourceLabel: "Rounds",
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
    });
  }

  for (const o of standing) {
    if (backed.has(o.id)) continue;
    out.push(standingRow(o, now, await verdictOfIntent(ctx, o.lastIntentId)));
  }

  for (const r of alerts) {
    const name = describeAlert(r);
    out.push({
      id: r.id,
      source: "alert",
      sourceLabel: "Barks",
      name,
      status: r.paused ? "paused" : "active",
      trigger: r.kind.replace(/-/gu, " "),
      nextRunAt: null,
      nextRunLabel: r.paused ? "paused" : "when it happens",
      lastRunAt: r.lastFiredAt,
      lastResult: r.lastFiredAt ? `Barked to ${r.channels.join(", ")}` : "Quiet so far",
      nextVerdict: { decision: "allow", reason: "Alerts notify; they move nothing." },
      controllable: true,
      editSentence: `Change my alert "${name}": `,
      environment: r.environment,
    });
  }

  for (const a of agent) {
    const every = "everyMinutes" in a.when ? a.when.everyMinutes : null;
    const next = a.enabled && every !== null ? iso(a.lastRunAt ? Date.parse(a.lastRunAt) + every * 60_000 : now) : null;
    out.push({
      id: a.id,
      source: "agent",
      sourceLabel: "Agent rounds",
      name: a.sentence,
      status: a.enabled ? "active" : "paused",
      trigger: "insight" in a.when ? `on the ${a.when.insight} insight` : `every ${every} min`,
      nextRunAt: next,
      nextRunLabel: !a.enabled ? "paused" : next ? inWords(next, now) : "on an insight",
      lastRunAt: a.lastRunAt ?? null,
      lastResult: a.lastRunAt ? "Proposed a plan" : "Not run yet",
      nextVerdict: { decision: a.mode === "session" ? "unknown" : "confirm", reason: a.mode === "session" ? "Runs through the agent's on-chain session, inside its Fence." : "Lands as a proposal; you sign." },
      controllable: true,
      editSentence: `Change my agent automation "${a.sentence}": `,
      environment: a.environment,
    });
  }

  for (const { environment, order: o } of orders) {
    const open = o.status === "open" || o.status === "waiting";
    const interval = o.order.interval > 0 && o.order.executions > 1;
    const next = open && interval && o.lastExecutedAt ? iso(Date.parse(o.lastExecutedAt) + o.order.interval * 1000) : open && o.order.startTime * 1000 > now ? iso(o.order.startTime * 1000) : null;
    out.push({
      id: o.hash,
      source: "order",
      sourceLabel: "Orders",
      name: o.summary,
      status: o.status === "filled" ? "done" : o.status === "cancelled" || o.status === "expired" ? "cancelled" : o.status === "invalid" ? "failed" : o.status === "waiting" ? "waiting" : "active",
      trigger: o.waitingFor ? `waiting for ${o.waitingFor}` : interval ? `${o.executed} of ${o.order.executions} slices` : "ready",
      nextRunAt: next,
      nextRunLabel: !open ? o.status : next ? inWords(next, now) : o.waitingFor ? `on ${o.waitingFor}` : "next keeper pass",
      lastRunAt: o.lastExecutedAt,
      lastResult: o.executed > 0 ? `${o.executed} of ${o.order.executions} executed` : "Not filled yet",
      nextVerdict: { decision: "allow", reason: "Signed once; LykiaOrders enforces the price, size and deadline on chain." },
      controllable: false,
      editSentence: `Change my order "${o.summary}": `,
      environment,
    });
  }

  // Watch tasks Ask Lyko handed to Lyko on watch: checked each time Lyko on watch reads the Fold.
  for (const w of await listInstructions(ctx, owner, { kind: "watch" }).catch(() => [])) {
    const p = w.payload as WatchPayload;
    out.push({
      id: w.id,
      source: "watch",
      sourceLabel: "From Ask Lyko",
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
    });
  }

  const rank = (s: FoldInstruction["status"]) => (s === "active" || s === "waiting" ? 0 : s === "paused" ? 1 : 2);
  return out.sort((a, b) => rank(a.status) - rank(b.status) || (a.nextRunAt ?? "9").localeCompare(b.nextRunAt ?? "9"));
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
      running: instructions.filter((i) => i.status === "active" || i.status === "waiting").length,
      paused: instructions.filter((i) => i.status === "paused").length,
      ordersWaiting: instructions.filter((i) => i.source === "order" && (i.status === "active" || i.status === "waiting")).length,
      waitingSignature: waiting.length,
    },
  };
}
