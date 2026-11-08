/**
 * Leash (`lykia.leash/v1`): a budget an outside agent cannot exceed.
 *
 * One object says: this agent may spend up to $X per step and $Y a day,
 * $Z in total, until a date, only on these venues and recipients, with this
 * slippage, and the owner can cut it off at once. It is built from pieces
 * Lykia already has:
 *
 *  - a Pack agent whose Fence is a strict subset of its parent's
 *    (`intersectFence` + `subFenceViolations`), with its budget carved from
 *    the parent's (`carveBudget`);
 *  - a LykiaAccount session (`createSession` from the owner, or
 *    `createSubSession` from a parent agent's session key) carrying per-token
 *    caps, the payee allowlist, call rules, an expiry and the Fence hash;
 *  - an API key that works for this one leash and nothing else;
 *  - optionally an ERC-8004 Tag pinning the Fence.
 *
 * What the chain enforces and what the API enforces are kept apart on
 * purpose (see `LEASH_ENFORCEMENT` and docs/leash.md): LykiaAccount counts
 * token units, not dollars, and knows nothing about slippage or venues.
 *
 * Pure: no I/O.
 */
import { FENCE_SCHEMA, formatUsdMicros, usdMicros, USD_PATTERN, validateFence, type Fence } from "./fence.js";
import { isAddress, type Address } from "./contracts.js";
import type { StepKind } from "./intent.js";
import type { ArcEnvironment } from "./networks.js";
import type { Sha256Digest } from "./canonical.js";

export const LEASH_SCHEMA = "lykia.leash/v1" as const;

export const LEASH_LIMITS = Object.freeze({
  nameLength: 48,
  missionLength: 400,
  recipients: 25,
  minHours: 1,
  maxDays: 90,
  /** Active leashes per owner. */
  perOwner: 25,
  defaultMaxCalls: 200,
  maxCalls: 10_000,
  maxSlippageBps: 300,
});

export type LeashTemplateKey = "pay-invoices" | "trade-small" | "earn" | "custom";
export const LEASH_TEMPLATE_KEYS: readonly LeashTemplateKey[] = ["pay-invoices", "trade-small", "earn", "custom"];

/**
 * pending: created, waiting for the session transaction to land on chain.
 * active: the session exists on chain and the key works.
 * revoked / expired: the key is dead at the API; budget is back with the parent.
 */
export type LeashStatus = "pending" | "active" | "revoked" | "expired";

/** What a leash key may call (REST and MCP). Always at least plan, submit and status. */
export type LeashTool = "plan" | "submit" | "status" | "trail" | "venues" | "scent";
export const LEASH_TOOLS: readonly LeashTool[] = ["plan", "submit", "status", "trail", "venues", "scent"];
export const LEASH_REQUIRED_TOOLS: readonly LeashTool[] = ["plan", "submit", "status"];

export interface LeashBudget {
  /** Largest single step, USD. */
  readonly perStepUsd: string;
  /** Rolling day, USD. */
  readonly perDayUsd: string;
  /** Over the leash's whole life, USD. */
  readonly totalUsd: string;
}

export interface LeashTemplate {
  readonly key: LeashTemplateKey;
  readonly title: string;
  readonly summary: string;
  readonly kinds: readonly StepKind[];
  readonly tokens: readonly string[];
  /** Venue ids; for "custom" the caller's Fence decides. */
  readonly venues: readonly string[] | null;
  readonly recipients: "allowlist" | "own";
  /** Default and ceiling for slippage. */
  readonly maxSlippageBps: number;
  readonly suggested: LeashBudget;
}

/**
 * DEX venues whose swap call takes the recipient at a fixed ABI word, so the
 * LykiaAccount can pin the output to itself (`receiverWords`). Uniswap v4's
 * UniversalRouter, Aerodrome's router, Sushi's route processor, Relay, Across and
 * LykiaRouter splits carry the recipient inside dynamic bytes or route
 * elsewhere: a session cannot check them, so a leash never uses them.
 */
