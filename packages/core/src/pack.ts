/**
 * The Pack: Lykia's agent tree. Lyko is the orchestrator at the root; an
 * owner creates agents with a role and a Fence, and an agent may spawn
 * sub-agents. Two invariants hold for every edge of the tree:
 *
 *  1. A child's Fence is inside its parent's (`isSubFence`): every limit is
 *     equal or tighter, every list a subset, every requirement equal or
 *     stricter. A sub-agent can never do what its parent may not.
 *  2. A child's budget is carved from its parent's: the caps a child holds
 *     are reserved out of the parent's caps, so the sum of the children can
 *     never exceed the parent (`carveBudget`). Spending counts against the
 *     agent and every ancestor.
 *
 * Revoking an agent revokes its whole subtree. Pure: no I/O.
 */
import { canonicalDigest, type Sha256Digest } from "./canonical.js";
import type { Address } from "./contracts.js";
import {
  DEFAULT_FENCE,
  FENCE_SCHEMA,
  FENCE_TEMPLATES,
  formatUsdMicros,
  normalizeFence,
  ratioBps,
  timeMinutes,
  usdMicros,
  type ConfirmTrigger,
  type Fence,
  type FenceMode,
  type RecipientMode,
  type ScentRequirement,
  type ScheduleWindow,
} from "./fence.js";
import type { Signer, StepKind } from "./intent.js";
import type { ArcEnvironment } from "./networks.js";

import { tx, phrase } from "./i18n/index.js";
export const PACK_SCHEMA = "lykia.pack/v1" as const;
export const MAX_PACK_DEPTH = 4;
export const MAX_CHILDREN = 16;

export type PackRole = "orchestrator" | "treasurer" | "payroll" | "fx-hedger" | "yield-keeper" | "bill-payer" | "sentinel" | "researcher" | "custom";

export const PACK_ROLES: readonly PackRole[] = ["orchestrator", "treasurer", "payroll", "fx-hedger", "yield-keeper", "bill-payer", "sentinel", "researcher", "custom"];

/** What an agent may do beyond moving value. */
export type PackCapability = "read" | "propose" | "whistle" | "spawn";

export type PackAgentStatus = "active" | "paused" | "revoked";

export interface PackBudget {
  readonly perIntentUsd?: string;
  readonly dailyUsd?: string;
  readonly weeklyUsd?: string;
}

export interface PackAgent {
  readonly schema: typeof PACK_SCHEMA;
  readonly id: string;
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  /** null for a root agent (child of the owner / Lyko). */
  readonly parentId: string | null;
  readonly depth: number;
  readonly name: string;
  readonly role: PackRole;
  readonly capabilities: readonly PackCapability[];
  readonly fence: Fence;
  readonly fenceHash: Sha256Digest;
  /** ERC-8004 agent id when the agent has a Tag. */
  readonly agentId?: string;
  /** The address that signs for the agent (an agent wallet or a LykiaAccount session key). */
  readonly signer?: Address;
  /** On-chain session bound to the agent, once the owner created it. */
  readonly session?: { readonly account: Address; readonly sessionId: string; readonly txHash?: `0x${string}` };
  readonly status: PackAgentStatus;
  readonly createdAt: string;
  readonly revokedAt?: string;
  readonly mission?: string;
}

/* --------------------------------------------------------------- roles */

export interface RoleTemplate {
  readonly role: PackRole;
  readonly title: { readonly en: string };
  readonly summary: string;
  readonly capabilities: readonly PackCapability[];
  readonly fence: Fence;
}

const base = (label: string, extra: Omit<Fence, "schema" | "label">): Fence => Object.freeze({ schema: FENCE_SCHEMA, label, ...extra });
const withoutSchedule = (fence: Fence): Fence => {
  const { schedule: _hours, ...rest } = fence;
  return Object.freeze(rest);
};

