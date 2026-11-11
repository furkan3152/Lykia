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
 * A leash spends from the owner's LykiaAccount on Arc (`spendFrom: "arc"`,
 * the default) or from the owner's Circle Gateway balance (`"gateway"`).
 * A Gateway leash has no LykiaAccount session: its on-chain half is a
 * session on the owner's LykiaStile, an ERC-1271 contract the owner adds as
 * a Gateway delegate (see `LEASH_GATEWAY_ENFORCEMENT` and docs/stile.md).
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

import { tx, phrase, localized } from "./i18n/index.js";
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

/** Where a leash's money is: the owner's LykiaAccount on Arc, or the owner's Circle Gateway balance through LykiaStile. */
export type LeashSpendFrom = "arc" | "gateway";
export const LEASH_SPEND_FROM: readonly LeashSpendFrom[] = ["arc", "gateway"];

/** The venue id a Gateway leash's Fence allows: Circle Gateway transfers out of the unified balance. */
export const LEASH_GATEWAY_VENUE = "gateway";

/**
 * Ceilings for Gateway leashes while LykiaStile is unaudited, in USD (USDC
 * 1:1), on both environments. Each LykiaStile carries them as immutables, so
 * no session can be issued above them on chain either.
 */
export const STILE_BETA = Object.freeze({ perStepUsd: "100", perDayUsd: "300" });

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
    title: phrase("Pay invoices"),
    summary: phrase("Transfers only, to payees you name. No swaps, no lending, no bridges."),
    kinds: ["transfer"],
    tokens: ["USDC", "EURC"],
    venues: ["arc-transfer"],
    recipients: "allowlist",
    maxSlippageBps: 0,
    suggested: { perStepUsd: "20", perDayUsd: "20", totalUsd: "140" },
  },
  "trade-small": {
    key: "trade-small",
    title: phrase("Trade small"),
    summary: phrase("USDC and EURC swaps on DEXs whose output the account can pin to itself, with a slippage cap."),
    kinds: ["swap", "fx"],
    tokens: ["USDC", "EURC"],
    venues: LEASH_SWAP_VENUES,
    recipients: "own",
    maxSlippageBps: 50,
    suggested: { perStepUsd: "25", perDayUsd: "50", totalUsd: "350" },
  },
  earn: {
    key: "earn",
    title: phrase("Earn"),
    summary: phrase("Deposit into and withdraw from Morpho vaults and Aave V4. Everything stays in the account."),
    kinds: ["deposit", "withdraw", "supply"],
    tokens: ["USDC", "EURC"],
    venues: LEASH_EARN_VENUES,
    recipients: "own",
    maxSlippageBps: 10,
    suggested: { perStepUsd: "250", perDayUsd: "500", totalUsd: "2000" },
  },
  custom: {
    key: "custom",
    title: phrase("Custom"),
    summary: phrase("Your own Fence, narrowed to the leash's budget and expiry. It must sit inside the parent's Fence."),
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

/** The on-chain half of a Gateway leash: a session on the owner's LykiaStile. */
export interface LeashStile {
  /** The owner's LykiaStile (predicted from the owner's nonce until its creation lands). */
  readonly address: Address;
  /** Known once the session landed (from SessionCreated). */
  readonly sessionId: `0x${string}` | null;
  /** The agent's own key: the Stile session key. Lykia never holds it. */
  readonly key: Address;
  readonly chainId: number;
  readonly validUntil: number;
  /** The Stile's sessionNonce when the leash was made (the session id is found above it). */
  readonly nonceAtCreation: string;
  /** Gateway destination chain keys the leash may pay to ("arc", "base", ...). */
  readonly destinations: readonly string[];
  /** Gateway's per-intent fee the session allows, in USDC base units. */
  readonly maxGatewayFee: string;
  /** Lykia's fee leg the Stile requires (its immutables). */
  readonly feeBps: number;
  readonly feeRecipient: Address;
  /** True when the leash's transactions include the Stile's creation. */
  readonly deploys: boolean;
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
  /** Set while the Whistle holds the leash: its key is refused until the owner resumes it. */
  readonly paused?: { readonly at: string; readonly by: "whistle" | "owner" } | null;
  readonly session: LeashSession | null;
  /** Absent = "arc". */
  readonly spendFrom?: LeashSpendFrom;
  /** Gateway leashes only. */
  readonly stile?: LeashStile | null;
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
  /** Gateway leashes: what the LykiaStile and Gateway say right now. */
  readonly stile?: {
    /** The most the next reservation may charge (payment plus Lykia fee), USDC base units; spendable() on the Stile. */
    readonly spendable: string;
    readonly paused: boolean | null;
    /** GatewayWallet.isAuthorizedForBalance(USDC, owner, Stile). */
    readonly delegated: boolean | null;
    /** The owner's Gateway balance deposited on Arc (the only part an Arc Stile can spend), USDC; null when Gateway did not answer. */
    readonly arcBalanceUsdc: string | null;
  };
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
  | "leash.paused"
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
  | "leash.not-understood"
  | "leash.gateway.destination"
  | "leash.gateway.recipient"
  | "leash.gateway.balance"
  | "leash.gateway.unavailable"
  | "leash.gateway.fee"
  | "leash.stile.paused"
  | "leash.stile.delegate";

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
export const LEASH_ENFORCEMENT: readonly EnforcementLine[] = localized([
  { limit: phrase("Expiry"), enforcedBy: "both", how: phrase("LykiaAccount refuses every call after validUntil; the API stops the key at expiresAt.") },
  { limit: phrase("Per-step cap"), enforcedBy: "both", how: phrase("On chain: perCall in token units per token (USDC 1:1, EURC at the reference rate when the leash was made). At the API: USD per step (caps.perStepUsd).") },
  { limit: phrase("Daily cap"), enforcedBy: "both", how: phrase("On chain: daily in token units over a rolling 24 h window. At the API: USD per day (caps.dailyUsd).") },
  { limit: phrase("Total budget"), enforcedBy: "both", how: phrase("On chain: budget in token units over the session's life, charged up the whole session chain. At the API: USD over the leash's life.") },
  { limit: phrase("Payees"), enforcedBy: "both", how: phrase("On chain: agentTransfer only to the session's recipient list or the owner. At the API: the Fence's recipient allowlist.") },
  { limit: phrase("Contracts and functions"), enforcedBy: "chain", how: phrase("agentExecute only on (target, selector) call rules, each pinning its output argument to the account; approve, transfer and permit selectors can never be allowlisted.") },
  { limit: phrase("Number of calls"), enforcedBy: "chain", how: phrase("maxCalls on the session, counted on every node of the chain.") },
  { limit: phrase("Revocation"), enforcedBy: "both", how: phrase("The API disables the key the moment you revoke; revokeSession on the account ends the session (and every sub-session) once signed.") },
  { limit: phrase("USD valuation"), enforcedBy: "api", how: phrase("The chain counts token units. Dollar amounts, prices and the beta cap are checked by the Fence at the API.") },
  { limit: phrase("Venues"), enforcedBy: "api", how: phrase("The Fence's venue list and the router's choice. On chain only the call rules exist, which are derived from these venues.") },
  { limit: phrase("Slippage"), enforcedBy: "api", how: phrase("limits.maxSlippageBps sets the minimum output in the calldata. The chain does not compare prices.") },
  { limit: phrase("Scent, schedule, step count"), enforcedBy: "api", how: phrase("Fence rules evaluated on every plan.") },
]);

/** The same split for a Gateway leash: what LykiaStile enforces, what Gateway checks and what the API holds. */
export const LEASH_GATEWAY_ENFORCEMENT: readonly EnforcementLine[] = localized([
  { limit: phrase("Expiry"), enforcedBy: "both", how: phrase("LykiaStile refuses reservations after validUntil and stops validating its digests; the API stops the key at expiresAt.") },
  { limit: phrase("Per-transfer cap"), enforcedBy: "both", how: phrase("On chain: perTransfer in USDC units, payment plus Lykia fee, never above the Stile's immutable ceiling ($100 while unaudited). At the API: USD per step.") },
  { limit: phrase("Daily cap"), enforcedBy: "both", how: phrase("On chain: daily over a rolling 24 h window, never above the Stile's ceiling ($300 while unaudited). At the API: USD per day.") },
  { limit: phrase("Total budget"), enforcedBy: "both", how: phrase("On chain: lifetime on the session. At the API: USD over the leash's life.") },
  { limit: phrase("Payees"), enforcedBy: "both", how: phrase("On chain: the session's recipient list (32-byte addresses). At the API: the Fence's recipient allowlist.") },
  { limit: phrase("Destination chains"), enforcedBy: "both", how: phrase("On chain: the session's allowed Gateway domains. At the API: the leash's destination list.") },
  { limit: phrase("Source of funds"), enforcedBy: "chain", how: phrase("Every reserved intent must debit the owner's deposit on Arc through Gateway Wallet, signed by the Stile, with empty hook data.") },
  { limit: phrase("Lykia fee"), enforcedBy: "chain", how: phrase("With a fee, a reservation is a burn intent set [payment, fee]: Gateway attests and mints both together or neither.") },
  { limit: phrase("Gateway fee"), enforcedBy: "chain", how: phrase("maxFee of each intent is at most the session's maxGatewayFee; Circle charges at most that.") },
  { limit: phrase("Revocation"), enforcedBy: "both", how: phrase("The API disables the key at once; revokeSession on the Stile stops new reservations and validation. Gateway may validate against a block up to about 5 minutes old.") },
  { limit: phrase("Signature check"), enforcedBy: "chain", how: phrase("Gateway calls isValidSignature (read-only, in its validation enclave, with an RPC quorum); it answers only for reserved, unexpired, uncancelled digests of a live session while the Stile is not paused.") },
  { limit: phrase("USD valuation, Scent, schedule"), enforcedBy: "api", how: phrase("The Fence evaluates every transfer before the reservation is prepared.") },
]);

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
  /** Absent = "arc". */
  readonly spendFrom?: LeashSpendFrom;
}

export interface LeashIssue {
  readonly path: string;
  readonly message: string;
}

/** Checks a leash budget: decimals, positive, and perStep <= perDay <= total (the order LykiaAccount requires). */
export function budgetIssues(budget: Partial<LeashBudget> | undefined): LeashIssue[] {
  const out: LeashIssue[] = [];
  if (!budget) return [{ path: "budget", message: tx("Give perStepUsd, perDayUsd and totalUsd.") }];
  for (const key of ["perStepUsd", "perDayUsd", "totalUsd"] as const) {
    const v = budget[key];
    if (typeof v !== "string" || !USD_PATTERN.test(v)) out.push({ path: `budget.${key}`, message: tx("A USD amount as a string, e.g. \"50\".") });
    else if (usdMicros(v) <= 0n) out.push({ path: `budget.${key}`, message: tx("Must be more than zero.") });
  }
  if (out.length > 0) return out;
  const step = usdMicros(budget.perStepUsd as string);
  const day = usdMicros(budget.perDayUsd as string);
  const total = usdMicros(budget.totalUsd as string);
  if (step > day) out.push({ path: "budget.perStepUsd", message: tx("The per-step cap cannot be above the daily cap.") });
  if (day > total) out.push({ path: "budget.perDayUsd", message: tx("The daily cap cannot be above the total budget.") });
  return out;
}

/** Checks the expiry: at least an hour ahead, at most LEASH_LIMITS.maxDays. */
export function expiryIssues(expiresAt: string, now: number): LeashIssue[] {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return [{ path: "expiresAt", message: tx("An ISO date, e.g. 2026-11-15T12:00:00Z.") }];
  if (at < now + LEASH_LIMITS.minHours * 3_600_000) return [{ path: "expiresAt", message: tx("At least an hour from now.") }];
  if (at > now + LEASH_LIMITS.maxDays * 86_400_000) return [{ path: "expiresAt", message: tx("At most {maxDays} days from now.", { maxDays: LEASH_LIMITS.maxDays }) }];
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
  if (!t) return { fence: null, issues: [{ path: "template", message: tx("One of {value}.", { value: LEASH_TEMPLATE_KEYS.join(", ") }) }] };
  if (input.spendFrom === "gateway") return gatewayLeashFence(input, issues);
  const slip = input.maxSlippageBps ?? t.maxSlippageBps;
  if (!Number.isInteger(slip) || slip < 0 || slip > LEASH_LIMITS.maxSlippageBps) issues.push({ path: "maxSlippageBps", message: tx("0 to {maxSlippageBps}.", { maxSlippageBps: LEASH_LIMITS.maxSlippageBps }) });
  else if (input.template !== "custom" && slip > t.maxSlippageBps) issues.push({ path: "maxSlippageBps", message: tx("The {title} template allows at most {maxSlippageBps} bps.", { title: t.title, maxSlippageBps: t.maxSlippageBps }) });
  const recipients = [...new Set((input.recipients ?? []).map((r) => r.toLowerCase()))] as Address[];
  if (recipients.length > LEASH_LIMITS.recipients) issues.push({ path: "recipients", message: tx("At most {recipients} recipients.", { recipients: LEASH_LIMITS.recipients }) });
  if (!recipients.every((r) => isAddress(r))) issues.push({ path: "recipients", message: tx("Addresses, 0x followed by 40 hex characters.") });
  if (t.recipients === "allowlist" && recipients.length === 0) issues.push({ path: "recipients", message: tx("Name at least one payee: this leash pays known recipients only.") });
  let venues: readonly string[] | undefined;
  if (input.venues !== undefined) {
    if (t.venues) {
      const extra = input.venues.filter((v) => !t.venues!.includes(v));
      if (extra.length > 0) issues.push({ path: "venues", message: tx("Not part of the {title} template: {value}. Allowed: {value2}.", { title: t.title, value: extra.join(", "), value2: t.venues.join(", ") }) });
    }
    if (input.venues.length === 0) issues.push({ path: "venues", message: tx("Name at least one venue, or leave the list out.") });
    venues = input.venues;
  } else venues = t.venues ?? undefined;
  const caps = { perStepUsd: input.budget.perStepUsd, perIntentUsd: input.budget.perDayUsd, dailyUsd: input.budget.perDayUsd };
  const label = `Leash · ${input.name}`.slice(0, 64);
  let fence: Fence;
  if (input.template === "custom") {
    if (!input.fence) return { fence: null, issues: [...issues, { path: "fence", message: tx("A custom leash needs a Fence.") }] };
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

/** Budget issues against the Stile beta ceilings. */
export function stileBudgetIssues(budget: Pick<LeashBudget, "perStepUsd" | "perDayUsd">): LeashIssue[] {
  const out: LeashIssue[] = [];
  if (USD_PATTERN.test(budget.perStepUsd) && usdMicros(budget.perStepUsd) > usdMicros(STILE_BETA.perStepUsd)) out.push({ path: "budget.perStepUsd", message: tx("A Gateway leash allows at most ${perStepUsd} per transfer while LykiaStile is unaudited.", { perStepUsd: STILE_BETA.perStepUsd }) });
  if (USD_PATTERN.test(budget.perDayUsd) && usdMicros(budget.perDayUsd) > usdMicros(STILE_BETA.perDayUsd)) out.push({ path: "budget.perDayUsd", message: tx("A Gateway leash allows at most ${perDayUsd} a day while LykiaStile is unaudited.", { perDayUsd: STILE_BETA.perDayUsd }) });
  return out;
}

/** A Gateway leash: USDC transfers to named payees through Circle Gateway, nothing else. */
function gatewayLeashFence(input: LeashLimitsInput, issues: LeashIssue[]): { readonly fence: Fence | null; readonly issues: readonly LeashIssue[] } {
  if (input.template !== "pay-invoices") issues.push({ path: "template", message: tx("A Gateway leash pays named payees: use the \"pay-invoices\" template.") });
  if (input.venues !== undefined && !(input.venues.length === 1 && input.venues[0] === LEASH_GATEWAY_VENUE)) issues.push({ path: "venues", message: tx("A Gateway leash uses one venue, {LEASH_GATEWAY_VENUE}.", { LEASH_GATEWAY_VENUE }) });
  if (input.maxSlippageBps !== undefined && input.maxSlippageBps !== 0) issues.push({ path: "maxSlippageBps", message: tx("A Gateway transfer has no slippage; leave it out or send 0.") });
  issues.push(...stileBudgetIssues(input.budget));
  const recipients = [...new Set((input.recipients ?? []).map((r) => r.toLowerCase()))] as Address[];
  if (recipients.length === 0) issues.push({ path: "recipients", message: tx("Name at least one payee: this leash pays known recipients only.") });
  if (recipients.length > LEASH_LIMITS.recipients) issues.push({ path: "recipients", message: tx("At most {recipients} recipients.", { recipients: LEASH_LIMITS.recipients }) });
  if (!recipients.every((r) => isAddress(r))) issues.push({ path: "recipients", message: tx("Addresses, 0x followed by 40 hex characters.") });
  const fence: Fence = {
    schema: FENCE_SCHEMA,
    label: `Leash · ${input.name}`.slice(0, 64),
    mode: "live",
    environments: [input.environment],
    kinds: { allow: ["transfer"] },
    venues: { allow: [LEASH_GATEWAY_VENUE] },
    tokens: { allow: ["USDC"], unlisted: "deny" },
    recipients: { mode: "allowlist", allow: recipients },
    caps: { perStepUsd: input.budget.perStepUsd, perIntentUsd: input.budget.perDayUsd, dailyUsd: input.budget.perDayUsd },
    limits: { maxSteps: 1, maxSlippageBps: 0 },
    scent: { require: "verified" },
    confirm: { when: [] },
    signers: ["agent"],
  };
  return { fence: issues.length > 0 ? null : fence, issues };
}

/**
 * The Fence a root leash (one with no parent agent) must sit inside: the
 * template at its widest, with the mainnet beta cap as its caps. A custom
 * root leash's ceiling is the caller's own Fence with the same caps.
 */
export function leashCeiling(input: { readonly template: LeashTemplateKey; readonly environment: ArcEnvironment; readonly recipients?: readonly Address[]; readonly beta?: { readonly perStepUsd: string; readonly perDayUsd: string } | null; readonly fence?: Fence; readonly spendFrom?: LeashSpendFrom }): Fence {
  const t = LEASH_TEMPLATES[input.template];
  if (input.spendFrom === "gateway") {
    // The Stile ceiling on both environments, and the mainnet beta cap where it is lower.
    const lower = (a: string, b: string | undefined) => (b !== undefined && usdMicros(b) < usdMicros(a) ? b : a);
    const beta = input.environment === "mainnet" ? input.beta : null;
    const step = lower(STILE_BETA.perStepUsd, beta?.perStepUsd);
    const day = lower(STILE_BETA.perDayUsd, beta?.perDayUsd);
    const recipients = [...new Set((input.recipients ?? []).map((r) => r.toLowerCase()))] as Address[];
    return {
      schema: FENCE_SCHEMA,
      label: tx("Gateway leash ceiling"),
      mode: "live",
      environments: [input.environment],
      kinds: { allow: ["transfer"] },
      venues: { allow: [LEASH_GATEWAY_VENUE] },
      tokens: { allow: ["USDC"], unlisted: "deny" },
      recipients: { mode: "allowlist", allow: recipients },
      caps: { perStepUsd: step, perIntentUsd: day, dailyUsd: day },
      limits: { maxSteps: 1, maxSlippageBps: 0 },
      scent: { require: "verified" },
      signers: ["agent"],
    };
  }
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