export const LEASH_SWAP_VENUES: readonly string[] = ["uniswap-v3", "archery", "unitflow-finance-v3"];
export const LEASH_EARN_VENUES: readonly string[] = ["morpho-vaults", "aave-v4"];

export const LEASH_TEMPLATES: Readonly<Record<LeashTemplateKey, LeashTemplate>> = Object.freeze({
  "pay-invoices": {
    key: "pay-invoices",
    title: "Pay invoices",
    summary: "Transfers only, to payees you name. No swaps, no lending, no bridges.",
    kinds: ["transfer"],
    tokens: ["USDC", "EURC"],
    venues: ["arc-transfer"],
    recipients: "allowlist",
    maxSlippageBps: 0,
    suggested: { perStepUsd: "20", perDayUsd: "20", totalUsd: "140" },
  },
  "trade-small": {
    key: "trade-small",
    title: "Trade small",
    summary: "USDC and EURC swaps on DEXs whose output the account can pin to itself, with a slippage cap.",
    kinds: ["swap", "fx"],
    tokens: ["USDC", "EURC"],
    venues: LEASH_SWAP_VENUES,
    recipients: "own",
    maxSlippageBps: 50,
    suggested: { perStepUsd: "25", perDayUsd: "50", totalUsd: "350" },
  },
  earn: {
    key: "earn",
    title: "Earn",
    summary: "Deposit into and withdraw from Morpho vaults and Aave V4. Everything stays in the account.",
    kinds: ["deposit", "withdraw", "supply"],
    tokens: ["USDC", "EURC"],
    venues: LEASH_EARN_VENUES,
    recipients: "own",
    maxSlippageBps: 10,
    suggested: { perStepUsd: "250", perDayUsd: "500", totalUsd: "2000" },
  },
  custom: {
    key: "custom",
    title: "Custom",
    summary: "Your own Fence, narrowed to the leash's budget and expiry. It must sit inside the parent's Fence.",
    kinds: [],
    tokens: ["USDC", "EURC"],
    venues: null,
    recipients: "own",
    maxSlippageBps: 50,
    suggested: { perStepUsd: "25", perDayUsd: "50", totalUsd: "350" },
  },
});

export function leashTemplate(key: LeashTemplateKey): LeashTemplate {
  return LEASH_TEMPLATES[key];
}

/** The on-chain half of a leash: where the session lives and who signs it. */
export interface LeashSession {
  readonly account: Address;
  /** Known once the session transaction landed (from its SessionCreated event). */
  readonly sessionId: `0x${string}` | null;
  /** The agent's own key: the session key. Lykia never holds it. */
  readonly key: Address;
  /** createSubSession: the parent agent's session; null for a root createSession. */
  readonly parentSessionId: `0x${string}` | null;
  /** Who sends the session transaction. */
  readonly signer: "owner" | "parent-session";
  readonly from: Address;
  readonly chainId: number;
  readonly validUntil: number;
  readonly maxCalls: number;
  /** The account's sessionNonce when the leash was made (the session id is found above it). */
  readonly nonceAtCreation: string;
  /** Tokens the session holds caps for (lower-case addresses). */
  readonly tokens: readonly Address[];
  readonly txHash?: `0x${string}`;
  readonly block?: string;
}

