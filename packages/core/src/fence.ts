/**
 * The Fence (`lykia.fence/v1`): the hard limits an owner
 * puts around an agent, or around themselves. Circle's agent wallets cap
 * how much an agent may spend; the Fence decides whether a DeFi move is
 * sane at all: which venues and tokens, how much slippage, which health
 * factor, which FX band, which recipients, which hours, and whether the
 * token passed Scent.
 *
 * Rules of the pasture:
 *  - Fail closed. A rule that needs a fact it does not have denies.
 *    Unpriced is never zero.
 *  - The Whistle (`mode: "whistle"`) stops every new risk, but bringing the
 *    flock home always works: repay, withdraw to the owner, send to the
 *    owner. The same lane ignores caps, schedules and venue lists.
 *  - Agents never move value to a stranger unless the recipient is on the
 *    Fence's allowlist.
 *  - The document is plain typed JSON: no expressions, no code. Its
 *    canonical `sha256:` hash is what a Tag pins on-chain.
 *
 * Pure: no I/O.
 */
import { canonicalDigest, type Sha256Digest } from "./canonical.js";
import { isAddress, type Address } from "./contracts.js";
import { findToken } from "./assets.js";
import { STEP_KINDS, type Signer, type StepKind } from "./intent.js";
import { CCTP_DESTINATIONS, type ArcEnvironment } from "./networks.js";

export const FENCE_SCHEMA = "lykia.fence/v1" as const;

export const FENCE_LIMITS = Object.freeze({
  labelLength: 64,
  listEntries: 100,
  maxSteps: 12,
  maxSlippageBps: 1_000,
  windows: 14,
});

export const USD_PATTERN = /^\d{1,12}(?:\.\d{1,2})?$/u;
export const RATIO_PATTERN = /^\d{1,3}(?:\.\d{1,4})?$/u;

export type FenceMode = "live" | "dry-run" | "whistle";
export type RecipientMode = "own" | "allowlist" | "any";
export type ScentRequirement = "verified" | "no-red-flags" | "off";
export type ConfirmTrigger = "external-recipient" | "cross-chain" | "agent-proposal" | "unlisted-token";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const FENCE_MODES: readonly FenceMode[] = ["live", "dry-run", "whistle"];
export const RECIPIENT_MODES: readonly RecipientMode[] = ["own", "allowlist", "any"];
export const SCENT_REQUIREMENTS: readonly ScentRequirement[] = ["verified", "no-red-flags", "off"];
export const CONFIRM_TRIGGERS: readonly ConfirmTrigger[] = ["external-recipient", "cross-chain", "agent-proposal", "unlisted-token"];
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface ScheduleWindow {
  readonly days: readonly Weekday[];
  /** "HH:MM" inclusive. */
  readonly from: string;
  /** "HH:MM" or "24:00", exclusive. */
  readonly to: string;
}

export interface Fence {
  readonly schema: typeof FENCE_SCHEMA;
  readonly label?: string;
  readonly mode?: FenceMode;
  readonly environments?: readonly ArcEnvironment[];
  readonly kinds?: { readonly allow?: readonly StepKind[] };
  /** Venue ids from the protocol registry. Deny wins. */
  readonly venues?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
  /** Registry symbols. `unlisted: "deny"` refuses every token outside the registry. */
  readonly tokens?: { readonly allow?: readonly string[]; readonly unlisted?: "deny" | "allow" };
  readonly recipients?: { readonly mode?: RecipientMode; readonly allow?: readonly Address[]; readonly deny?: readonly Address[] };
  /** CCTP / Gateway destinations by key ("base", "ethereum"). Absent: every documented one. */
  readonly bridges?: { readonly destinations?: readonly string[] };
  readonly caps?: { readonly perStepUsd?: string; readonly perIntentUsd?: string; readonly dailyUsd?: string; readonly weeklyUsd?: string };
  readonly limits?: { readonly maxSteps?: number; readonly maxSlippageBps?: number };
  /** Lending: the health factor after a borrow or withdraw may not drop below this ("1.5"). */
  readonly lending?: { readonly minHealthFactor?: string };
  /** FX: a USDC/EURC quote may deviate at most this far from the reference rate (Chainlink EURC/USD). */
  readonly fx?: { readonly maxDeviationBps?: number };
  /** Lowest Scent result a token may have to be bought or received. */
  readonly scent?: { readonly require?: ScentRequirement };
  readonly confirm?: { readonly aboveUsd?: string; readonly when?: readonly ConfirmTrigger[] };
  readonly schedule?: { readonly timezone: string; readonly windows: readonly ScheduleWindow[] };
  /** Which signers this Fence admits. */
  readonly signers?: readonly Signer[];
}

