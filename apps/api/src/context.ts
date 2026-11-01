/**
 * AppContext: everything a module needs, built once per process from
 * Config. Tests build one with fakes through `overrides`.
 */
import { EventBus } from "./bus.js";
import { ArcChains, type ArcChainsOptions } from "./chains/arc.js";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import type { Config } from "./config.js";
import { DependencyMonitor, type FetchLike } from "./health/dependencies.js";
import { createHttpLimits, type HttpLimits } from "./http/limits.js";
import { createLogger, type Logger } from "./log.js";
import { PulseService, type PulseFeed } from "./arc/pulse.js";
import { createStore } from "./store/index.js";
import type { Store } from "./store/types.js";

export type { FetchLike };

export interface AppContext {
  readonly config: Config;
  readonly log: Logger;
  readonly store: Store;
  readonly chains: ArcChains;
  readonly pulse: PulseFeed;
  readonly health: DependencyMonitor;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly limits: HttpLimits;
  /** Outbound HTTP (Circle APIs, card fetches); a seam for tests. */
  readonly fetch: FetchLike;
  readonly startedAt: number;
}

export interface ContextOverrides {
  readonly log?: Logger;
  readonly clock?: Clock;
  readonly store?: Store;
  readonly fetch?: FetchLike;
  readonly chains?: ArcChains;
  readonly chainOptions?: ArcChainsOptions;
  readonly pulse?: PulseFeed;
  readonly limits?: HttpLimits;
}

export function createContext(config: Config, overrides: ContextOverrides = {}): AppContext {
  const clock = overrides.clock ?? systemClock;
  const log = overrides.log ?? createLogger({ level: config.logLevel, base: { service: "lykia-api" }, clock });
  const fetchImpl: FetchLike = overrides.fetch ?? ((input, init) => fetch(input, init));
  const bus = new EventBus(log.child({ component: "bus" }));
  const store = overrides.store ?? createStore({ databaseUrl: config.databaseUrl, clock, log: log.child({ component: "store" }) });
  const chains = overrides.chains ?? new ArcChains(config.networks, overrides.chainOptions);
  const pulse = overrides.pulse ?? new PulseService({ chains, clock, log: log.child({ component: "pulse" }), bus });
  const health = new DependencyMonitor({ networks: config.networks, store, clock, fetch: fetchImpl });
  const limits = overrides.limits ?? createHttpLimits(config.rateLimits);
  return { config, log, store, chains, pulse, health, bus, clock, limits, fetch: fetchImpl, startedAt: clock.now() };
}

export async function closeContext(ctx: AppContext): Promise<void> {
  ctx.pulse.close();
  ctx.bus.clear();
  await ctx.store.close().catch((error: unknown) => {
    ctx.log.warn("store close failed", { error: error instanceof Error ? error.message : String(error) });
  });
}