export interface Leash {
  readonly schema: typeof LEASH_SCHEMA;
  readonly id: string;
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  /** The Pack agent the leash belongs to. */
  readonly agentId: string;
  readonly agentName: string;
  readonly mission?: string;
  /** The Pack agent it was carved from; null for a root leash (carved from the owner's own Fence). */
  readonly parentAgentId: string | null;
  readonly template: LeashTemplateKey;
  readonly fence: Fence;
  readonly fenceHash: Sha256Digest;
  readonly budget: LeashBudget;
  readonly expiresAt: string;
  readonly tools: readonly LeashTool[];
  readonly venues: readonly string[] | null;
  readonly recipients: readonly Address[];
  readonly status: LeashStatus;
  readonly session: LeashSession | null;
  /** ERC-8004 Tag: the agent id once registered, the card digest when drafted. */
  readonly tag: { readonly agentId?: string; readonly cardDigest?: string } | null;
  /** The leash key: its id and visible prefix. The secret is shown once. */
  readonly key: { readonly id: string; readonly prefix: string };
  /** Who made it: a session or a project key acting for the owner. */
  readonly createdBy: { readonly via: "session" | "secret"; readonly developer: string; readonly projectId?: string };
  readonly renewedFrom?: string;
  readonly createdAt: string;
  readonly revokedAt?: string;
  readonly revokedReason?: string;
}

/* ------------------------------------------------------------ usage */

export interface LeashTokenUsage {
  readonly symbol: string;
  readonly token: Address;
  readonly decimals: number;
  /** Base units, as the LykiaAccount counts them. */
  readonly perCall: string;
  readonly daily: string;
  readonly budget: string;
  /** Spent inside the rolling 24 h window (getLimit.dayAmount). */
  readonly dayUsed: string;
  /** Spent over the session's life (getLimit.consumed). */
  readonly consumed: string;
  /** spendable(): the tightest cap on the whole session chain, right now. Authoritative. */
  readonly spendable: string;
}

export interface LeashWindow {
  readonly spentUsd: string;
  readonly capUsd: string;
  readonly remainingUsd: string;
  /** 0 to 1. */
  readonly share: number;
}

export interface LeashUsage {
  readonly asOf: string;
  /** "chain": read from the LykiaAccount at `block`; "store": what Lykia recorded (the session is not on chain yet or the chain could not be read). */
  readonly source: "chain" | "store";
  readonly block: string | null;
  readonly sessionValid: boolean | null;
  /** USD windows: the larger of the chain's count (stablecoins at par) and Lykia's record. */
  readonly day: LeashWindow;
  readonly total: LeashWindow;
  readonly perStepUsd: string;
  readonly tokens: readonly LeashTokenUsage[];
  readonly calls: { readonly used: number; readonly max: number } | null;
  /** Seconds until expiry (0 when past). */
  readonly secondsLeft: number;
}

export function leashWindow(spentUsd: string, capUsd: string): LeashWindow {
  const spent = usdMicros(spentUsd);
  const cap = usdMicros(capUsd);
  const remaining = cap > spent ? cap - spent : 0n;
  return { spentUsd: formatUsdMicros(spent), capUsd: formatUsdMicros(cap), remainingUsd: formatUsdMicros(remaining), share: cap === 0n ? 1 : Math.min(1, Number((spent * 10_000n) / cap) / 10_000) };
}

/** Budget thresholds that fire `leash.budget.threshold`. */
export const LEASH_THRESHOLDS: readonly number[] = [50, 80, 100];

/** The thresholds a window crossed going from `before` to `after` (shares 0 to 1). */
export function crossedThresholds(before: number, after: number): number[] {
  return LEASH_THRESHOLDS.filter((t) => before * 100 < t && after * 100 >= t);
}

/* ------------------------------------------------------------ denials */

/**
 * Machine-readable reasons a leashed request is refused. Fence rules keep
 * their own names (`fence.<rule>`, e.g. `fence.caps.step`); these are the
 * leash's own.
 */
export type LeashDenyCode =
  | "leash.revoked"
  | "leash.expired"
  | "leash.session.pending"
  | "leash.session.invalid"
  | "leash.budget.step"
  | "leash.budget.day"
  | "leash.budget.total"
  | "leash.chain.spendable"
  | "leash.chain.unreadable"
  | "leash.chain.revert"
  | "leash.token.not-in-session"
  | "leash.call.not-in-session"
  | "leash.recipient.not-in-session"
  | "leash.needs-owner"
  | "leash.unpriced"
  | "leash.venue.none"
  | "leash.not-understood";

