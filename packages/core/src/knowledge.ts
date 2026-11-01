/**
 * What Lykia knows about every venue it executes: the contracts, each
 * function it may call (signature, tokens in and out, who receives the
 * output, approvals, preconditions, failure modes, gas, fees, settlement),
 * how its state is read, its risk facts, and how its outputs compose with
 * other venues' inputs.
 *
 * The data lives in knowledgeData.ts and is validated when the module
 * loads: every executable venue must be fully described and every fact
 * carries its evidence. The route search walks the capability graph built
 * here; the knowledge endpoints and Lyko's `knowledge` tool serve it as is.
 *
 * Asset notation in capabilities:
 *   "USDC"                  a registry token in the wallet
 *   "USDC@morpho-vaults"    a position the account holds at a venue (vault shares, a supply)
 *   "debt:USDC@morpho-blue" a debt at a venue
 *   "USDC@cctp"             USDC minted on another chain (async)
 *   "USDC@gateway"          the Circle Gateway unified balance
 *   "*"                     any registry token
 */
import type { StepKind } from "./intent.js";
import type { RiskTier } from "./routes.js";

export type Settlement = "instant" | "async";

export interface FailureMode {
  /** The revert string or error name, when it is known exactly; otherwise a short label. */
  readonly reason: string;
  readonly meaning: string;
}

export interface KnowledgeFunction {
  /** `${venue}.${name}`, unique. */
  readonly id: string;
  /** Registry contract key (protocol row) or Arc contract key the function lives on. */
  readonly contract: string;
  /** Human-readable ABI fragment, as the engine encodes it (checked against the engine's ABIs in tests). */
  readonly abi: string;
  /** Engine adapters that encode this call. */
  readonly adapters: readonly string[];
  readonly verb: StepKind | "read" | "infra";
  readonly purpose: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  /** Units of the amount arguments. */
  readonly units: string;
  /** Who receives the output. */
  readonly recipient: string;
  readonly approvals: readonly string[];
  readonly preconditions: readonly string[];
  readonly failures: readonly FailureMode[];
  /** Gas estimate for the call alone (Memo/Multicall3From overhead is added separately). */
  readonly gas: number;
  readonly feeModel: string;
  readonly settlement: Settlement;
  readonly evidence: string;
}

export interface KnowledgeRead {
  readonly id: string;
  readonly contract: string;
  readonly abi: string;
  readonly purpose: string;
  readonly evidence: string;
}

export interface RiskFacts {
  readonly tier: RiskTier;
  readonly oracle: string;
  readonly curator?: string;
  readonly admin: string;
  readonly upgradeable: "yes" | "no" | "partly" | "unknown";
  readonly tvlSource: string;
  readonly audits: readonly string[];
  readonly notes: readonly string[];
}

export interface Capability {
  /** Unique id, `${venue}:${verb}:${from}>${to}`. */
  readonly id: string;
  readonly venue: string;
  readonly verb: StepKind;
  readonly adapter: string;
  readonly from: string;
  readonly to: string;
  readonly settlement: Settlement;
  /** Expected seconds until the output is usable (0 = same transaction). */
  readonly delaySeconds: number;
  readonly gas: number;
  /** Fee the venue itself takes, in bps, when it is fixed; null = variable (pool fee tier, interest). */
  readonly venueFeeBps: number | null;
  readonly note?: string;
}

export interface VenueKnowledge {
  readonly venue: string;
  readonly purpose: string;
  /** Lykia executes it on mainnet today. */
  readonly executable: boolean;
  readonly contracts: readonly { readonly key: string; readonly role: string }[];
  readonly functions: readonly KnowledgeFunction[];
  readonly reads: readonly KnowledgeRead[];
  readonly risk: RiskFacts;
  readonly capabilities: readonly Capability[];
  readonly docs: string;
  readonly evidence: string;
}

export interface KnowledgeIssue {
  readonly venue: string;
  readonly message: string;
}

/** Base risk penalty per tier, in bps of the amount at stake per year (the route objective's risk term). */
export const RISK_PENALTY_BPS: Readonly<Record<RiskTier, number>> = Object.freeze({ low: 0, medium: 50, high: 200 });

