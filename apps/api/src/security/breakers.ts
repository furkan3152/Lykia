/**
 * Protocol circuit breakers (layer 5). Every registry venue gets a state
 * from its health facts: the global halt (`routing.halt`), an admin's
 * per-venue switch, Chainlink staleness and the Chainlink vs Pyth gap for
 * venues that price through oracles, and `paused()` read live from the
 * contracts a step calls. Snapshots are cached for a minute per process.
 */
import { protocolsFor, type ArcEnvironment } from "@lykia/core";
import { venueBreaker, type VenueBreaker, type VenueHealthFacts } from "@lykia/core/security/index";
import { parseAbi, type Address } from "viem";
import type { AppContext } from "../context.js";
import { deviationBps, pythPrices } from "../oracles/pyth.js";
import { flags } from "../platform/admin.js";
import { typedCollection } from "../platform/typed.js";
import { services } from "../services.js";

const PAUSED_ABI = parseAbi(["function paused() view returns (bool)"]);
const CACHE_MS = 60_000;
const ORACLE_KINDS = new Set(["swap", "fx", "borrow", "supply"]);

export interface VenueSwitch {
  readonly disabled: boolean;
  readonly reason: string;
  readonly by: string;
  readonly at: string;
}

const switches = (ctx: AppContext) => typedCollection<VenueSwitch>(ctx, "security_venues");

export async function isHalted(ctx: AppContext): Promise<boolean> {
  return ((await flags(ctx)) as Record<string, boolean>)["routing.halt"] === true;
}

export async function setVenueSwitch(ctx: AppContext, venue: string, value: VenueSwitch): Promise<void> {
  cache.delete(ctx);
  if (value.disabled) await switches(ctx).put(venue, value);
  else await switches(ctx).delete(venue);
}

export function clearBreakerCache(ctx: AppContext): void {
  cache.delete(ctx);
}

interface OracleHealth {
  readonly ageSeconds: number | null;
  readonly deviationBps: number | null;
}

async function oracleHealth(ctx: AppContext, environment: ArcEnvironment): Promise<OracleHealth> {
  const now = ctx.clock.now();
  try {
    const [cl, py] = await Promise.all([services(ctx).prices.prices(["EURC", "cirBTC"]), pythPrices(ctx.chains, ["EURC", "cirBTC"], now).catch(() => ({}) as Record<string, { price: string | null }>)]);
    const ages = Object.values(cl).map((q) => (q.updatedAt ? (now - new Date(q.updatedAt).getTime()) / 1000 : null)).filter((a): a is number => a !== null && Number.isFinite(a));
    const gaps = ["EURC", "cirBTC"].map((s) => deviationBps(cl[s]?.usd ?? null, (py as Record<string, { price: string | null }>)[s]?.price ?? null)).filter((g): g is number => g !== null);
    void environment;
    return { ageSeconds: ages.length > 0 ? Math.max(...ages) : null, deviationBps: gaps.length > 0 ? Math.max(...gaps) : null };
  } catch {
    return { ageSeconds: null, deviationBps: null };
  }
}

const cache = new WeakMap<AppContext, { at: number; environment: ArcEnvironment; venues: VenueBreaker[] }>();

export async function venueBreakers(ctx: AppContext, environment: ArcEnvironment): Promise<VenueBreaker[]> {
  const hit = cache.get(ctx);
  if (hit && hit.environment === environment && ctx.clock.now() - hit.at < CACHE_MS) return hit.venues;
  const [halted, list, oracle] = await Promise.all([isHalted(ctx), switches(ctx).list({ limit: 1000 }), oracleHealth(ctx, environment)]);
  const off = new Map(list.map((d) => [d.id, d.value]));
  const venues = protocolsFor(environment)
    .filter((p) => p.verbs.length > 0)
    .map((p) => {
      const facts: VenueHealthFacts = {
        venue: p.id,
        halted,
        disabled: off.get(p.id) ?? null,
        ...(p.verbs.some((v) => ORACLE_KINDS.has(v)) ? { oracleAgeSeconds: oracle.ageSeconds, deviationBps: oracle.deviationBps } : {}),
      };
      return venueBreaker(facts);
    });
  cache.set(ctx, { at: ctx.clock.now(), environment, venues });
  return venues;
}

/** Live `paused()` for the contracts a step calls; contracts without the function read as null. */
export async function pausedTargets(ctx: AppContext, environment: ArcEnvironment, targets: readonly Address[]): Promise<Address[]> {
  if (targets.length === 0) return [];
  try {
    const results = await ctx.chains.client(environment).multicall({ contracts: targets.map((address) => ({ address, abi: PAUSED_ABI, functionName: "paused" }) as const), allowFailure: true });
    return targets.filter((_, i) => results[i]?.status === "success" && results[i]?.result === true);
  } catch {
    return [];
  }
}