/** Role templates, derived from the core Fence templates and tightened for the job. */
export const ROLE_TEMPLATES: Readonly<Record<Exclude<PackRole, "custom">, RoleTemplate>> = Object.freeze({
  orchestrator: {
    role: "orchestrator",
    title: { en: phrase("Lyko (orchestrator)") },
    summary: phrase("Breaks a goal into tasks, hands them to specialists and merges their proposals. Never signs."),
    capabilities: ["read", "propose", "spawn"],
    fence: DEFAULT_FENCE,
  },
  treasurer: {
    role: "treasurer",
    title: { en: phrase("Treasurer") },
    summary: phrase("Keeps the stablecoin treasury: payees, FX, vaults and bridges."),
    capabilities: ["read", "propose", "spawn"],
    // No office hours: the role answers its owner's requests whenever they come, in any time zone. An owner who
    // wants hours adds them to the agent's own Fence.
    fence: withoutSchedule(FENCE_TEMPLATES.treasury),
  },
  payroll: {
    role: "payroll",
    title: { en: phrase("Payroll") },
    summary: phrase("Pays named people in USDC or EURC with an invoice memo. Nothing else."),
    capabilities: ["read", "propose"],
    fence: base(phrase("Payroll"), {
      mode: "live",
      kinds: { allow: ["approve", "transfer", "fx"] },
      tokens: { allow: ["USDC", "EURC"], unlisted: "deny" },
      recipients: { mode: "allowlist", allow: [] },
      caps: { perStepUsd: "10000", perIntentUsd: "50000", dailyUsd: "50000" },
      limits: { maxSteps: 12, maxSlippageBps: 20 },
      fx: { maxDeviationBps: 25 },
      scent: { require: "verified" },
      confirm: { aboveUsd: "5000", when: ["external-recipient", "agent-proposal"] },
      signers: ["wallet", "agent"],
    }),
  },
  "fx-hedger": {
    role: "fx-hedger",
    title: { en: phrase("FX hedger") },
    summary: phrase("Keeps the USDC/EURC mix on target with a tight band around the Chainlink reference rate."),
    capabilities: ["read", "propose"],
    fence: base(phrase("FX hedger"), {
      mode: "live",
      kinds: { allow: ["approve", "fx", "swap"] },
      tokens: { allow: ["USDC", "EURC"], unlisted: "deny" },
      recipients: { mode: "own" },
      caps: { perStepUsd: "5000", perIntentUsd: "10000", dailyUsd: "20000" },
      limits: { maxSteps: 4, maxSlippageBps: 30 },
      fx: { maxDeviationBps: 25 },
      scent: { require: "verified" },
      confirm: { aboveUsd: "5000", when: ["agent-proposal"] },
      signers: ["wallet", "agent"],
    }),
  },
  "yield-keeper": {
    role: "yield-keeper",
    title: { en: phrase("Yield keeper") },
    summary: phrase("Moves idle stablecoins into vaults and back, never below the liquid floor the owner sets."),
    capabilities: ["read", "propose"],
    fence: base(phrase("Yield keeper"), {
      mode: "live",
      kinds: { allow: ["approve", "deposit", "withdraw", "supply"] },
      tokens: { allow: ["USDC", "EURC"], unlisted: "deny" },
      recipients: { mode: "own" },
      caps: { perStepUsd: "10000", perIntentUsd: "20000", dailyUsd: "50000" },
      limits: { maxSteps: 6, maxSlippageBps: 10 },
      scent: { require: "verified" },
      confirm: { aboveUsd: "10000", when: ["agent-proposal"] },
      signers: ["wallet", "agent"],
    }),
  },
  "bill-payer": {
    role: "bill-payer",
    title: { en: phrase("Bill payer") },
    summary: phrase("Pays recurring bills to known payees. Small caps, no FX, no bridges."),
    capabilities: ["read", "propose"],
    fence: base(phrase("Bill payer"), {
      mode: "live",
      kinds: { allow: ["approve", "transfer"] },
      tokens: { allow: ["USDC"], unlisted: "deny" },
      recipients: { mode: "allowlist", allow: [] },
      caps: { perStepUsd: "500", perIntentUsd: "1000", dailyUsd: "2000", weeklyUsd: "5000" },
      limits: { maxSteps: 4, maxSlippageBps: 0 },
      scent: { require: "verified" },
      confirm: { when: ["external-recipient"] },
      signers: ["agent"],
    }),
  },
  sentinel: {
    role: "sentinel",
    title: { en: phrase("Sentinel") },
    summary: phrase("Watches Scent, health factors and the pulse. Can blow the whistle; cannot move value."),
    capabilities: ["read", "whistle"],
    fence: base(phrase("Sentinel"), { mode: "dry-run", kinds: { allow: [] }, tokens: { allow: [], unlisted: "deny" }, recipients: { mode: "own" }, scent: { require: "verified" }, signers: ["agent"] }),
  },
  researcher: {
    role: "researcher",
    title: { en: phrase("Researcher") },
    summary: phrase("Reads venues, quotes, prices and Scent; drafts dry-run plans for the others."),
    capabilities: ["read", "propose"],
    fence: base(phrase("Researcher"), { mode: "dry-run", tokens: { unlisted: "deny" }, recipients: { mode: "own" }, scent: { require: "verified" }, signers: ["agent"] }),
  },
});