export interface LeashDenyReason {
  /** A LeashDenyCode or `fence.<FenceRule>`. */
  readonly code: string;
  readonly message: string;
  readonly stepId?: string;
}

/* ------------------------------------------------------------ enforcement */

export interface EnforcementLine {
  readonly limit: string;
  readonly enforcedBy: "chain" | "api" | "both";
  readonly how: string;
}

/** Exactly which limit is enforced where. The docs and the UI show this table. */
export const LEASH_ENFORCEMENT: readonly EnforcementLine[] = [
  { limit: "Expiry", enforcedBy: "both", how: "LykiaAccount refuses every call after validUntil; the API stops the key at expiresAt." },
  { limit: "Per-step cap", enforcedBy: "both", how: "On chain: perCall in token units per token (USDC 1:1, EURC at the reference rate when the leash was made). At the API: USD per step (caps.perStepUsd)." },
  { limit: "Daily cap", enforcedBy: "both", how: "On chain: daily in token units over a rolling 24 h window. At the API: USD per day (caps.dailyUsd)." },
  { limit: "Total budget", enforcedBy: "both", how: "On chain: budget in token units over the session's life, charged up the whole session chain. At the API: USD over the leash's life." },
  { limit: "Payees", enforcedBy: "both", how: "On chain: agentTransfer only to the session's recipient list or the owner. At the API: the Fence's recipient allowlist." },
  { limit: "Contracts and functions", enforcedBy: "chain", how: "agentExecute only on (target, selector) call rules, each pinning its output argument to the account; approve, transfer and permit selectors can never be allowlisted." },
  { limit: "Number of calls", enforcedBy: "chain", how: "maxCalls on the session, counted on every node of the chain." },
  { limit: "Revocation", enforcedBy: "both", how: "The API disables the key the moment you revoke; revokeSession on the account ends the session (and every sub-session) once signed." },
  { limit: "USD valuation", enforcedBy: "api", how: "The chain counts token units. Dollar amounts, prices and the beta cap are checked by the Fence at the API." },
  { limit: "Venues", enforcedBy: "api", how: "The Fence's venue list and the router's choice. On chain only the call rules exist, which are derived from these venues." },
  { limit: "Slippage", enforcedBy: "api", how: "limits.maxSlippageBps sets the minimum output in the calldata. The chain does not compare prices." },
  { limit: "Scent, schedule, step count", enforcedBy: "api", how: "Fence rules evaluated on every plan." },
];

/* ------------------------------------------------------------ building */

export interface LeashLimitsInput {
  readonly template: LeashTemplateKey;
  readonly name: string;
  readonly environment: ArcEnvironment;
  readonly budget: LeashBudget;
  readonly venues?: readonly string[];
  readonly recipients?: readonly Address[];
  readonly maxSlippageBps?: number;
  /** "custom": the caller's Fence. */
  readonly fence?: Fence;
}

export interface LeashIssue {
  readonly path: string;
  readonly message: string;
}

/** Checks a leash budget: decimals, positive, and perStep <= perDay <= total (the order LykiaAccount requires). */
export function budgetIssues(budget: Partial<LeashBudget> | undefined): LeashIssue[] {
  const out: LeashIssue[] = [];
  if (!budget) return [{ path: "budget", message: "Give perStepUsd, perDayUsd and totalUsd." }];
  for (const key of ["perStepUsd", "perDayUsd", "totalUsd"] as const) {
    const v = budget[key];
    if (typeof v !== "string" || !USD_PATTERN.test(v)) out.push({ path: `budget.${key}`, message: 'A USD amount as a string, e.g. "50".' });
    else if (usdMicros(v) <= 0n) out.push({ path: `budget.${key}`, message: "Must be more than zero." });
  }
  if (out.length > 0) return out;
  const step = usdMicros(budget.perStepUsd as string);
  const day = usdMicros(budget.perDayUsd as string);
  const total = usdMicros(budget.totalUsd as string);
  if (step > day) out.push({ path: "budget.perStepUsd", message: "The per-step cap cannot be above the daily cap." });
  if (day > total) out.push({ path: "budget.perDayUsd", message: "The daily cap cannot be above the total budget." });
  return out;
}

