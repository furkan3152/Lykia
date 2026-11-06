/**
 * The Arc ecosystem as Lykia sees it: every protocol in the registry, its
 * status, what Lykia can do with it, its TVL on Arc (DefiLlama, cached) and
 * the value Lykia has actually routed to it (settled steps in stored
 * intents). Circle's products sit alongside, from circle/status.ts.
 *
 * Nothing here is estimated: TVL is null when DefiLlama does not list the
 * protocol on Arc, and routed volume counts only settled, priced steps.
 */
import { coverageLine, coverageOf, isLive, PROTOCOLS, registryCoverage, type ArcEnvironment, type IntentGraph, type ProtocolCategory, type ProtocolCoverage } from "@lykia/core";
import type { AppContext } from "../context.js";
import { circleStatus } from "../circle/status.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { DEFAULT_PER_DAY, DEFAULT_PER_MINUTE } from "../platform/keys.js";
import type { JsonValue } from "../store/types.js";
import { settlementMode } from "../x402/x402.js";
import { listAll } from "../store/types.js";

const DEFILLAMA_PROTOCOLS = "https://api.llama.fi/protocols";
const TVL_TTL_MS = 30 * 60_000;
const VOLUME_TTL_MS = 5 * 60_000;

/** Registry ids whose DefiLlama slug differs. */
const LLAMA_SLUGS: Readonly<Record<string, string>> = {
  gateway: "circle-gateway",
  "aerodrome-slipstream": "aero-slipstream",
  argus: "argus-world",
  archery: "archery-v3",
  synthra: "synthra-v3",
  "vfat-io": "vfat.io",
};

/** The official Arc ecosystem directory, which Lykia links to rather than competes with. */
const ARC_ECOSYSTEM_DIRECTORY = "https://www.arc.io/ecosystem";

/**
 * Registry id -> slug of the protocol's official entry on arc.io/ecosystem
 * (slugs read from the directory on 2026-11-01). Ids without an entry link nowhere.
 */
const ARC_ECOSYSTEM_SLUGS: Readonly<Record<string, string>> = {
  "aave-v4": "aave",
  "uniswap-v2": "uniswap",
  "uniswap-v3": "uniswap",
  "uniswap-v4": "uniswap",
  "morpho-vaults": "morpho",
  "morpho-blue": "morpho",
  "curve-lite": "curve",
  "aerodrome-slipstream": "dromos-labs",
  chainlink: "chainlink",
  pyth: "pyth",
  stork: "stork",
  kaleido: "kaleido",
  argus: "argus",
  faze: "faze",
  tolly: "tolly",
  safe: "safe",
  zerox: "0x",
  relay: "relay",
  "layerzero-v2": "layerzero",
  wormhole: "wormhole",
  "zerodev-kernel": "zerodev",
  seaport: "opensea",
};

export function arcEcosystemUrl(id: string): string | null {
  const slug = ARC_ECOSYSTEM_SLUGS[id];
  return slug ? `${ARC_ECOSYSTEM_DIRECTORY}/${slug}` : null;
}

export interface EcosystemProtocol {
  readonly id: string;
  readonly name: string;
  readonly category: ProtocolCategory;
  readonly summary: string;
  readonly website: string | null;
  readonly status: "verified" | "announced";
  /** Contracts checked with eth_getCode and listed with evidence. */
  readonly evidence: string | null;
  /** What Lykia can do with it today: route (execute), read (prices, positions) or list. */
  readonly lykia: "routes" | "reads" | "lists";
  /** The same, in the words the pages use: routable, read-only or mapped (core coverageOf). */
  readonly coverage: ProtocolCoverage;
  readonly verbs: readonly string[];
  readonly tvlUsd: number | null;
  readonly routed: { readonly steps: number; readonly usd: string };
  /** The protocol's official entry in the Arc ecosystem directory, when it has one. */
  readonly arcEcosystem: string | null;
}