export function roleTemplate(role: PackRole): RoleTemplate | null {
  return role === "custom" ? null : ROLE_TEMPLATES[role];
}

/* ---------------------------------------------------------- isSubFence */

export interface SubFenceViolation {
  readonly path: string;
  readonly message: string;
}

const MODE_ALLOWED: Readonly<Record<FenceMode, readonly FenceMode[]>> = {
  live: ["live", "dry-run", "whistle"],
  // A whistle child could still sign homeward moves; under a dry-run parent nothing may sign.
  "dry-run": ["dry-run"],
  whistle: ["whistle", "dry-run"],
};
const RECIPIENT_RANK: Readonly<Record<RecipientMode, number>> = { own: 0, allowlist: 1, any: 2 };
const SCENT_RANK: Readonly<Record<ScentRequirement, number>> = { verified: 0, "no-red-flags": 1, off: 2 };
const lower = (values: readonly string[]) => values.map((v) => v.toLowerCase());

function windowInside(child: ScheduleWindow, parent: ScheduleWindow): boolean {
  const cf = timeMinutes(child.from);
  const ct = timeMinutes(child.to);
  const pf = timeMinutes(parent.from);
  const pt = timeMinutes(parent.to);
  if (cf === null || ct === null || pf === null || pt === null) return false;
  return child.days.every((d) => parent.days.includes(d)) && cf >= pf && ct <= pt;
}

/**
 * Whether `child` is inside `parent`. Absent lists mean "everything", so a
 * child may only omit a list the parent omits too. Equal is allowed: a
 * sub-agent may inherit its parent's Fence unchanged.
 */
