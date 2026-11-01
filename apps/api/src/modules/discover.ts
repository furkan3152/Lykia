/**
 * Discover, perps market data and the activity tracker.
 *
 *   GET /discover/launches?environment=   new pools on Arc AMMs with token trust, plus launchpads
 *   GET /perps/markets                    Extended perpetuals markets (read-only, off-Arc engine)
 *   GET /perps/markets/:market            candles (1h, 7d), order book, recent trades
 *   GET /activity?environment=            the session owner's intents, orders and alerts in one feed
 *   GET /track/:hash?environment=         any Arc transaction: status and labelled logs
 *   GET /watch, POST /watch, DELETE /watch/:address   the session owner's watched addresses
 */
import { type Address } from "@lykia/core";
import { z } from "zod";
import { discoverService } from "../discover/service.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { mustSession } from "../platform/session.js";
import { ownerActivity, trackTx, watchAdd, watchlist, watchRemove } from "../track/service.js";
import { environmentOf, environmentQuery } from "./common.js";

const MarketParams = z.object({ market: z.string().min(3).max(16) });

export const discoverModule: ApiModule = {
  name: "discover",
  register(router, ctx) {
    router.get("/discover/launches", ctx.limits.heavy, async (req, res) => {
      const q = parseQuery(req, environmentQuery);
      res.json(await discoverService(ctx).launches(environmentOf(ctx, q.environment)));
    });
    router.get("/perps/markets", async (_req, res) => {
      res.json(await discoverService(ctx).perpsMarkets());
    });
    router.get("/perps/markets/:market", async (req, res) => {
      const { market } = parseParams(req, MarketParams);
      res.json(await discoverService(ctx).perpsMarket(market.toUpperCase()));
    });
    router.get("/activity", async (req, res) => {
      const q = parseQuery(req, environmentQuery);
      const session = await mustSession(ctx, req);
      res.json(await ownerActivity(ctx, environmentOf(ctx, q.environment), session.address as Address));
    });
    router.get("/track/:hash", async (req, res) => {
      const { hash } = parseParams(req, z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/u) }));
      const q = parseQuery(req, environmentQuery);
      res.json(await trackTx(ctx, environmentOf(ctx, q.environment), hash as `0x${string}`));
    });
    router.get("/watch", async (req, res) => {
      res.json({ items: await watchlist(ctx, (await mustSession(ctx, req)).address as Address) });
    });
    router.post("/watch", async (req, res) => {
      const b = parseBody(req, z.object({ address: evmAddress, label: z.string().max(40).default("") }));
      res.status(201).json({ items: await watchAdd(ctx, (await mustSession(ctx, req)).address as Address, b.address as Address, b.label) });
    });
    router.delete("/watch/:address", async (req, res) => {
      const { address } = parseParams(req, z.object({ address: evmAddress }));
      res.json({ removed: await watchRemove(ctx, (await mustSession(ctx, req)).address as Address, address) });
    });
  },
};