export interface EcosystemResponse {
  readonly environment: ArcEnvironment;
  readonly positioning: string;
  /** The official directory this hub reconciles with. */
  readonly directory: { readonly url: string; readonly note: string };
  readonly protocols: readonly EcosystemProtocol[];
  readonly totals: {
    /** Every registry entry on the network: what Lykia has mapped on Arc. */
    readonly protocols: number;
    readonly verified: number;
    /** Venues with an executable adapter: what Lykia can route through today. */
    readonly routable: number;
    readonly readOnly: number;
    readonly mapped: number;
    /** "9 venues Lykia can route through today · 94 protocols mapped on Arc", from the counts above. */
    readonly summary: string;
    readonly tvlUsd: number | null;
    readonly routed: { readonly intents: number; readonly steps: number; readonly usd: string; readonly window: string };
  };
  readonly circle: readonly { readonly id: string; readonly name: string; readonly state: string; readonly lykia: string; readonly docs: string }[];
  readonly pulse: { readonly block: number; readonly blockTimeMs: number | null; readonly tps: number | null; readonly transferCostUsd: string | null; readonly finality: "deterministic" } | null;
  readonly builders: { readonly freeTier: { readonly perMinute: number; readonly perDay: number }; readonly x402: { readonly mode: string; readonly note: string }; readonly guide: string };
  readonly sources: { readonly tvl: string; readonly tvlAt: string | null; readonly routedAt: string };
  readonly at: string;
}

const POSITIONING = "Built on Arc Network and Circle's products: every Arc protocol mapped, the ones with an executable adapter routable on Lykia, and every agent inside its Fence.";

interface TvlCache {
  readonly at: number;
  readonly arc: Record<string, number>;
}

let tvlMemo: TvlCache | null = null;

