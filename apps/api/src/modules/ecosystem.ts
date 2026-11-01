/**
 * The ecosystem and the marketplace documents. All public and cacheable.
 *
 *   GET /ecosystem              every Arc protocol, Circle product, TVL, value routed by Lykia (CORS-open)
 *   GET /openapi.json           OpenAPI 3.1 for every documented route (platform/openapi/document.ts)
 *   GET /.well-known/x402       (root) the x402 service manifest for marketplaces and agents
 */
import type { Response } from "express";
import type { ApiModule } from "../http/router.js";
import { cachePublicly } from "../http/request.js";
import { parseQuery } from "../http/validate.js";
import { ecosystem } from "../ecosystem/ecosystem.js";
import { originOf, serviceManifest } from "../x402/manifest.js";
import { buildOpenApi } from "../platform/openapi/document.js";
import { environmentOf, environmentQuery } from "./common.js";

/** Readable from any origin: the data is public and carries no credentials. */
function openToEveryone(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
}

export const ecosystemModule: ApiModule = {
  name: "ecosystem",
  mountRoot(app, ctx) {
    app.get("/.well-known/x402", (req, res) => {
      openToEveryone(res);
      cachePublicly(res, 300);
      res.json(serviceManifest(ctx, originOf(req)));
    });
  },
  register(router, ctx) {
    router.get("/ecosystem", async (req, res) => {
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment ?? "mainnet");
      openToEveryone(res);
      cachePublicly(res, 60);
      res.json(await ecosystem(ctx, environment));
    });
    router.get("/openapi.json", (req, res) => {
      openToEveryone(res);
      cachePublicly(res, 300);
      // The full reference: every documented route, the x402 details of paid ones (platform/openapi).
      res.json(buildOpenApi(ctx, originOf(req)));
    });
  },
};