export function subFenceViolations(parentInput: Fence, childInput: Fence): SubFenceViolation[] {
  const p = normalizeFence(parentInput);
  const c = normalizeFence(childInput);
  const out: SubFenceViolation[] = [];
  const add = (path: string, message: string) => out.push({ path, message });

  if (c.schema !== p.schema) add("schema", tx("Schemas differ."));
  const pm = p.mode ?? "live";
  const cm = c.mode ?? "live";
  if (!MODE_ALLOWED[pm].includes(cm)) add("mode", tx("A {pm} parent cannot have a {cm} child.", { pm, cm }));

  const subset = (path: string, parent: readonly string[] | undefined, child: readonly string[] | undefined, caseless = true) => {
    if (parent === undefined) return;
    if (child === undefined) return add(path, tx("The parent limits this list; the child must too."));
    const pl = caseless ? lower(parent) : [...parent];
    const extra = child.filter((v) => !pl.includes(caseless ? v.toLowerCase() : v));
    if (extra.length > 0) add(path, tx("Not allowed by the parent: {value}.", { value: extra.join(", ") }));
  };
  const superset = (path: string, parent: readonly string[] | undefined, child: readonly string[] | undefined) => {
    if (!parent || parent.length === 0) return;
    const cl = lower(child ?? []);
    const missing = parent.filter((v) => !cl.includes(v.toLowerCase()));
    if (missing.length > 0) add(path, tx("The child must keep the parent's entries: {value}.", { value: missing.join(", ") }));
  };

  subset("environments", p.environments, c.environments);
  subset("kinds.allow", p.kinds?.allow, c.kinds?.allow);
  subset("venues.allow", p.venues?.allow, c.venues?.allow);
  superset("venues.deny", p.venues?.deny, c.venues?.deny);
  subset("tokens.allow", p.tokens?.allow, c.tokens?.allow);
  if (p.tokens?.unlisted === "deny" && c.tokens?.unlisted !== "deny") add("tokens.unlisted", tx("The parent denies unlisted tokens."));

  const prm = p.recipients?.mode ?? "own";
  const crm = c.recipients?.mode ?? "own";
  if (RECIPIENT_RANK[crm] > RECIPIENT_RANK[prm]) add("recipients.mode", tx("A {prm} parent cannot have a {crm} child.", { prm, crm }));
  if (prm !== "any" && crm !== "own") subset("recipients.allow", p.recipients?.allow ?? [], c.recipients?.allow ?? []);
  superset("recipients.deny", p.recipients?.deny, c.recipients?.deny);
  subset("bridges.destinations", p.bridges?.destinations, c.bridges?.destinations);

  for (const key of ["perStepUsd", "perIntentUsd", "dailyUsd", "weeklyUsd"] as const) {
    const pv = p.caps?.[key];
    const cv = c.caps?.[key];
    if (pv === undefined) continue;
    if (cv === undefined) add(`caps.${key}`, tx("The parent caps this at ${pv}; the child must set a cap too.", { pv }));
    else if (usdMicros(cv) > usdMicros(pv)) add(`caps.${key}`, tx("${cv} is above the parent's ${pv}.", { cv, pv }));
  }
  for (const key of ["maxSteps", "maxSlippageBps"] as const) {
    const pv = p.limits?.[key];
    const cv = c.limits?.[key];
    if (pv === undefined) continue;
    if (cv === undefined) add(`limits.${key}`, tx("The parent limits this to {pv}; the child must too.", { pv }));
    else if (cv > pv) add(`limits.${key}`, tx("{cv} is above the parent's {pv}.", { cv, pv }));
  }
  if (p.lending?.minHealthFactor) {
    const cv = c.lending?.minHealthFactor;
    if (!cv) add("lending.minHealthFactor", tx("The parent keeps health above {minHealthFactor}; the child must too.", { minHealthFactor: p.lending.minHealthFactor }));
    else if (ratioBps(cv) < ratioBps(p.lending.minHealthFactor)) add("lending.minHealthFactor", tx("{cv} is below the parent's {minHealthFactor}.", { cv, minHealthFactor: p.lending.minHealthFactor }));
  }
  if (p.fx?.maxDeviationBps !== undefined) {
    const cv = c.fx?.maxDeviationBps;
    if (cv === undefined) add("fx.maxDeviationBps", tx("The parent sets an FX band; the child must too."));
    else if (cv > p.fx.maxDeviationBps) add("fx.maxDeviationBps", tx("{cv} bps is wider than the parent's {maxDeviationBps} bps.", { cv, maxDeviationBps: p.fx.maxDeviationBps }));
  }
  const ps = p.scent?.require ?? "no-red-flags";
  const cs = c.scent?.require ?? "no-red-flags";
  if (SCENT_RANK[cs] > SCENT_RANK[ps]) add("scent.require", tx("\"{cs}\" is looser than the parent's \"{ps}\".", { cs, ps }));

  if (p.confirm?.aboveUsd !== undefined) {
    const cv = c.confirm?.aboveUsd;
    if (cv === undefined || usdMicros(cv) > usdMicros(p.confirm.aboveUsd)) add("confirm.aboveUsd", tx("The child must confirm at ${aboveUsd} or less.", { aboveUsd: p.confirm.aboveUsd }));
  }
  superset("confirm.when", p.confirm?.when, c.confirm?.when);

  if (p.schedule) {
    if (!c.schedule) add("schedule", tx("The parent keeps hours; the child must too."));
    else if (c.schedule.timezone !== p.schedule.timezone) add("schedule.timezone", tx("Use the parent's time zone ({timezone}).", { timezone: p.schedule.timezone }));
    else
      c.schedule.windows.forEach((w, i) => {
        if (!p.schedule?.windows.some((pw) => windowInside(w, pw))) add(`schedule.windows.${i}`, tx("This window is outside the parent's hours."));
      });
  }
  subset("signers", p.signers, c.signers, false);
  return out;
}