/** DefiLlama TVL on Arc by slug. One fetch per half hour, kept in memory and the store. */
async function arcTvl(ctx: AppContext): Promise<TvlCache | null> {
  const now = ctx.clock.now();
  if (tvlMemo && now - tvlMemo.at < TVL_TTL_MS) return tvlMemo;
  const stored = await ctx.store.collection<JsonValue>("ecosystem_cache").get("tvl").catch(() => null);
  const kept = stored?.value as unknown as TvlCache | undefined;
  if (kept && now - kept.at < TVL_TTL_MS) return (tvlMemo = kept);
  try {
    const response = await ctx.fetch(DEFILLAMA_PROTOCOLS, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return kept ?? tvlMemo;
    const rows = (await response.json()) as { slug?: string; chains?: string[]; chainTvls?: Record<string, number> }[];
    const arc: Record<string, number> = {};
    for (const row of rows) {
      const value = row.chainTvls?.Arc;
      if (row.slug && Array.isArray(row.chains) && row.chains.includes("Arc") && typeof value === "number" && Number.isFinite(value)) arc[row.slug] = Math.round(value);
    }
    tvlMemo = { at: now, arc };
    await ctx.store.collection<JsonValue>("ecosystem_cache").put("tvl", tvlMemo as unknown as JsonValue, { ttlMs: 24 * 3600_000 }).catch(() => undefined);
    return tvlMemo;
  } catch {
    return kept ?? tvlMemo;
  }
}

interface VolumeCache {
  readonly at: number;
  readonly environment: ArcEnvironment;
  readonly intents: number;
  readonly byVenue: Record<string, { steps: number; cents: number }>;
}

const volumeMemo = new Map<ArcEnvironment, VolumeCache>();

function centsOf(usd: string | null | undefined): number {
  if (!usd || !/^\d+(?:\.\d+)?$/u.test(usd)) return 0;
  return Math.round(Number(usd) * 100);
}

/** Value Lykia has routed: settled, priced steps of stored intents (the store keeps intents for their TTL). */
export async function routedVolume(ctx: AppContext, environment: ArcEnvironment): Promise<VolumeCache> {
  const now = ctx.clock.now();
  const memo = volumeMemo.get(environment);
  if (memo && now - memo.at < VOLUME_TTL_MS) return memo;
  const docs = await listAll(ctx.store.collection<JsonValue>("intents")).catch(() => []);
  const byVenue: Record<string, { steps: number; cents: number }> = {};
  let intents = 0;
  for (const doc of docs) {
    const graph = (doc.value as unknown as { graph?: IntentGraph }).graph;
    if (!graph || graph.environment !== environment) continue;
    let counted = false;
    for (const step of graph.steps) {
      if (step.status !== "settled" || step.kind === "approve") continue;
      const cents = Math.max(...step.inputs.map((i) => centsOf(i.usd)), 0);
      const row = (byVenue[step.venue] ??= { steps: 0, cents: 0 });
      row.steps += 1;
      row.cents += cents;
      counted = true;
    }
    if (counted) intents += 1;
  }
  const result: VolumeCache = { at: now, environment, intents, byVenue };
  volumeMemo.set(environment, result);
  return result;
}

function usdOfCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function ecosystem(ctx: AppContext, environment: ArcEnvironment): Promise<EcosystemResponse> {
  const now = ctx.clock.now();
  const [tvl, volume] = await Promise.all([arcTvl(ctx), routedVolume(ctx, environment)]);
  const executable = EXECUTABLE_VENUES[environment];
  const protocols: EcosystemProtocol[] = PROTOCOLS.filter((p) => p.deployments[environment] !== undefined).map((p) => {
    const deployment = p.deployments[environment];
    const verified = isLive(p, environment);
    const coverage = coverageOf(p, environment, executable);
    const slug = LLAMA_SLUGS[p.id] ?? p.id;
    const routed = volume.byVenue[p.id] ?? { steps: 0, cents: 0 };
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      summary: p.summary,
      website: p.website ?? null,
      status: verified ? "verified" : "announced",
      evidence: verified ? (deployment?.evidence ?? null) : null,
      lykia: coverage === "routable" ? "routes" : coverage === "read-only" ? "reads" : "lists",
      coverage,
      verbs: p.verbs,
      tvlUsd: tvl && environment === "mainnet" ? (tvl.arc[slug] ?? null) : null,
      routed: { steps: routed.steps, usd: usdOfCents(routed.cents) },
      arcEcosystem: arcEcosystemUrl(p.id),
    };
  });
  const counts = registryCoverage(environment, executable);
  const order = { routes: 0, reads: 1, lists: 2 } as const;
  protocols.sort((a, b) => order[a.lykia] - order[b.lykia] || (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1) || a.name.localeCompare(b.name));
  const tvls = protocols.map((p) => p.tvlUsd).filter((v): v is number => v !== null);
  const routedSteps = Object.values(volume.byVenue).reduce((n, r) => n + r.steps, 0);
  const routedCents = Object.values(volume.byVenue).reduce((n, r) => n + r.cents, 0);
  const pulse = ctx.pulse.latest(environment);
  const x402 = settlementMode(ctx);
  return {
    environment,
    positioning: POSITIONING,
    directory: { url: ARC_ECOSYSTEM_DIRECTORY, note: "The official Arc ecosystem directory. This hub maps those protocols, marks each one routable, read-only or mapped on Lykia, and links each to its official entry." },
    protocols,
    totals: {
      ...counts,
      summary: coverageLine(counts),
      tvlUsd: tvls.length > 0 ? tvls.reduce((a, b) => a + b, 0) : null,
      routed: { intents: volume.intents, steps: routedSteps, usd: usdOfCents(routedCents), window: "Intents kept by the API (30 days)" },
    },
    circle: circleStatus(ctx.config, now).products.map((p) => ({ id: p.id, name: p.name, state: p.state, lykia: p.lykia, docs: p.docs })),
    pulse: pulse ? { block: pulse.block, blockTimeMs: pulse.blockTimeMs, tps: pulse.tps, transferCostUsd: pulse.transferCostUsd, finality: pulse.finality } : null,
    builders: { freeTier: { perMinute: DEFAULT_PER_MINUTE, perDay: DEFAULT_PER_DAY }, x402: { mode: x402.mode, note: x402.note }, guide: "/build#integrate" },
    sources: { tvl: "DefiLlama (chainTvls.Arc)", tvlAt: tvl ? new Date(tvl.at).toISOString() : null, routedAt: new Date(volume.at).toISOString() },
    at: new Date(now).toISOString(),
  };
}
