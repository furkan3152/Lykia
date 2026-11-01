/**
 * Public traction numbers for grant applications and the /stats page.
 * Aggregates only: no addresses, keys, emails or anything personal.
 *
 *  - on chain: Lykia's recorded contracts on Arc and, for the account
 *    factory, the accounts it created (a contract's nonce counts its CREATE2
 *    deployments, so `nonce - 1` is the clone count; one cheap RPC read);
 *  - routed: settled steps and value from the intents the API keeps (every
 *    value-moving step carries an Arc Memo with its verdict digest);
 *  - platform: developer keys and integrator projects (counts only);
 *  - ecosystem: protocols in the registry and how many Lykia can route.
 *
 * Every number says where it comes from; a number that could not be read is
 * null, never zero. Cached for five minutes in memory (no timers).
 */
import { isLive, PROTOCOLS, type ArcEnvironment, type IntentGraph } from "@lykia/core";
import type { AppContext } from "../context.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { routedVolume } from "../ecosystem/ecosystem.js";
import { listDeployments } from "../platform/admin.js";
import type { JsonValue } from "../store/types.js";

const TTL_MS = 5 * 60_000;
const SCAN_LIMIT = 1000;

export interface StatsResponse {
  readonly environment: ArcEnvironment;
  readonly onchain: {
    readonly contracts: readonly { readonly name: string; readonly address: string }[];
    readonly accountsCreated: number | null;
    readonly memoSteps: number;
    readonly verdictsIndexed: number | null;
  };
  readonly routed: { readonly intents: number; readonly steps: number; readonly usd: string; readonly window: string };
  readonly platform: { readonly developerKeys: number | null; readonly integrators: number | null; readonly agents: number | null; readonly capped: boolean };
  readonly ecosystem: { readonly protocols: number; readonly verified: number; readonly routable: number };
  readonly circle: { readonly productsUsed: readonly string[] };
  readonly sources: Readonly<Record<string, string>>;
  readonly at: string;
}

const memo = new Map<ArcEnvironment, { at: number; value: StatsResponse }>();

async function countOf(ctx: AppContext, name: string): Promise<number | null> {
  try {
    return (await ctx.store.collection<JsonValue>(name).list({ limit: SCAN_LIMIT })).length;
  } catch {
    return null;
  }
}

async function memoSteps(ctx: AppContext, environment: ArcEnvironment): Promise<number> {
  const docs = await ctx.store.collection<JsonValue>("intents").list({ limit: SCAN_LIMIT }).catch(() => []);
  let n = 0;
  for (const doc of docs) {
    const graph = (doc.value as unknown as { graph?: IntentGraph }).graph;
    if (!graph || graph.environment !== environment) continue;
    for (const step of graph.steps) if (step.status === "settled" && step.kind !== "approve") n += 1;
  }
  return n;
}

async function factoryAccounts(ctx: AppContext, environment: ArcEnvironment, factory: string | undefined): Promise<number | null> {
  if (!factory) return null;
  try {
    const nonce = await ctx.chains.client(environment).getTransactionCount({ address: factory as `0x${string}` });
    return Math.max(0, nonce - 1);
  } catch {
    return null;
  }
}

export async function publicStats(ctx: AppContext, environment: ArcEnvironment): Promise<StatsResponse> {
  const now = ctx.clock.now();
  const hit = memo.get(environment);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const deployments = await listDeployments(ctx, environment).catch(() => []);
  const factory = deployments.find((d) => d.contract === "LykiaAccountFactory")?.address;
  const [accountsCreated, steps, volume, keys, projects, agents, verdicts] = await Promise.all([
    factoryAccounts(ctx, environment, factory),
    memoSteps(ctx, environment),
    routedVolume(ctx, environment),
    countOf(ctx, "api_keys"),
    countOf(ctx, "projects"),
    countOf(ctx, "pack_agents"),
    countOf(ctx, "verdict_index"),
  ]);
  const executable = EXECUTABLE_VENUES[environment];
  const listed = PROTOCOLS.filter((p) => p.deployments[environment] !== undefined);
  const cents = Object.values(volume.byVenue).reduce((n, r) => n + r.cents, 0);
  const routedSteps = Object.values(volume.byVenue).reduce((n, r) => n + r.steps, 0);
  const capped = [keys, projects, agents, verdicts].some((v) => v === SCAN_LIMIT);
  const value: StatsResponse = {
    environment,
    onchain: { contracts: deployments.map((d) => ({ name: d.name, address: d.address })), accountsCreated, memoSteps: steps, verdictsIndexed: verdicts },
    routed: { intents: volume.intents, steps: routedSteps, usd: (cents / 100).toFixed(2), window: "Intents kept by the API (30 days)" },
    platform: { developerKeys: keys, integrators: projects, agents, capped },
    ecosystem: { protocols: listed.length, verified: listed.filter((p) => isLive(p, environment)).length, routable: listed.filter((p) => executable.has(p.id)).length },
    circle: { productsUsed: ["USDC", "EURC", "CCTP V2", "Gateway", "StableFX", "Developer-controlled wallets", "Agent Wallets policies", "Gas Station", "Compliance Engine", "x402 Facilitator", "Agent Marketplace"] },
    sources: {
      contracts: "Deployments recorded by the owner console, each verified with eth_getCode",
      accountsCreated: "LykiaAccountFactory nonce on Arc minus one (one CREATE2 per account)",
      memoSteps: "Settled value-moving steps; each carries an Arc Memo with its verdict digest",
      routed: "Settled, priced steps of intents kept by the API",
      platform: capped ? `Counts are capped at ${SCAN_LIMIT} per collection` : "Store counts, no personal data",
      ecosystem: "Lykia's protocol registry",
    },
    at: new Date(now).toISOString(),
  };
  memo.set(environment, { at: now, value });
  return value;
}