/** Checks the expiry: at least an hour ahead, at most LEASH_LIMITS.maxDays. */
export function expiryIssues(expiresAt: string, now: number): LeashIssue[] {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return [{ path: "expiresAt", message: "An ISO date, e.g. 2026-11-15T12:00:00Z." }];
  if (at < now + LEASH_LIMITS.minHours * 3_600_000) return [{ path: "expiresAt", message: "At least an hour from now." }];
  if (at > now + LEASH_LIMITS.maxDays * 86_400_000) return [{ path: "expiresAt", message: `At most ${LEASH_LIMITS.maxDays} days from now.` }];
  return [];
}

/**
 * The Fence a leash asks for, before it is intersected with its parent's:
 * the template's kinds, tokens and venues narrowed by the caller, the
 * budget as caps, agents as the only signer, nothing to confirm (the owner
 * confirmed once, by signing the session). Returns issues instead of
 * throwing.
 */
export function leashFence(input: LeashLimitsInput): { readonly fence: Fence | null; readonly issues: readonly LeashIssue[] } {
  const issues: LeashIssue[] = [...budgetIssues(input.budget)];
  const t = LEASH_TEMPLATES[input.template];
  if (!t) return { fence: null, issues: [{ path: "template", message: `One of ${LEASH_TEMPLATE_KEYS.join(", ")}.` }] };
  const slip = input.maxSlippageBps ?? t.maxSlippageBps;
  if (!Number.isInteger(slip) || slip < 0 || slip > LEASH_LIMITS.maxSlippageBps) issues.push({ path: "maxSlippageBps", message: `0 to ${LEASH_LIMITS.maxSlippageBps}.` });
  else if (input.template !== "custom" && slip > t.maxSlippageBps) issues.push({ path: "maxSlippageBps", message: `The ${t.title} template allows at most ${t.maxSlippageBps} bps.` });
  const recipients = [...new Set((input.recipients ?? []).map((r) => r.toLowerCase()))] as Address[];
  if (recipients.length > LEASH_LIMITS.recipients) issues.push({ path: "recipients", message: `At most ${LEASH_LIMITS.recipients} recipients.` });
  if (!recipients.every((r) => isAddress(r))) issues.push({ path: "recipients", message: "Addresses, 0x followed by 40 hex characters." });
  if (t.recipients === "allowlist" && recipients.length === 0) issues.push({ path: "recipients", message: "Name at least one payee: this leash pays known recipients only." });
  let venues: readonly string[] | undefined;
  if (input.venues !== undefined) {
    if (t.venues) {
      const extra = input.venues.filter((v) => !t.venues!.includes(v));
      if (extra.length > 0) issues.push({ path: "venues", message: `Not part of the ${t.title} template: ${extra.join(", ")}. Allowed: ${t.venues.join(", ")}.` });
    }
    if (input.venues.length === 0) issues.push({ path: "venues", message: "Name at least one venue, or leave the list out." });
    venues = input.venues;
  } else venues = t.venues ?? undefined;
  const caps = { perStepUsd: input.budget.perStepUsd, perIntentUsd: input.budget.perDayUsd, dailyUsd: input.budget.perDayUsd };
  const label = `Leash · ${input.name}`.slice(0, 64);
  let fence: Fence;
  if (input.template === "custom") {
    if (!input.fence) return { fence: null, issues: [...issues, { path: "fence", message: "A custom leash needs a Fence." }] };
    const checked = validateFence(input.fence);
    if (!checked.ok) return { fence: null, issues: [...issues, ...checked.issues.map((i) => ({ path: `fence.${i.path}`, message: i.message }))] };
    const f = checked.fence;
    const tighter = (a: string | undefined, b: string) => (a !== undefined && usdMicros(a) < usdMicros(b) ? a : b);
    fence = {
      ...f,
      label,
      mode: f.mode === "dry-run" ? "dry-run" : "live",
      environments: [input.environment],
      ...(venues ? { venues: { ...f.venues, allow: f.venues?.allow ? f.venues.allow.filter((v) => venues!.includes(v)) : venues } } : {}),
      tokens: { ...f.tokens, unlisted: "deny" },
      ...(recipients.length > 0 ? { recipients: { ...f.recipients, mode: "allowlist", allow: (f.recipients?.allow ?? recipients).filter((r) => recipients.includes(r.toLowerCase() as Address)) } } : {}),
      caps: { ...f.caps, perStepUsd: tighter(f.caps?.perStepUsd, caps.perStepUsd), perIntentUsd: tighter(f.caps?.perIntentUsd, caps.perIntentUsd), dailyUsd: tighter(f.caps?.dailyUsd, caps.dailyUsd) },
      limits: { ...f.limits, maxSlippageBps: Math.min(f.limits?.maxSlippageBps ?? slip, slip) },
      signers: ["agent"],
    };
  } else {
    fence = {
      schema: FENCE_SCHEMA,
      label,
      mode: "live",
      environments: [input.environment],
      kinds: { allow: t.kinds },
      ...(venues ? { venues: { allow: venues } } : {}),
      tokens: { allow: t.tokens, unlisted: "deny" },
      recipients: t.recipients === "allowlist" ? { mode: "allowlist", allow: recipients } : { mode: "own" },
      caps,
      limits: { maxSteps: 4, maxSlippageBps: slip },
      scent: { require: "verified" },
      confirm: { when: [] },
      signers: ["agent"],
    };
  }
  return { fence: issues.length > 0 ? null : fence, issues };
}

