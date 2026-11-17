/** Scent: free token reports, and the deeper paid report over x402. */
import type { Address } from "@lykia/core";
import type { ApiModule } from "../http/router.js";
import { parseParams, parseQuery } from "../http/validate.js";
import { services } from "../services.js";
import { paidOffer } from "../x402/manifest.js";
import { paidRoute } from "../x402/x402.js";
import { environmentOf, environmentQuery } from "./common.js";
import { tokenParamsSchema } from "./inputs.js";

export const scentModule: ApiModule = {
  name: "scent",
  register(router, ctx) {
    router.get("/scent/:token", ctx.limits.heavy, async (req, res) => {
      const { token } = parseParams(req, tokenParamsSchema);
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      res.json(await services(ctx).scent.sniff(environment, token as Address));
    });

    router.get(
      "/x402/scent/:token",
      ctx.limits.heavy,
      paidRoute(ctx, {
        ...paidOffer("scent-report"),
        environment: (req) => req.query.environment,
        parse: (req) => ({ token: parseParams(req, tokenParamsSchema).token as Address, environment: environmentOf(ctx, parseQuery(req, environmentQuery).environment) }),
        run: ({ token, environment }) => services(ctx).scent.sniff(environment, token, { deep: true }),
      }),
    );
  },
};
