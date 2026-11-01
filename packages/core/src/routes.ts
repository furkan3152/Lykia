/**
 * Route choices: why the engine put money where it did. Every step that had
 * more than one live venue carries the chosen option, the alternatives it
 * beat and one plain sentence of reasoning, so a person (or an agent) can
 * check the choice instead of trusting it.
 *
 * Pure: ranking helpers only, no I/O.
 */

/** How much can go wrong at a venue, from its size, curation and oracle. */
export type RiskTier = "low" | "medium" | "high";

export const RISK_ORDER: readonly RiskTier[] = ["low", "medium", "high"];

export interface VenueOption {
  /** Registry venue id ("morpho-vaults", "aave-v4", "uniswap-v3"). */
  readonly venue: string;
  /** Human name of the exact place ("Morpho Galaxy USDC", "Uniswap v3 0.05%"). */
  readonly label: string;
  /** Swaps: expected output in base units of the output token. */
  readonly amountOut?: string;
  /** Swaps: output after the gas cost, in base units of the output token. */
  readonly netAmountOut?: string;
  /** Yields: APY as a decimal fraction string ("0.0612"); null = not readable. */
  readonly apy?: string | null;
  /** Where the APY came from ("Morpho API", "Aave API", "on-chain"). */
  readonly apySource?: string;
  /** Total value locked, USD decimal string; null = unknown. */
  readonly tvlUsd?: string | null;
  /** Borrow: projected health factor after the step. */
  readonly healthFactor?: string | null;
  readonly risk: RiskTier;
  /** Can Lykia execute this option today? */
  readonly executable: boolean;
  readonly notes: readonly string[];
}

export interface RouteChoice {
  readonly chosen: VenueOption;
  readonly alternatives: readonly VenueOption[];
  /** One sentence: why this one. */
  readonly reason: string;
  /** Set when the amount was split across options. */
  readonly split?: readonly { readonly option: VenueOption; readonly shareBps: number }[];
}

/** Risk from TVL alone: the floor of the assessment (curation can raise it, never lower it). */
export function riskFromTvl(tvlUsd: number | null): RiskTier {
  if (tvlUsd === null) return "high";
  if (tvlUsd >= 10_000_000) return "low";
  if (tvlUsd >= 1_000_000) return "medium";
  return "high";
}

export function riskAtMost(risk: RiskTier, max: RiskTier): boolean {
  return RISK_ORDER.indexOf(risk) <= RISK_ORDER.indexOf(max);
}

function apyNumber(o: VenueOption): number {
  return o.apy === null || o.apy === undefined ? -1 : Number(o.apy);
}

export function formatApy(apy: string | null | undefined): string {
  if (apy === null || apy === undefined) return "APY unknown";
  return `${(Number(apy) * 100).toFixed(2)}% APY`;
}

function formatTvl(tvl: string | null | undefined): string {
  if (tvl === null || tvl === undefined) return "TVL unknown";
  const n = Number(tvl);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M TVL`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k TVL`;
  return `$${n.toFixed(0)} TVL`;
}

/**
 * Picks the highest-APY executable yield option within `maxRisk`; ties go
 * to the larger venue. Falls back to the safest executable one when nothing
 * fits the risk ceiling. Null when nothing is executable.
 */
export function chooseYield(options: readonly VenueOption[], maxRisk: RiskTier = "medium"): RouteChoice | null {
  const executable = options.filter((o) => o.executable);
  if (executable.length === 0) return null;
  const fits = executable.filter((o) => riskAtMost(o.risk, maxRisk));
  const pool = fits.length > 0 ? fits : [...executable].sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk)).slice(0, 1);
  const ranked = [...pool].sort((a, b) => apyNumber(b) - apyNumber(a) || Number(b.tvlUsd ?? 0) - Number(a.tvlUsd ?? 0));
  const chosen = ranked[0] as VenueOption;
  const alternatives = options.filter((o) => o !== chosen);
  const runnerUp = ranked[1];
  const skipped = executable.filter((o) => !riskAtMost(o.risk, maxRisk) && apyNumber(o) > apyNumber(chosen));
  let reason = `${chosen.label}: ${formatApy(chosen.apy)}${chosen.apySource ? ` (${chosen.apySource})` : ""}, ${formatTvl(chosen.tvlUsd)}, ${chosen.risk} risk`;
  if (runnerUp) reason += `; chosen over ${runnerUp.label} (${formatApy(runnerUp.apy)})`;
  if (skipped.length > 0) reason += `; ${skipped.map((s) => s.label).join(", ")} pay more but sit above the ${maxRisk}-risk ceiling`;
  if (fits.length === 0) reason += `; nothing fits ${maxRisk} risk, so the safest venue was taken`;
  return { chosen, alternatives, reason: `${reason}.` };
}

/** Picks the executable swap option with the largest net output. */
export function chooseSwap(options: readonly VenueOption[]): RouteChoice | null {
  const executable = options.filter((o) => o.executable && (o.netAmountOut ?? o.amountOut) !== undefined);
  if (executable.length === 0) return null;
  const net = (o: VenueOption) => BigInt(o.netAmountOut ?? o.amountOut ?? "0");
  const ranked = [...executable].sort((a, b) => (net(b) > net(a) ? 1 : net(b) < net(a) ? -1 : 0));
  const chosen = ranked[0] as VenueOption;
  const runnerUp = ranked[1];
  let reason = `${chosen.label} gives the most after gas`;
  if (runnerUp && net(chosen) > 0n) {
    const edgeBps = Number(((net(chosen) - net(runnerUp)) * 10_000n) / net(chosen));
    reason += `, ${edgeBps} bps more than ${runnerUp.label}`;
  }
  const better = options.filter((o) => !o.executable && BigInt(o.amountOut ?? "0") > net(chosen));
  if (better.length > 0) reason += `; ${better.map((b) => b.label).join(", ")} quote higher but Lykia cannot execute ${better.length === 1 ? "it" : "them"} yet`;
  return { chosen, alternatives: options.filter((o) => o !== chosen), reason: `${reason}.` };
}

/** Picks the cheapest executable borrow option whose projected health factor stays at or above `minHealth`. */
export function chooseBorrow(options: readonly VenueOption[], minHealth: string): RouteChoice | null {
  const min = Number(minHealth);
  const executable = options.filter((o) => o.executable);
  const safe = executable.filter((o) => o.healthFactor !== null && o.healthFactor !== undefined && Number(o.healthFactor) >= min);
  if (safe.length === 0) return null;
  const ranked = [...safe].sort((a, b) => apyNumber(a) - apyNumber(b));
  const chosen = ranked[0] as VenueOption;
  const runnerUp = ranked[1];
  let reason = `${chosen.label}: borrow at ${formatApy(chosen.apy).replace("APY", "APR")}, health factor ${Number(chosen.healthFactor).toFixed(2)} after the step (floor ${minHealth})`;
  if (runnerUp) reason += `; cheaper than ${runnerUp.label} (${formatApy(runnerUp.apy).replace("APY", "APR")})`;
  const unsafe = executable.filter((o) => !safe.includes(o));
  if (unsafe.length > 0) reason += `; ${unsafe.map((u) => u.label).join(", ")} would leave the health factor under ${minHealth}`;
  return { chosen, alternatives: options.filter((o) => o !== chosen), reason: `${reason}.` };
}