/** Risk appetite multiplies the penalty: a careful owner pays more for the same risk. */
export const APPETITE_MULTIPLIER: Readonly<Record<RiskTier, number>> = Object.freeze({ low: 3, medium: 1, high: 0.25 });

export function validateKnowledge(rows: readonly VenueKnowledge[], options: { readonly executableVenues?: ReadonlySet<string>; readonly contractKeys?: (venue: string) => readonly string[] | null } = {}): KnowledgeIssue[] {
  const issues: KnowledgeIssue[] = [];
  const venues = new Set<string>();
  const fnIds = new Set<string>();
  const capIds = new Set<string>();
  for (const row of rows) {
    const push = (message: string) => issues.push({ venue: row.venue, message });
    if (venues.has(row.venue)) push("Duplicate venue.");
    venues.add(row.venue);
    if (!row.evidence.trim()) push("Venue needs evidence.");
    if (!row.purpose.trim()) push("Venue needs a purpose.");
    if (row.risk.audits.length === 0 && row.risk.notes.length === 0) push("Risk facts need audits or a note saying there are none.");
    const known = options.contractKeys?.(row.venue) ?? null;
    for (const c of row.contracts) if (known && !c.key.startsWith("any:") && !known.includes(c.key)) push(`Contract ${c.key} is not in the registry row.`);
    const contractKeys = new Set(row.contracts.map((c) => c.key));
    for (const f of row.functions) {
      if (fnIds.has(f.id)) push(`Duplicate function ${f.id}.`);
      fnIds.add(f.id);
      if (!f.id.startsWith(`${row.venue}.`)) push(`Function ${f.id} must start with ${row.venue}.`);
      if (!contractKeys.has(f.contract)) push(`Function ${f.id} names contract ${f.contract}, which the venue does not list.`);
      if (!/^function \w+\(/u.test(f.abi)) push(`Function ${f.id} needs a human-readable ABI fragment.`);
      if (!f.evidence.trim()) push(`Function ${f.id} needs evidence.`);
      if (f.verb !== "read" && f.verb !== "infra") {
        if (f.failures.length === 0) push(`Function ${f.id} needs failure modes.`);
        if (f.gas <= 0) push(`Function ${f.id} needs a gas estimate.`);
        if (!f.recipient.trim()) push(`Function ${f.id} must say who receives the output.`);
      }
    }
    for (const r of row.reads) {
      if (!contractKeys.has(r.contract)) push(`Read ${r.id} names contract ${r.contract}, which the venue does not list.`);
      if (!/^function \w+\(/u.test(r.abi)) push(`Read ${r.id} needs a human-readable ABI fragment.`);
    }
    for (const cap of row.capabilities) {
      if (capIds.has(cap.id)) push(`Duplicate capability ${cap.id}.`);
      capIds.add(cap.id);
      if (cap.venue !== row.venue) push(`Capability ${cap.id} belongs to ${cap.venue}.`);
      if (!row.functions.some((f) => f.adapters.includes(cap.adapter))) push(`Capability ${cap.id} uses adapter ${cap.adapter}, which no function of the venue encodes.`);
    }
    if (row.executable && row.capabilities.length === 0) push("An executable venue needs at least one capability.");
    if (row.executable && row.reads.length === 0 && row.venue !== "arc-transfer") push("An executable venue needs at least one state read.");
  }
  for (const venue of options.executableVenues ?? []) if (!venues.has(venue)) issues.push({ venue, message: "Executable venue has no knowledge entry." });
  return issues;
}

/* ------------------------------------------------------------------ graph */

/** Does `asset` match a capability endpoint pattern ("*" matches any wallet token)? */
export function assetMatches(pattern: string, asset: string): boolean {
  if (pattern === asset) return true;
  if (pattern === "*") return !asset.includes("@") && !asset.startsWith("debt:");
  return false;
}

/** Every capability that can consume `asset`. */
export function capabilitiesFrom(rows: readonly VenueKnowledge[], asset: string, options: { readonly executableOnly?: boolean } = {}): Capability[] {
  return rows.filter((r) => !options.executableOnly || r.executable).flatMap((r) => r.capabilities.filter((c) => assetMatches(c.from, asset)));
}

/** Can the output of `a` feed the input of `b`? */
export function composes(a: Capability, b: Capability): boolean {
  return assetMatches(b.from, a.to);
}

export interface AssetPath {
  readonly hops: readonly Capability[];
  readonly delaySeconds: number;
  readonly gas: number;
}

/**
 * Every simple path of at most `maxHops` capabilities from `from` to `to`
 * over the given verbs (e.g. swap/fx for conversions). Deterministic:
 * paths come out sorted by hop count, then gas, then capability ids.
 */
export function assetPaths(rows: readonly VenueKnowledge[], from: string, to: string, options: { readonly verbs: readonly StepKind[]; readonly maxHops?: number; readonly executableOnly?: boolean; readonly limit?: number }): AssetPath[] {
  const maxHops = Math.max(1, Math.min(4, options.maxHops ?? 3));
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const caps = rows.filter((r) => !options.executableOnly || r.executable).flatMap((r) => r.capabilities).filter((c) => options.verbs.includes(c.verb));
  const out: AssetPath[] = [];
  const walk = (asset: string, hops: Capability[], seen: Set<string>) => {
    if (out.length >= limit * 4) return;
    if (hops.length > 0 && asset === to) {
      out.push({ hops: [...hops], delaySeconds: hops.reduce((s, h) => s + h.delaySeconds, 0), gas: hops.reduce((s, h) => s + h.gas, 0) });
      return;
    }
    if (hops.length >= maxHops) return;
    for (const cap of caps) {
      if (!assetMatches(cap.from, asset) || seen.has(cap.to)) continue;
      seen.add(cap.to);
      hops.push(cap);
      walk(cap.to, hops, seen);
      hops.pop();
      seen.delete(cap.to);
    }
  };
  walk(from, [], new Set([from]));
  return out
    .sort((a, b) => a.hops.length - b.hops.length || a.gas - b.gas || a.hops.map((h) => h.id).join("|").localeCompare(b.hops.map((h) => h.id).join("|")))
    .slice(0, limit);
}

/** Distinct token-level conversion routes (venue choice inside a hop is the router's job). */
export function tokenRoutes(rows: readonly VenueKnowledge[], from: string, to: string, maxHops = 3): string[][] {
  const seen = new Set<string>();
  const routes: string[][] = [];
  for (const path of assetPaths(rows, from, to, { verbs: ["swap", "fx"], maxHops, executableOnly: true, limit: 200 })) {
    const tokens = [from, ...path.hops.map((h) => h.to)];
    const key = tokens.join(">");
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(tokens);
  }
  return routes;
}

/** Assets a venue lets you earn on (deposit/supply into a yield-bearing position). */
export function earnableAssets(rows: readonly VenueKnowledge[]): string[] {
  return [...new Set(rows.filter((r) => r.executable).flatMap((r) => r.capabilities.filter((c) => c.verb === "deposit" || (c.verb === "supply" && c.note !== "collateral")).map((c) => c.from)))].filter((a) => a !== "*").sort();
}

/** The annual risk penalty in bps for a venue tier and an owner's appetite. */
export function riskPenaltyBps(tier: RiskTier, appetite: RiskTier): number {
  return RISK_PENALTY_BPS[tier] * APPETITE_MULTIPLIER[appetite];
}

/** A compact, model-friendly view of one venue (for Lyko's tool and the API index). */
export function venueBrief(row: VenueKnowledge): Record<string, unknown> {
  return {
    venue: row.venue,
    purpose: row.purpose,
    executable: row.executable,
    risk: { tier: row.risk.tier, oracle: row.risk.oracle, admin: row.risk.admin, upgradeable: row.risk.upgradeable, ...(row.risk.curator ? { curator: row.risk.curator } : {}) },
    can: row.capabilities.map((c) => `${c.verb} ${c.from} -> ${c.to}${c.settlement === "async" ? ` (async, ~${c.delaySeconds}s)` : ""}`),
    functions: row.functions.map((f) => f.abi.replace(/^function /u, "").replace(/\).*$/u, ")")),
  };
}