export interface FenceIssue {
  readonly path: string;
  readonly message: string;
}

export type FenceValidation = { readonly ok: true; readonly fence: Fence } | { readonly ok: false; readonly issues: readonly FenceIssue[] };

/* ------------------------------------------------------------ helpers */

/** "12.5" USD -> 12_500_000n micro-dollars. */
export function usdMicros(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0");
}

export function formatUsdMicros(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const cents = (abs + 5_000n) / 10_000n;
  return `${negative ? "-" : ""}${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** "1.5" -> 15000n in basis points of 1.0. */
export function ratioBps(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0").slice(0, 4) || "0");
}

export function timeMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0) return 1440;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isSupportedTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------- validation */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TOP_KEYS = new Set(["schema", "label", "mode", "environments", "kinds", "venues", "tokens", "recipients", "bridges", "caps", "limits", "lending", "fx", "scent", "confirm", "schedule", "signers"]);

export function validateFence(input: unknown): FenceValidation {
  const issues: FenceIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(input)) return { ok: false, issues: [{ path: "", message: "A Fence is a JSON object." }] };
  for (const key of Object.keys(input)) if (!TOP_KEYS.has(key)) add(key, "Unknown field.");
  if (input.schema !== FENCE_SCHEMA) add("schema", `Must be "${FENCE_SCHEMA}".`);
  if (input.label !== undefined && (typeof input.label !== "string" || input.label.length > FENCE_LIMITS.labelLength)) add("label", `At most ${FENCE_LIMITS.labelLength} characters.`);
  if (input.mode !== undefined && !FENCE_MODES.includes(input.mode as FenceMode)) add("mode", `One of ${FENCE_MODES.join(", ")}.`);

  const list = (path: string, value: unknown, check: (entry: unknown) => boolean, what: string) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) return add(path, "Must be a list.");
    if (value.length > FENCE_LIMITS.listEntries) add(path, `At most ${FENCE_LIMITS.listEntries} entries.`);
    value.forEach((entry, index) => {
      if (!check(entry)) add(`${path}.${index}`, `Not ${what}.`);
    });
  };
  const section = (key: string, keys: readonly string[]): Record<string, unknown> | null => {
    const value = input[key];
    if (value === undefined) return null;
    if (!isRecord(value)) {
      add(key, "Must be an object.");
      return null;
    }
    for (const k of Object.keys(value)) if (!keys.includes(k)) add(`${key}.${k}`, "Unknown field.");
    return value;
  };
  const usd = (path: string, value: unknown) => {
    if (value !== undefined && (typeof value !== "string" || !USD_PATTERN.test(value))) add(path, 'A USD amount as a string, e.g. "250" or "99.50".');
  };

  list("environments", input.environments, (e) => e === "mainnet" || e === "testnet", "mainnet or testnet");
  const kinds = section("kinds", ["allow"]);
  if (kinds) list("kinds.allow", kinds.allow, (k) => STEP_KINDS.includes(k as StepKind), "a step kind");
  const venues = section("venues", ["allow", "deny"]);
  if (venues) {
    list("venues.allow", venues.allow, (v) => typeof v === "string" && /^[a-z0-9-]{2,48}$/u.test(v), "a venue id");
    list("venues.deny", venues.deny, (v) => typeof v === "string" && /^[a-z0-9-]{2,48}$/u.test(v), "a venue id");
  }
  const tokens = section("tokens", ["allow", "unlisted"]);
  if (tokens) {
    list("tokens.allow", tokens.allow, (t) => typeof t === "string" && findToken("mainnet", t) !== null, "a registry token symbol");
    if (tokens.unlisted !== undefined && tokens.unlisted !== "deny" && tokens.unlisted !== "allow") add("tokens.unlisted", "deny or allow.");
  }
  const recipients = section("recipients", ["mode", "allow", "deny"]);
  if (recipients) {
    if (recipients.mode !== undefined && !RECIPIENT_MODES.includes(recipients.mode as RecipientMode)) add("recipients.mode", `One of ${RECIPIENT_MODES.join(", ")}.`);
    list("recipients.allow", recipients.allow, isAddress, "an address");
    list("recipients.deny", recipients.deny, isAddress, "an address");
  }
  const bridges = section("bridges", ["destinations"]);
  if (bridges) list("bridges.destinations", bridges.destinations, (d) => CCTP_DESTINATIONS.some((c) => c.key === d), "a CCTP destination key");
  const caps = section("caps", ["perStepUsd", "perIntentUsd", "dailyUsd", "weeklyUsd"]);
  if (caps) for (const key of ["perStepUsd", "perIntentUsd", "dailyUsd", "weeklyUsd"]) usd(`caps.${key}`, caps[key]);
  const limits = section("limits", ["maxSteps", "maxSlippageBps"]);
  if (limits) {
    if (limits.maxSteps !== undefined && !(Number.isInteger(limits.maxSteps) && (limits.maxSteps as number) >= 1 && (limits.maxSteps as number) <= FENCE_LIMITS.maxSteps)) add("limits.maxSteps", `1 to ${FENCE_LIMITS.maxSteps}.`);
    if (limits.maxSlippageBps !== undefined && !(Number.isInteger(limits.maxSlippageBps) && (limits.maxSlippageBps as number) >= 0 && (limits.maxSlippageBps as number) <= FENCE_LIMITS.maxSlippageBps)) add("limits.maxSlippageBps", `0 to ${FENCE_LIMITS.maxSlippageBps}.`);
  }
  const lending = section("lending", ["minHealthFactor"]);
  if (lending && lending.minHealthFactor !== undefined) {
    if (typeof lending.minHealthFactor !== "string" || !RATIO_PATTERN.test(lending.minHealthFactor) || ratioBps(lending.minHealthFactor) < 10_000n) add("lending.minHealthFactor", 'A ratio of at least "1.0", e.g. "1.5".');
  }
  const fx = section("fx", ["maxDeviationBps"]);
  if (fx && fx.maxDeviationBps !== undefined && !(Number.isInteger(fx.maxDeviationBps) && (fx.maxDeviationBps as number) >= 0 && (fx.maxDeviationBps as number) <= 1_000)) add("fx.maxDeviationBps", "0 to 1000.");
  const scent = section("scent", ["require"]);
  if (scent && scent.require !== undefined && !SCENT_REQUIREMENTS.includes(scent.require as ScentRequirement)) add("scent.require", `One of ${SCENT_REQUIREMENTS.join(", ")}.`);
  const confirm = section("confirm", ["aboveUsd", "when"]);
  if (confirm) {
    usd("confirm.aboveUsd", confirm.aboveUsd);
    list("confirm.when", confirm.when, (w) => CONFIRM_TRIGGERS.includes(w as ConfirmTrigger), "a confirm trigger");
  }
  const schedule = section("schedule", ["timezone", "windows"]);
  if (schedule) {
    if (!isSupportedTimeZone(schedule.timezone)) add("schedule.timezone", "An IANA time zone, e.g. Europe/Istanbul.");
    if (!Array.isArray(schedule.windows) || schedule.windows.length === 0 || schedule.windows.length > FENCE_LIMITS.windows) add("schedule.windows", `1 to ${FENCE_LIMITS.windows} windows.`);
    else
      schedule.windows.forEach((w, i) => {
        if (!isRecord(w)) return add(`schedule.windows.${i}`, "Must be an object.");
        if (!Array.isArray(w.days) || w.days.length === 0 || !w.days.every((d) => WEEKDAYS.includes(d as Weekday))) add(`schedule.windows.${i}.days`, "Weekdays like mon, tue.");
        const from = typeof w.from === "string" ? timeMinutes(w.from) : null;
        const to = typeof w.to === "string" ? timeMinutes(w.to) : null;
        if (from === null || to === null || from >= to || from === 1440) add(`schedule.windows.${i}`, '"from" before "to", as HH:MM.');
      });
  }
  list("signers", input.signers, (s) => s === "wallet" || s === "agent", "wallet or agent");

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, fence: input as unknown as Fence };
}

/** Canonical hash of a Fence. Defaults are made explicit first, so `{}`-style omissions hash like their defaults. */
export function fenceHash(fence: Fence): Sha256Digest {
  return canonicalDigest(normalizeFence(fence));
}

export function normalizeFence(fence: Fence): Fence {
  return {
    ...fence,
    mode: fence.mode ?? "live",
    tokens: { unlisted: "deny", ...fence.tokens },
    recipients: { mode: "own", ...fence.recipients },
    scent: { require: "no-red-flags", ...fence.scent },
    signers: fence.signers ?? ["wallet", "agent"],
  };
}

/**
 * Which edits make `next` looser than `previous`. A loosening edit needs
 * the owner's wallet, never an agent's; the UI shows these lines.
 */
export function loosenedRules(previous: Fence, next: Fence): string[] {
  const a = normalizeFence(previous);
  const b = normalizeFence(next);
  const out: string[] = [];
  const looserCap = (label: string, x?: string, y?: string) => {
    if (x !== undefined && (y === undefined || usdMicros(y) > usdMicros(x))) out.push(`${label} raised${y ? ` to $${y}` : " (removed)"}`);
  };
  if (a.mode === "whistle" && b.mode !== "whistle") out.push("Whistle released");
  if (a.mode === "dry-run" && b.mode === "live") out.push("Dry-run turned off");
  looserCap("Per-step cap", a.caps?.perStepUsd, b.caps?.perStepUsd);
  looserCap("Per-intent cap", a.caps?.perIntentUsd, b.caps?.perIntentUsd);
  looserCap("Daily cap", a.caps?.dailyUsd, b.caps?.dailyUsd);
  looserCap("Weekly cap", a.caps?.weeklyUsd, b.caps?.weeklyUsd);
  if ((a.limits?.maxSlippageBps ?? 0) < (b.limits?.maxSlippageBps ?? Infinity) && a.limits?.maxSlippageBps !== undefined) out.push("Slippage limit raised");
  if (a.lending?.minHealthFactor && (!b.lending?.minHealthFactor || ratioBps(b.lending.minHealthFactor) < ratioBps(a.lending.minHealthFactor))) out.push("Minimum health factor lowered");
  if (a.fx?.maxDeviationBps !== undefined && (b.fx?.maxDeviationBps === undefined || b.fx.maxDeviationBps > a.fx.maxDeviationBps)) out.push("FX band widened");
  const order: RecipientMode[] = ["own", "allowlist", "any"];
  if (order.indexOf(b.recipients?.mode ?? "own") > order.indexOf(a.recipients?.mode ?? "own")) out.push(`Recipients opened to ${b.recipients?.mode}`);
  const added = (label: string, x?: readonly string[], y?: readonly string[]) => {
    if (x === undefined) return;
    if (y === undefined) return out.push(`${label} list removed`);
    const more = y.filter((v) => !x.map((s) => s.toLowerCase()).includes(v.toLowerCase()));
    if (more.length > 0) out.push(`${label} added: ${more.join(", ")}`);
  };
  added("Venues", a.venues?.allow, b.venues?.allow);
  added("Tokens", a.tokens?.allow, b.tokens?.allow);
  added("Recipients", a.recipients?.allow, b.recipients?.allow);
  added("Step kinds", a.kinds?.allow, b.kinds?.allow);
  added("Bridge destinations", a.bridges?.destinations, b.bridges?.destinations);
  if ((a.venues?.deny ?? []).some((v) => !(b.venues?.deny ?? []).includes(v))) out.push("Venue taken off the deny list");
  if (a.tokens?.unlisted === "deny" && b.tokens?.unlisted === "allow") out.push("Unlisted tokens allowed");
  const scentOrder: ScentRequirement[] = ["verified", "no-red-flags", "off"];
  if (scentOrder.indexOf(b.scent?.require ?? "no-red-flags") > scentOrder.indexOf(a.scent?.require ?? "no-red-flags")) out.push(`Scent requirement relaxed to ${b.scent?.require}`);
  if (a.schedule && !b.schedule) out.push("Schedule removed");
  if (!(a.signers ?? []).includes("agent") && (b.signers ?? []).includes("agent")) out.push("Agents admitted");
  return out;
}

/* ------------------------------------------------------------ defaults */

function frozen<T>(value: T): T {
  return Object.freeze(value);
}

/** The shepherd's default: careful, agents welcome, strangers not. */
export const DEFAULT_FENCE: Fence = frozen({
  schema: FENCE_SCHEMA,
  label: "Shepherd",
  mode: "live",
  tokens: { unlisted: "deny" },
  recipients: { mode: "own" },
  caps: { perStepUsd: "1000", perIntentUsd: "2500", dailyUsd: "5000" },
  limits: { maxSteps: 8, maxSlippageBps: 100 },
  lending: { minHealthFactor: "1.5" },
  fx: { maxDeviationBps: 50 },
  scent: { require: "no-red-flags" },
  confirm: { aboveUsd: "500", when: ["external-recipient", "cross-chain", "agent-proposal"] },
  signers: ["wallet", "agent"],
} satisfies Fence);

export type FenceTemplateKey = "lamb" | "shepherd" | "treasury" | "caravan";

export const FENCE_TEMPLATES: Readonly<Record<FenceTemplateKey, Fence>> = frozen({
  /** Lamb: watch and learn. Plans everything, signs nothing. */
  lamb: frozen({ schema: FENCE_SCHEMA, label: "Lamb", mode: "dry-run", tokens: { unlisted: "deny" }, recipients: { mode: "own" }, scent: { require: "verified" }, signers: ["wallet"] } satisfies Fence),
  /** Shepherd: the default. */
  shepherd: DEFAULT_FENCE,
  /** Treasury: a business treasury. Stablecoins only, named payees, office hours, tight FX band. */
  treasury: frozen({
    schema: FENCE_SCHEMA,
    label: "Treasury",
    mode: "live",
    kinds: { allow: ["approve", "transfer", "fx", "deposit", "withdraw", "supply", "bridge", "gateway-deposit", "attest"] },
    tokens: { allow: ["USDC", "EURC"], unlisted: "deny" },
    recipients: { mode: "allowlist", allow: [] },
    caps: { perStepUsd: "25000", perIntentUsd: "50000", dailyUsd: "100000" },
    limits: { maxSteps: 12, maxSlippageBps: 20 },
    fx: { maxDeviationBps: 25 },
    scent: { require: "verified" },
    confirm: { aboveUsd: "10000", when: ["external-recipient", "cross-chain", "agent-proposal"] },
    schedule: { timezone: "Europe/Istanbul", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], from: "09:00", to: "18:00" }] },
    signers: ["wallet", "agent"],
  } satisfies Fence),
  /** Caravan: an autonomous agent paying for services. Small caps, no lending, no bridges. */
  caravan: frozen({
    schema: FENCE_SCHEMA,
    label: "Caravan",
    mode: "live",
    kinds: { allow: ["approve", "transfer", "swap", "fx", "deposit", "withdraw", "attest"] },
    tokens: { allow: ["USDC", "EURC"], unlisted: "deny" },
    recipients: { mode: "allowlist", allow: [] },
    caps: { perStepUsd: "50", perIntentUsd: "100", dailyUsd: "250", weeklyUsd: "1000" },
    limits: { maxSteps: 4, maxSlippageBps: 50 },
    scent: { require: "verified" },
    confirm: { when: ["cross-chain"] },
    signers: ["agent"],
  } satisfies Fence),
});
