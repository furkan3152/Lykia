/** Per-context service graph, built lazily once per AppContext. */
import type { AppContext } from "./context.js";
import { PriceService } from "./arc/prices.js";
import { IntentService } from "./engine/service.js";
import { Planner } from "./engine/planner.js";
import { VenueRouter } from "./engine/router.js";
import { StandingService } from "./engine/standing.js";
import { RouteSearch } from "./engine/search.js";
import { YieldService } from "./engine/venues/yields.js";
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
  readonly yields: YieldService;
  readonly router: VenueRouter;
  readonly standing: StandingService;
  readonly search: RouteSearch;
}

const SERVICES = new WeakMap<AppContext, Services>();

export function services(ctx: AppContext): Services {
  const existing = SERVICES.get(ctx);
  if (existing) return existing;
  const prices = new PriceService({ chains: ctx.chains, clock: ctx.clock });
  const flock = new FlockService({ chains: ctx.chains, prices, clock: ctx.clock, fetch: ctx.fetch, log: ctx.log.child({ component: "flock" }) });
  const scent = new ScentService({ chains: ctx.chains, clock: ctx.clock });
  const yields = new YieldService({ fetch: ctx.fetch, clock: ctx.clock });
  const router = new VenueRouter({ chains: ctx.chains, prices, yields });
  const planner = new Planner({ chains: ctx.chains, prices, fetch: ctx.fetch, stablefxConfigured: ctx.config.stablefxApiKey !== null, router, fee: ctx.config.fee, beta: ctx.config.beta });
  const intents = new IntentService({ planner, chains: ctx.chains, store: ctx.store, clock: ctx.clock, bus: ctx.bus, fetch: ctx.fetch, log: ctx.log.child({ component: "intents" }) });
  const kunye = new KunyeService({ chains: ctx.chains, store: ctx.store, fetch: ctx.publicFetch, guard: ctx.config.guardAddress });
  const standing = new StandingService({ chains: ctx.chains, store: ctx.store, clock: ctx.clock, bus: ctx.bus, log: ctx.log.child({ component: "standing" }), intents: () => intents });
  const search = new RouteSearch({ planner, router, chains: ctx.chains, now: () => ctx.clock.now() });
  const built = { prices, flock, scent, planner, intents, kunye, yields, router, standing, search };
  SERVICES.set(ctx, built);
  return built;
}
