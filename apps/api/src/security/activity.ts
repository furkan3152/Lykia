/**
 * The agent safety monitor's memory (layer 4): recent activity per subject,
 * owner policies, pauses and security alerts. A subject is an agent
 * address when an agent signs, otherwise the owner.
 */
import { DEFAULT_MONITOR_POLICY, type ActivityEvent, type MonitorPolicy } from "@lykia/core/security/index";
import { randomBytes } from "node:crypto";
import type { AppContext } from "../context.js";
import { typedCollection } from "../platform/typed.js";
import { listAll } from "../store/types.js";

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(15, "0");

const activity = (ctx: AppContext) => typedCollection<ActivityEvent>(ctx, "security_activity");
const policies = (ctx: AppContext) => typedCollection<Partial<MonitorPolicy>>(ctx, "security_policy");
const pauses = (ctx: AppContext) => typedCollection<SecurityPause>(ctx, "security_pauses");
const alerts = (ctx: AppContext) => typedCollection<SecurityAlert>(ctx, "security_alerts");

export interface SecurityPause {
  readonly subject: string;
  readonly owner: string;
  readonly reason: string;
  readonly at: string;
  readonly by: "auto-whistle" | "owner" | "admin";
}

export interface SecurityAlert {
  readonly id: string;
  readonly at: string;
  readonly owner: string;
  readonly subject: string;
  readonly severity: "block" | "warn" | "info";
  readonly rule: string;
  readonly title: string;
  readonly body: string;
}

export async function recordActivity(ctx: AppContext, subject: string, event: ActivityEvent): Promise<void> {
  await activity(ctx).put(`${subject.toLowerCase()}:${pad(event.at)}:${randomBytes(3).toString("hex")}`, event, { ttlMs: 7 * DAY });
}

export async function recentActivity(ctx: AppContext, subject: string, now: number): Promise<ActivityEvent[]> {
  const prefix = `${subject.toLowerCase()}:`;
  return (await activity(ctx).list({ prefix, after: `${prefix}${pad(now - DAY)}`, limit: 1000 })).map((d) => d.value);
}

export async function policyOf(ctx: AppContext, owner: string): Promise<MonitorPolicy> {
  const stored = (await policies(ctx).get(owner.toLowerCase()))?.value ?? {};
  return { ...DEFAULT_MONITOR_POLICY, ...stored };
}

export async function setPolicy(ctx: AppContext, owner: string, patch: Partial<MonitorPolicy>): Promise<MonitorPolicy> {
  const current = (await policies(ctx).get(owner.toLowerCase()))?.value ?? {};
  await policies(ctx).put(owner.toLowerCase(), { ...current, ...patch });
  return policyOf(ctx, owner);
}

export async function pauseOf(ctx: AppContext, subject: string): Promise<SecurityPause | null> {
  return (await pauses(ctx).get(subject.toLowerCase()))?.value ?? null;
}

export async function pause(ctx: AppContext, value: SecurityPause): Promise<void> {
  await pauses(ctx).put(value.subject.toLowerCase(), value);
}

export async function resume(ctx: AppContext, subject: string): Promise<boolean> {
  return pauses(ctx).delete(subject.toLowerCase());
}

export async function listPauses(ctx: AppContext, owner: string): Promise<SecurityPause[]> {
  return (await listAll(pauses(ctx))).map((d) => d.value).filter((p) => p.owner === owner.toLowerCase());
}

export async function raiseAlert(ctx: AppContext, alert: Omit<SecurityAlert, "id" | "at">): Promise<SecurityAlert> {
  const now = ctx.clock.now();
  const id = `sa_${pad(now)}_${randomBytes(3).toString("hex")}`;
  const full: SecurityAlert = { ...alert, owner: alert.owner.toLowerCase(), id, at: new Date(now).toISOString() };
  await alerts(ctx).put(`${full.owner}:${id}`, full, { ttlMs: 30 * DAY });
  ctx.log.warn("security alert", { owner: full.owner, rule: full.rule, subject: full.subject });
  return full;
}

export async function alertsOf(ctx: AppContext, owner: string, limit = 100): Promise<SecurityAlert[]> {
  return (await alerts(ctx).list({ prefix: `${owner.toLowerCase()}:`, limit: 1000 })).map((d) => d.value).reverse().slice(0, limit);
}
