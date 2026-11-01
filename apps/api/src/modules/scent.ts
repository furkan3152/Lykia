/** Scent: free token reports, and the deeper paid report over x402. */
import type { Address } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseParams, parseQuery } from "../http/validate.js";
import { services } from "../services.js";
import { paid } from "../x402/x402.js";
import { environmentOf, environmentQuery } from "./common.js";

const Params = z.object({ token: evmAddress });

export const scentModule: ApiModule = {
  name: "scent",
  register(router, ctx) {
    router.get("/scent/:token", ctx.limits.heavy, async (req, res) => {
      const { token } = parseParams(req, Params);
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      res.json(await services(ctx).scent.sniff(environment, token as Address));
    });

    router.get("/x402/scent/:token", ctx.limits.heavy, paid(ctx, "Deep Scent report (wider balance-slot search)"), async (req, res) => {
      const { token } = parseParams(req, Params);
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      res.json(await services(ctx).scent.sniff(environment, token as Address, { deep: true }));
    });
  },
};
