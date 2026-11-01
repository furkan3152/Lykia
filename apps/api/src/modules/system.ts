/**
 * System routes: health, the Arc registry (networks, tokens, contracts,
 * protocols) and the venue table with what this engine can execute.
 */
import { ARC_CONTRACTS, isLive, NETWORKS, PROTOCOLS, protocolsFor, TOKENS, tokenAddress, type Address } from "@lykia/core";
import type { HealthResponse } from "@lykia/core/api/arc";
import type { VenueRow, VenuesResponse } from "@lykia/core/api/intents";
import type { ApiModule } from "../http/router.js";
import { cachePublicly } from "../http/request.js";
import { parseQuery } from "../http/validate.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { practiceVenues } from "../engine/venues/practice.js";
import { environmentOf, environmentQuery } from "./common.js";
import { RUNTIME } from "../runtime.js";

export const systemModule: ApiModule = {
  name: "system",
  register(router, ctx) {
    router.get("/health", async (_req, res) => {
      const report = await ctx.health.report();
      const networks: HealthResponse["networks"] = {};
      for (const [key, probe] of Object.entries(report.networks)) if (probe) networks[key] = { reachable: probe.reachable, head: probe.head, latencyMs: probe.latencyMs };
      const reachable = Object.values(networks).filter((n) => n.reachable).length;
      const body: HealthResponse = {
        status: reachable === 0 ? "down" : reachable < Object.keys(networks).length || !report.store.ok ? "degraded" : "ok",
        version: ctx.config.version,
        environment: ctx.config.mode,
        uptimeSeconds: Math.floor((ctx.clock.now() - ctx.startedAt) / 1000),
        networks,
        store: { kind: report.store.kind, ok: report.store.ok },
        runtime: RUNTIME,
        persistence: ctx.store.kind === "postgres" ? "postgres" : "memory",
        beta: ctx.config.beta ? { ...ctx.config.beta, audited: false } : null,
        features: { agent: ctx.config.agent.anthropicApiKey !== null, stablefx: ctx.config.stablefxApiKey !== null, x402: ctx.config.x402.payTo !== null, x402Settlement: ctx.config.x402.facilitatorUrl !== null && (ctx.config.circle.apiKey !== null || !/circle\.com/u.test(ctx.config.x402.facilitatorUrl)) },
      };
      res.status(body.status === "down" ? 503 : 200).json(body);
    });

    router.get("/networks", async (_req, res) => {
      const report = await ctx.health.report();
      res.json({ networks: Object.values(NETWORKS).map((n) => ({ ...n, live: report.networks[n.key] ?? null })) });
    });

    router.get("/tokens", (req, res) => {
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      cachePublicly(res, 300);
      res.json({ environment, tokens: TOKENS.map((t) => ({ ...t, address: tokenAddress(t, environment) })) });
    });

    router.get("/contracts", (_req, res) => {
      cachePublicly(res, 300);
      res.json({ contracts: Object.values(ARC_CONTRACTS) });
    });

    router.get("/protocols", (req, res) => {
      const { environment } = parseQuery(req, environmentQuery);
      cachePublicly(res, 300);
      res.json({ protocols: environment ? protocolsFor(environment) : PROTOCOLS });
    });

    router.get("/venues", async (req, res) => {
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      const executable = EXECUTABLE_VENUES[environment];
      const venues: VenueRow[] = protocolsFor(environment).map((p) => ({ ...p, executable: executable.has(p.id), live: isLive(p, environment) }));
      if (environment === "testnet") {
        // Lykia's own practice venues: listed once deployed (packages/contracts), so every flow runs end to end on testnet.
        const practice = await practiceVenues("testnet");
        const contracts = Object.fromEntries(Object.entries({ vaultUsdc: practice.vaultUsdc, vaultEurc: practice.vaultEurc, swap: practice.swap, lending: practice.lending }).filter(([, a]) => a !== null)) as Record<string, Address>;
        const deployed = Object.keys(contracts).length > 0;
        venues.push({
          id: "lykia-practice",
          name: "Lykia practice venues",
          category: "vault",
          summary: deployed ? "Lykia's own testnet vault, USDC/EURC swap and cirBTC lending, so earn, FX and borrow can be tried end to end. Not audited." : "Lykia's testnet vault, swap and lending: not deployed yet.",
          deployments: deployed ? { testnet: { status: "testnet-live", contracts, evidence: practice.source } } : {},
          verbs: deployed ? ["deposit", "withdraw", "swap", "fx", "borrow", "repay", "approve"] : [],
          tags: ["practice", "testnet", "unaudited"],
          executable: deployed,
          live: deployed,
        });
      }
      const body: VenuesResponse = { environment, venues };
      cachePublicly(res, 60);
      res.json(body);
    });
  },
};
