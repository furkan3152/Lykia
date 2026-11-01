/**
 * Layer 5, protocol circuit breakers. A venue's health facts become one
 * state: `healthy`, `degraded` (still routable, shown with the reason,
 * never chosen when an alternative exists) or `blocked` (nothing is
 * prepared through it). The global halt and an admin's per-venue switch
 * win over everything.
 */
export type BreakerState = "healthy" | "degraded" | "blocked";

export interface VenueHealthFacts {
  readonly venue: string;
  readonly halted?: boolean;
  readonly disabled?: { readonly reason: string } | null;
  /** The venue (or a contract the step calls) reports paused(). */
  readonly paused?: boolean | null;
  /** Seconds since the venue's price oracle last updated. */
  readonly oracleAgeSeconds?: number | null;
  readonly oracleHeartbeatSeconds?: number;
  /** Chainlink vs pool (or second oracle) in basis points. */
  readonly deviationBps?: number | null;
  /** TVL change over 24 h, as a fraction (-0.4 = down 40 %). */
  readonly tvlChange24h?: number | null;
  /** Borrow utilization, 0..1. */
  readonly utilization?: number | null;
  /** An admin or upgrade event seen within the last day. */
  readonly recentAdminEvent?: boolean;
}

export const BREAKER_LIMITS = Object.freeze({ deviationDegradedBps: 100, deviationBlockedBps: 300, tvlDropDegraded: -0.3, tvlDropBlocked: -0.6, utilizationDegraded: 0.95, utilizationBlocked: 0.99, defaultHeartbeatSeconds: 86_400 });

export interface VenueBreaker {
  readonly venue: string;
  readonly state: BreakerState;
  readonly reasons: readonly string[];
}

export function venueBreaker(f: VenueHealthFacts): VenueBreaker {
  const blocked: string[] = [];
  const degraded: string[] = [];
  if (f.halted) blocked.push("Routing is halted platform-wide.");
  if (f.disabled) blocked.push(`Disabled by an admin: ${f.disabled.reason}`);
  if (f.paused === true) blocked.push("The protocol reports it is paused.");
  const heartbeat = f.oracleHeartbeatSeconds ?? BREAKER_LIMITS.defaultHeartbeatSeconds;
  if (typeof f.oracleAgeSeconds === "number") {
    if (f.oracleAgeSeconds > heartbeat * 2) blocked.push(`The price oracle is ${Math.round(f.oracleAgeSeconds / 3600)} h old.`);
    else if (f.oracleAgeSeconds > heartbeat) degraded.push(`The price oracle missed its heartbeat (${Math.round(f.oracleAgeSeconds / 60)} min old).`);
  }
  if (typeof f.deviationBps === "number") {
    if (f.deviationBps > BREAKER_LIMITS.deviationBlockedBps) blocked.push(`Oracle and pool prices disagree by ${f.deviationBps} bps.`);
    else if (f.deviationBps > BREAKER_LIMITS.deviationDegradedBps) degraded.push(`Oracle and pool prices disagree by ${f.deviationBps} bps.`);
  }
  if (typeof f.tvlChange24h === "number") {
    if (f.tvlChange24h <= BREAKER_LIMITS.tvlDropBlocked) blocked.push(`TVL fell ${Math.round(-f.tvlChange24h * 100)} % in a day.`);
    else if (f.tvlChange24h <= BREAKER_LIMITS.tvlDropDegraded) degraded.push(`TVL fell ${Math.round(-f.tvlChange24h * 100)} % in a day.`);
  }
  if (typeof f.utilization === "number") {
    if (f.utilization >= BREAKER_LIMITS.utilizationBlocked) blocked.push(`Utilization is ${(f.utilization * 100).toFixed(1)} %: withdrawals may not clear.`);
    else if (f.utilization >= BREAKER_LIMITS.utilizationDegraded) degraded.push(`Utilization is ${(f.utilization * 100).toFixed(1)} %.`);
  }
  if (f.recentAdminEvent) degraded.push("An admin or upgrade event happened in the last day.");
  if (blocked.length > 0) return { venue: f.venue, state: "blocked", reasons: [...blocked, ...degraded] };
  if (degraded.length > 0) return { venue: f.venue, state: "degraded", reasons: degraded };
  return { venue: f.venue, state: "healthy", reasons: [] };
}

/** Moves that bring value home (repay, withdraw) stay allowed through a degraded venue and through the halt. */
export const HOMEWARD_KINDS: readonly string[] = Object.freeze(["repay", "withdraw"]);