export function isSubFence(parent: Fence, child: Fence): boolean {
  return subFenceViolations(parent, child).length === 0;
}

/* ------------------------------------------------------- intersectFence */

const minUsd = (a?: string, b?: string) => (a === undefined ? b : b === undefined ? a : usdMicros(a) <= usdMicros(b) ? a : b);
const minNum = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
function meet<T extends string>(a: readonly T[] | undefined, b: readonly T[] | undefined, caseless = true): readonly T[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const bl = caseless ? lower(b) : [...b];
  return a.filter((v) => bl.includes(caseless ? v.toLowerCase() : v));
}
function join<T extends string>(a: readonly T[] | undefined, b: readonly T[] | undefined): readonly T[] | undefined {
  if (!a && !b) return undefined;
  const out = [...(a ?? [])];
  for (const v of b ?? []) if (!lower(out).includes(v.toLowerCase())) out.push(v);
  return out;
}

/**
 * The tightest reading of two Fences: a Fence inside both. Used to shape a
 * sub-agent from a role template under a parent (`intersectFence(parent, template)`).
 */
export function intersectFence(a: Fence, b: Fence, label?: string): Fence {
  const x = normalizeFence(a);
  const y = normalizeFence(b);
  const modeOf = (m1: FenceMode, m2: FenceMode): FenceMode => (m1 === "dry-run" || m2 === "dry-run" ? "dry-run" : m1 === "whistle" || m2 === "whistle" ? "whistle" : "live");
  const rm = (RECIPIENT_RANK[x.recipients?.mode ?? "own"] <= RECIPIENT_RANK[y.recipients?.mode ?? "own"] ? x.recipients?.mode : y.recipients?.mode) ?? "own";
  const recipientsAllow = (() => {
    const xa = (x.recipients?.mode ?? "own") === "any" ? undefined : x.recipients?.allow ?? [];
    const ya = (y.recipients?.mode ?? "own") === "any" ? undefined : y.recipients?.allow ?? [];
    return meet(xa, ya) as readonly Address[] | undefined;
  })();
  const scent = SCENT_RANK[x.scent?.require ?? "no-red-flags"] <= SCENT_RANK[y.scent?.require ?? "no-red-flags"] ? x.scent?.require : y.scent?.require;
  const hf = (() => {
    const p = x.lending?.minHealthFactor;
    const q = y.lending?.minHealthFactor;
    if (!p) return q;
    if (!q) return p;
    return ratioBps(p) >= ratioBps(q) ? p : q;
  })();
  const schedule = (() => {
    if (!x.schedule) return y.schedule;
    if (!y.schedule) return x.schedule;
    if (x.schedule.timezone !== y.schedule.timezone) return x.schedule;
    const windows: ScheduleWindow[] = [];
    for (const wx of x.schedule.windows)
      for (const wy of y.schedule.windows) {
        const days = wx.days.filter((d) => wy.days.includes(d));
        const from = Math.max(timeMinutes(wx.from) ?? 0, timeMinutes(wy.from) ?? 0);
        const to = Math.min(timeMinutes(wx.to) ?? 0, timeMinutes(wy.to) ?? 0);
        if (days.length > 0 && from < to) windows.push({ days, from: hhmm(from), to: hhmm(to) });
      }
    return windows.length > 0 ? { timezone: x.schedule.timezone, windows } : x.schedule;
  })();
  const caps = {
    perStepUsd: minUsd(x.caps?.perStepUsd, y.caps?.perStepUsd),
    perIntentUsd: minUsd(x.caps?.perIntentUsd, y.caps?.perIntentUsd),
    dailyUsd: minUsd(x.caps?.dailyUsd, y.caps?.dailyUsd),
    weeklyUsd: minUsd(x.caps?.weeklyUsd, y.caps?.weeklyUsd),
  };
  const limits = { maxSteps: minNum(x.limits?.maxSteps, y.limits?.maxSteps), maxSlippageBps: minNum(x.limits?.maxSlippageBps, y.limits?.maxSlippageBps) };
  const fxBand = minNum(x.fx?.maxDeviationBps, y.fx?.maxDeviationBps);
  const confirmAbove = minUsd(x.confirm?.aboveUsd, y.confirm?.aboveUsd);
  const confirmWhen = join<ConfirmTrigger>(x.confirm?.when, y.confirm?.when);
  const fence: Fence = {
    schema: FENCE_SCHEMA,
    label: label ?? y.label ?? x.label ?? "Sub-agent",
    mode: modeOf(x.mode ?? "live", y.mode ?? "live"),
    ...(meet(x.environments, y.environments) ? { environments: meet(x.environments, y.environments) as readonly ArcEnvironment[] } : {}),
    ...(meet(x.kinds?.allow, y.kinds?.allow) ? { kinds: { allow: meet(x.kinds?.allow, y.kinds?.allow) as readonly StepKind[] } } : {}),
    venues: dropEmpty({ allow: meet(x.venues?.allow, y.venues?.allow), deny: join(x.venues?.deny, y.venues?.deny) }),
    tokens: { ...(meet(x.tokens?.allow, y.tokens?.allow) ? { allow: meet(x.tokens?.allow, y.tokens?.allow) } : {}), unlisted: x.tokens?.unlisted === "deny" || y.tokens?.unlisted === "deny" ? "deny" : "allow" },
    recipients: { mode: rm, ...(rm !== "own" && recipientsAllow ? { allow: recipientsAllow } : {}), ...(join(x.recipients?.deny, y.recipients?.deny) ? { deny: join(x.recipients?.deny, y.recipients?.deny) as readonly Address[] } : {}) },
    ...(meet(x.bridges?.destinations, y.bridges?.destinations) ? { bridges: { destinations: meet(x.bridges?.destinations, y.bridges?.destinations) as readonly string[] } } : {}),
    caps: dropEmpty(caps),
    limits: dropEmpty(limits),
    ...(hf ? { lending: { minHealthFactor: hf } } : {}),
    ...(fxBand !== undefined ? { fx: { maxDeviationBps: fxBand } } : {}),
    scent: { require: scent ?? "no-red-flags" },
    ...(confirmAbove !== undefined || confirmWhen ? { confirm: dropEmpty({ aboveUsd: confirmAbove, when: confirmWhen }) } : {}),
    ...(schedule ? { schedule } : {}),
    signers: (meet<Signer>(x.signers, y.signers, false) ?? ["wallet", "agent"]) as readonly Signer[],
  };
  return stripEmptySections(fence);
}

