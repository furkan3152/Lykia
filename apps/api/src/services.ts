/** Per-context service graph, built lazily once per AppContext. */
import type { AppContext } from "./context.js";
import { PriceService } from "./arc/prices.js";
import { IntentService } from "./engine/service.js";
import { Planner } from "./engine/planner.js";
import { FlockService } from "./flock/flock.js";
import { KunyeService } from "./kunye/kunye.js";
import { ScentService } from "./scent/scent.js";

export interface Services {
  readonly prices: PriceService;
  readonly flock: FlockService;
  readonly scent: ScentService;
  readonly planner: Planner;
  readonly intents: IntentService;
  readonly kunye: KunyeService;
}

const SERVICES = new WeakMap<AppContext, Services>();

export function services(ctx: AppContext): Services {
  const existing = SERVICES.get(ctx);
  if (existing) return existing;
  const prices = new PriceService({ chains: ctx.chains, clock: ctx.clock });
  const flock = new FlockService({ chains: ctx.chains, prices, clock: ctx.clock, fetch: ctx.fetch, log: ctx.log.child({ component: "flock" }) });
  const scent = new ScentService({ chains: ctx.chains, clock: ctx.clock });
  const planner = new Planner({ chains: ctx.chains, prices, fetch: ctx.fetch, stablefxConfigured: ctx.config.stablefxApiKey !== null });
  const intents = new IntentService({ planner, chains: ctx.chains, store: ctx.store, clock: ctx.clock, bus: ctx.bus, fetch: ctx.fetch, log: ctx.log.child({ component: "intents" }) });
  const kunye = new KunyeService({ chains: ctx.chains, store: ctx.store, fetch: ctx.fetch });
  const built = { prices, flock, scent, planner, intents, kunye };
  SERVICES.set(ctx, built);
  return built;
}
