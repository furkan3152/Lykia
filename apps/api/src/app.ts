/**
 * Composition root. The order is part of the security contract:
 *
 *   trust proxy (per-IP limits key on req.ip)
 *   -> request id + access log -> helmet -> CORS allowlist
 *   -> GET /health (static liveness, no dependencies, no rate limit)
 *   -> /v1 (own body guards, JSON parser and rate limits; see http/router.ts)
 *   -> 404 envelope -> error envelope
 *
 * There is no app-wide body parser (it would bypass the /v1 size limit) and
 * no compression middleware (it buffers SSE).
 */
import express, { type Express } from "express";
import helmet from "helmet";
import type { AppContext } from "./context.js";
import { createCors } from "./http/cors.js";
import { isProjectOrigin } from "./platform/projects.js";
import { errorHandler, requestContext } from "./http/request.js";
import { createV1Router, notFoundHandler, type ApiModule } from "./http/router.js";
import { MODULES } from "./modules/index.js";

export interface AppOptions {
  /** Modules mounted under /v1 (default: every module in src/modules/index.ts). */
  readonly modules?: readonly ApiModule[];
}

export function createApp(ctx: AppContext, options: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", ctx.config.trustProxy);
  // Responses are no-store JSON or event streams; ETag hashing would only cost CPU.
  app.set("etag", false);

  app.use(requestContext(ctx.log, ctx.clock));
  app.use(
    helmet({
      // The web app reads this API cross-origin (CORS decides who may).
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );
  app.use(createCors(ctx.config.webOrigins, (origin) => isProjectOrigin(ctx, origin)));

  app.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok", service: "lykia-api", version: ctx.config.version });
  });

  const modules = options.modules ?? MODULES;
  for (const module of modules) module.mountRoot?.(app, ctx);
  app.use("/v1", createV1Router(ctx, modules));
  app.use(notFoundHandler());
  app.use(errorHandler(ctx.log));
  return app;
}