function hhmm(minutes: number): string {
  if (minutes >= 1440) return "24:00";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function dropEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function stripEmptySections(fence: Fence): Fence {
  const out: Record<string, unknown> = { ...fence };
  for (const key of ["venues", "caps", "limits", "confirm"]) {
    const v = out[key];
    if (v && typeof v === "object" && Object.keys(v).length === 0) delete out[key];
  }
  return out as unknown as Fence;
}

/* -------------------------------------------------------------- budgets */

export interface BudgetLedger {
  /** Caps the agent holds (from its Fence). */
  readonly caps: PackBudget;
  /** Sum of what direct children hold, per window. */
  readonly allocated: PackBudget;
}

export interface CarveResult {
  readonly ok: boolean;
  readonly violations: readonly SubFenceViolation[];
  /** Parent's free budget after the carve. */
  readonly remaining: PackBudget;
}

const BUDGET_KEYS = ["perIntentUsd", "dailyUsd", "weeklyUsd"] as const;

export function budgetOf(fence: Fence): PackBudget {
  return dropEmpty({ perIntentUsd: fence.caps?.perIntentUsd, dailyUsd: fence.caps?.dailyUsd, weeklyUsd: fence.caps?.weeklyUsd });
}

/** Free budget of a parent: caps minus what children hold (per-intent is a ceiling, not a pool). */
export function freeBudget(ledger: BudgetLedger): PackBudget {
  const out: Record<string, string> = {};
  for (const key of BUDGET_KEYS) {
    const cap = ledger.caps[key];
    if (cap === undefined) continue;
    if (key === "perIntentUsd") out[key] = cap;
    else out[key] = formatUsdMicros(maxZero(usdMicros(cap) - usdMicros(ledger.allocated[key] ?? "0")));
  }
  return out;
}

function maxZero(v: bigint): bigint {
  return v < 0n ? 0n : v;
}

/**
 * Reserves a child's budget out of its parent's. A parent with a daily cap
 * forces every child to hold a daily cap no larger than what is free.
 */
export function carveBudget(parent: BudgetLedger, child: PackBudget): CarveResult {
  const free = freeBudget(parent);
  const violations: SubFenceViolation[] = [];
  for (const key of BUDGET_KEYS) {
    const available = free[key];
    if (available === undefined) continue;
    const want = child[key];
    if (want === undefined) violations.push({ path: `caps.${key}`, message: tx("The parent's budget is capped; give the child a {key} cap (at most ${available}).", { key, available }) });
    else if (usdMicros(want) > usdMicros(available)) violations.push({ path: `caps.${key}`, message: tx("${want} is more than the parent has free (${available}).", { want, available }) });
  }
  if (violations.length > 0) return { ok: false, violations, remaining: free };
  const allocated: Record<string, string> = { ...parent.allocated } as Record<string, string>;
  for (const key of ["dailyUsd", "weeklyUsd"] as const) {
    if (child[key] !== undefined) allocated[key] = formatUsdMicros(usdMicros(parent.allocated[key] ?? "0") + usdMicros(child[key] as string));
  }
  return { ok: true, violations: [], remaining: freeBudget({ caps: parent.caps, allocated }) };
}

export function addBudget(a: PackBudget, b: PackBudget, sign: 1 | -1 = 1): PackBudget {
  const out: Record<string, string> = {};
  for (const key of ["dailyUsd", "weeklyUsd"] as const) {
    if (a[key] === undefined && b[key] === undefined) continue;
    out[key] = formatUsdMicros(maxZero(usdMicros(a[key] ?? "0") + BigInt(sign) * usdMicros(b[key] ?? "0")));
  }
  return out;
}

/* ----------------------------------------------------------- tree tools */

/** Ids of the agent and every descendant (revocation cascades along this). */
export function subtreeIds(agents: readonly Pick<PackAgent, "id" | "parentId">[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const a of agents) if (a.parentId) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a.id]);
  const out: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    out.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Ancestors from the parent up to the root. */