/**
 * The Fence a root leash (one with no parent agent) must sit inside: the
 * template at its widest, with the mainnet beta cap as its caps. A custom
 * root leash's ceiling is the caller's own Fence with the same caps.
 */
export function leashCeiling(input: { readonly template: LeashTemplateKey; readonly environment: ArcEnvironment; readonly recipients?: readonly Address[]; readonly beta?: { readonly perStepUsd: string; readonly perDayUsd: string } | null; readonly fence?: Fence }): Fence {
  const t = LEASH_TEMPLATES[input.template];
  const caps = input.beta && input.environment === "mainnet" ? { perStepUsd: input.beta.perStepUsd, perIntentUsd: input.beta.perDayUsd, dailyUsd: input.beta.perDayUsd } : undefined;
  if (input.template === "custom" && input.fence) {
    const f = input.fence;
    if (!caps) return f;
    const min = (a: string | undefined, b: string) => (a !== undefined && usdMicros(a) < usdMicros(b) ? a : b);
    return { ...f, caps: { ...f.caps, perStepUsd: min(f.caps?.perStepUsd, caps.perStepUsd), perIntentUsd: min(f.caps?.perIntentUsd, caps.perIntentUsd), dailyUsd: min(f.caps?.dailyUsd, caps.dailyUsd) } };
  }
  const recipients = [...new Set((input.recipients ?? []).map((r) => r.toLowerCase()))] as Address[];
  return {
    schema: FENCE_SCHEMA,
    label: `${t.title} ceiling`,
    mode: "live",
    environments: [input.environment],
    ...(t.kinds.length > 0 ? { kinds: { allow: t.kinds } } : {}),
    ...(t.venues ? { venues: { allow: t.venues } } : {}),
    tokens: { allow: t.tokens, unlisted: "deny" },
    recipients: t.recipients === "allowlist" ? { mode: "allowlist", allow: recipients } : { mode: "own" },
    ...(caps ? { caps } : {}),
    limits: { maxSteps: 4, maxSlippageBps: t.maxSlippageBps },
    scent: { require: "verified" },
    signers: ["agent"],
  };
}

