/**
 * Serverless entry for Vercel Functions. One context and one Express app per
 * function instance, built on the first request and reused while the
 * instance lives (Fluid compute keeps instances warm). Module background
 * work (standing-order scheduler, intent poller) runs while the instance is
 * alive; `/cron/standing` lets Vercel Cron or any external pinger drive the
 * standing-order check explicitly, guarded by CRON_SECRET.
 *
 * Persistence: without LYKIA_DATABASE_URL / DATABASE_URL every instance keeps
 * its own memory store, so intents and sessions do not survive cold starts.
 * Attach Postgres (Vercel Marketplace Neon sets DATABASE_URL) for real use.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createContext, type AppContext } from "./context.js";
import { MODULES } from "./modules/index.js";
import { startModules } from "./server.js";
import { services } from "./services.js";

interface Instance {
  readonly ctx: AppContext;
  readonly app: Express;
}

let instance: Instance | null = null;

function current(): Instance {
  if (instance) return instance;
  const ctx = createContext(loadConfig(process.env));
  const app = createApp(ctx);
  void startModules(ctx, MODULES);
  instance = { ctx, app };
  return instance;
}

function authorizedCron(req: IncomingMessage): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { ctx, app } = current();
  if (req.url?.split("?")[0] === "/cron/standing") {
    if (!authorizedCron(req)) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Set CRON_SECRET and send it as a Bearer token." } }));
      return;
    }
    const fired = await services(ctx).standing.tick();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ fired }));
    return;
  }
  app(req as Parameters<Express>[0], res as Parameters<Express>[1]);
}
