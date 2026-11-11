/**
 * The /v1 router. Order matters:
 *
 *   no-store default -> body guards (413 / 415) -> JSON parser (256 KB)
 *   -> default per-IP rate limit -> Lykia-Version -> developer gate (keys,
 *   scopes, quotas, request log) -> Idempotency-Key -> personal-data guard
 *   -> modules (each on its
 *   own sub-router) -> 404 NOT_FOUND -> error envelope
 *
 * A module is `{ name, register(router, ctx) }`; it adds routes to the
 * router it is given (paths relative to /v1) and may add per-route
 * middleware such as `ctx.limits.heavy`. Express 5 forwards rejected
 * promises from async handlers to the error handler, so handlers simply
 * throw LykiaHttpError (or let zod/upstream errors propagate).
 */
import { idempotency } from "./idempotency.js";
import { personalGuard } from "../personal/guard.js";
import { apiVersionMiddleware, developerGate } from "../platform/gate.js";
import { drainWebhooksSoon } from "../platform/events.js";
import { tickOnTraffic } from "../scheduler.js";
import express, { type Express, type RequestHandler, type Router } from "express";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "./errors.js";
import { errorHandler, sendError } from "./request.js";
import { localeMiddleware } from "../i18n/index.js";

const MAX_BODY_BYTES = 256 * 1024;

export interface ApiModule {
  /** Short unique name (logs, diagnostics). */
  readonly name: string;
  register(router: Router, ctx: AppContext): void;
  /**
   * Optional routes outside /v1 (for example the Telegram webhook). They are
   * mounted on the app before /v1 and bring their own body parser and limits.
   */
  mountRoot?(app: Express, ctx: AppContext): void;
  /** Optional background work (pollers, schedulers), started after listen and stopped on shutdown. */
  start?(ctx: AppContext): void | Promise<void>;
  stop?(ctx: AppContext): void | Promise<void>;
}

function payloadTooLarge(): LykiaHttpError {
  return new LykiaHttpError("PAYLOAD_TOO_LARGE", 413, `Request bodies are limited to ${MAX_BODY_BYTES / 1024} KB.`);
}

/** 413 from Content-Length before reading the body; 415 for bodies that are not JSON. */
const bodyGuards: RequestHandler = (req, res, next) => {
  const declared = req.get("content-length");
  const length = declared === undefined ? 0 : Number(declared);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    sendError(req, res, payloadTooLarge());
    return;
  }
  const hasBody = req.get("transfer-encoding") !== undefined || (Number.isFinite(length) && length > 0);
  if (hasBody && req.method !== "GET" && req.method !== "HEAD" && req.is(["application/json", "application/*+json"]) === false) {
    sendError(req, res, new LykiaHttpError("UNSUPPORTED_MEDIA_TYPE", 415, "Send request bodies as application/json."));
    return;
  }
  next();
};

const noStore: RequestHandler = (_req, res, next) => {
  // Routes that serve shared data override this with cachePublicly().
  res.setHeader("Cache-Control", "no-store");
  next();
};

export function notFoundHandler(prefix = ""): RequestHandler {
  return (req, res) => {
    sendError(req, res, new LykiaHttpError("NOT_FOUND", 404, `No route for ${req.method} ${prefix}${req.path}.`));
  };
}

export function createV1Router(ctx: AppContext, modules: readonly ApiModule[]): Router {
  const router = express.Router();
  router.use(noStore);
  router.use(bodyGuards);
  router.use(express.json({ limit: MAX_BODY_BYTES, strict: true, type: ["application/json", "application/*+json"] }));
  // The interface language of this request: every sentence code writes for the owner follows it.
  router.use(localeMiddleware());
  router.use(ctx.limits.default);
  router.use(apiVersionMiddleware());
  router.use(developerGate(ctx));
  router.use(idempotency(ctx));
  // Profiles, memory and contacts are used only for an owner the request proved control of.
  router.use(personalGuard(ctx));
  // Serverless: webhook retries also drain on traffic, not only on a timer or the cron.
  // Scheduled passes (standing orders, orders, alerts, flows) also start on traffic, at most every 5 minutes across instances.
  router.use((_req, _res, next) => {
    drainWebhooksSoon(ctx);
    tickOnTraffic(ctx);
    next();
  });

  const names = new Set<string>();
  for (const module of modules) {
    if (names.has(module.name)) throw new Error(`API module "${module.name}" is registered twice`);
    names.add(module.name);
    const sub = express.Router();
    module.register(sub, ctx);
    router.use(sub);
    ctx.log.debug("api module registered", { module: module.name });
  }

  router.use(notFoundHandler("/v1"));
  router.use(errorHandler(ctx.log));
  return router;
}
