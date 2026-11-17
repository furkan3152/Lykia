/** The Fence: templates, default, validation (with loosened-rule lines) and evaluation. */
import { DEFAULT_FENCE, evaluateFence, FENCE_TEMPLATES, fenceHash, loosenedRules, validateFence, type FenceFacts } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { parseBody } from "../http/validate.js";
import { paidOffer } from "../x402/manifest.js";
import { paidRoute } from "../x402/x402.js";
import { fenceFrom } from "./common.js";
import { factsSchema, fenceCheckSchema } from "./inputs.js";

export { factsSchema };

export const fenceModule: ApiModule = {
  name: "fence",
  register(router, ctx) {
    router.get("/fence/templates", (_req, res) => {
      res.json({ templates: Object.entries(FENCE_TEMPLATES).map(([key, fence]) => ({ key, fence, hash: fenceHash(fence) })) });
    });

    router.get("/fence/default", (_req, res) => {
      res.json({ fence: DEFAULT_FENCE, hash: fenceHash(DEFAULT_FENCE) });
    });

    router.post("/fence/validate", (req, res) => {
      const body = parseBody(req, z.object({ fence: z.unknown(), previous: z.unknown().optional() }));
      const result = validateFence(body.fence);
      if (!result.ok) {
        res.json({ ok: false, issues: result.issues });
        return;
      }
      const previous = body.previous === undefined ? undefined : fenceFrom(body.previous);
      res.json({ ok: true, hash: fenceHash(result.fence), ...(previous ? { loosened: loosenedRules(previous, result.fence) } : {}) });
    });

    router.post("/fence/evaluate", (req, res) => {
      const body = parseBody(req, fenceCheckSchema);
      const fence = fenceFrom(body.fence) ?? DEFAULT_FENCE;
      const facts = { ...body.facts, now: body.facts.now ?? ctx.clock.now() } as FenceFacts;
      res.json(evaluateFence(fence, facts));
    });

    // The same check, sold per call over x402 (USDC on Arc) for agents listed on Circle's Agent Marketplace.
    // Unpaid requests get the 402 whatever they hold; with a valid payment a malformed request answers 400 and is never settled.
    router.post(
      "/x402/fence/evaluate",
      paidRoute(ctx, {
        ...paidOffer("fence-check"),
        // The move's own network: the Fence check is paid on the network it checks.
        environment: (req) => (req.body as { facts?: { environment?: unknown } } | undefined)?.facts?.environment,
        parse: (req) => {
          const body = parseBody(req, fenceCheckSchema);
          return { fence: fenceFrom(body.fence) ?? DEFAULT_FENCE, facts: body.facts, environment: body.facts.environment };
        },
        run: ({ fence, facts }) => evaluateFence(fence, { ...facts, now: facts.now ?? ctx.clock.now() } as FenceFacts),
      }),
    );
  },
};