export function ancestorIds(agents: readonly Pick<PackAgent, "id" | "parentId">[], id: string): string[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const out: string[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current && !out.includes(current)) {
    out.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return out;
}

export function packAgentDigest(agent: Pick<PackAgent, "id" | "owner" | "parentId" | "role" | "fenceHash">): Sha256Digest {
  return canonicalDigest({ schema: PACK_SCHEMA, id: agent.id, owner: agent.owner.toLowerCase(), parentId: agent.parentId, role: agent.role, fenceHash: agent.fenceHash });
}

/* ------------------------------------------------- on-chain session limits */

/**
 * The limits a LykiaAccount session carries for an agent, derived from its
 * Fence: USDC units (6 decimals) per transaction and per day, the expiry,
 * and the Fence hash the account records next to the session.
 */
export interface SessionLimits {
  readonly fenceHash: Sha256Digest;
  readonly maxPerTxUnits: string;
  readonly maxPerDayUnits: string;
  readonly expiresAt: number;
  readonly whistle: boolean;
}

export function sessionLimitsOf(fence: Fence, expiresAt: number, hash: Sha256Digest): SessionLimits {
  const toUnits = (usd: string | undefined) => (usd === undefined ? "0" : (usdMicros(usd)).toString());
  const perTx = fence.caps?.perStepUsd ?? fence.caps?.perIntentUsd;
  return { fenceHash: hash, maxPerTxUnits: toUnits(perTx), maxPerDayUnits: toUnits(fence.caps?.dailyUsd ?? fence.caps?.weeklyUsd ?? perTx), expiresAt, whistle: fence.mode === "whistle" };
}