/** USD of a leash budget as Pack budget caps (what is carved from the parent). */
export function leashCarve(budget: LeashBudget): { readonly perIntentUsd: string; readonly dailyUsd: string } {
  return { perIntentUsd: budget.perDayUsd, dailyUsd: budget.perDayUsd };
}

/* ------------------------------------------------------------ drafts */

/** What Ask Lyko hands the Fold's "New leash" sheet (`/app/fold/pack?leash=<draft>`). Nothing is created until the owner signs. */
export interface LeashDraft {
  readonly name: string;
  readonly template: LeashTemplateKey;
  readonly perDayUsd: string;
  readonly perStepUsd?: string;
  readonly days: number;
  readonly recipients?: readonly Address[];
}

export const LEASH_PAGE = "/app/fold/pack";
export const LEASH_DRAFT_PARAM = "leash";

/** A checked leash draft (only known fields), or null. */
export function leashDraftOf(value: unknown): LeashDraft | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || v.name.trim().length === 0 || v.name.length > LEASH_LIMITS.nameLength) return null;
  if (!LEASH_TEMPLATE_KEYS.includes(v.template as LeashTemplateKey) || v.template === "custom") return null;
  if (typeof v.perDayUsd !== "string" || !USD_PATTERN.test(v.perDayUsd) || usdMicros(v.perDayUsd) <= 0n) return null;
  if (v.perStepUsd !== undefined && (typeof v.perStepUsd !== "string" || !USD_PATTERN.test(v.perStepUsd) || usdMicros(v.perStepUsd) <= 0n || usdMicros(v.perStepUsd) > usdMicros(v.perDayUsd))) return null;
  if (typeof v.days !== "number" || !Number.isInteger(v.days) || v.days < 1 || v.days > LEASH_LIMITS.maxDays) return null;
  let recipients: Address[] | undefined;
  if (v.recipients !== undefined) {
    if (!Array.isArray(v.recipients) || v.recipients.length > LEASH_LIMITS.recipients || !v.recipients.every((r) => isAddress(r))) return null;
    recipients = [...new Set((v.recipients as string[]).map((r) => r.toLowerCase()))] as Address[];
  }
  return { name: v.name.trim(), template: v.template as LeashTemplateKey, perDayUsd: v.perDayUsd, ...(typeof v.perStepUsd === "string" ? { perStepUsd: v.perStepUsd } : {}), days: v.days, ...(recipients && recipients.length > 0 ? { recipients } : {}) };
}

/** The budget a draft implies: per step defaults to the daily cap, the total is the daily cap times the days. */
export function draftBudget(draft: Pick<LeashDraft, "perDayUsd" | "perStepUsd" | "days">): LeashBudget {
  const day = usdMicros(draft.perDayUsd);
  return { perStepUsd: draft.perStepUsd ?? draft.perDayUsd, perDayUsd: draft.perDayUsd, totalUsd: formatUsdMicros(day * BigInt(draft.days)) };
}

/** The Fold's Pack tab with the New leash sheet prefilled. */
export function leashDraftLink(draft: LeashDraft): string {
  const bytes = new TextEncoder().encode(JSON.stringify(draft));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const encoded = btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
  return `${LEASH_PAGE}?${LEASH_DRAFT_PARAM}=${encoded}`;
}

/** Which template a purpose phrase points at ("pay invoices", "trade", "earn yield"). */
export function templateForPurpose(text: string): Exclude<LeashTemplateKey, "custom"> | null {
  if (/\b(?:invoices?|bills?|pay(?:ing|s)?|payees?|vendors?|suppliers?|payroll|salar(?:y|ies))\b/iu.test(text)) return "pay-invoices";
  if (/\b(?:trad(?:e|es|ing)|swap(?:s|ping)?|fx|exchange)\b/iu.test(text)) return "trade-small";
  if (/\b(?:earn(?:ing)?|yield|vaults?|deposit(?:s|ing)?|lend(?:ing)?|savings?)\b/iu.test(text)) return "earn";
  return null;
}
