/** The Fence: templates, default, validation (with loosened-rule lines) and evaluation. */
import { DEFAULT_FENCE, evaluateFence, FENCE_TEMPLATES, fenceHash, loosenedRules, validateFence, type FenceFacts } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { parseBody } from "../http/validate.js";
import { paid } from "../x402/x402.js";
import { fenceFrom } from "./common.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/u);
const usd = z.string().regex(/^\d{1,15}(?:\.\d{1,8})?$/u);
const tokenFact = z.object({ symbol: z.string().max(32), address, listed: z.boolean(), acquired: z.boolean(), scent: z.enum(["verified", "no-red-flags", "caution", "danger", "unknown"]).optional() });
const stepFact = z.object({
  id: z.string().max(32),
  kind: z.string().max(32),
  venue: z.string().max(48),
  usd: usd.nullable(),
  tokens: z.array(tokenFact).max(8),
  recipient: address.optional(),
  destination: z.string().max(32).optional(),
  slippageBps: z.number().int().min(0).max(10_000).optional(),
  healthFactorAfter: z.string().max(16).nullable().optional(),
  fxDeviationBps: z.number().int().min(-10_000).max(10_000).nullable().optional(),
});
export const factsSchema = z.object({
  environment: z.enum(["mainnet", "testnet"]),
  signer: z.enum(["wallet", "agent"]),
  owner: address,
  proposedByAgent: z.boolean().optional(),
  steps: z.array(stepFact).max(12),
  spent: z.object({ dayUsd: usd.nullable(), weekUsd: usd.nullable() }).optional(),
  now: z.number().int().positive().optional(),
});

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
      const body = parseBody(req, z.object({ fence: z.unknown().optional(), facts: factsSchema }));
      const fence = fenceFrom(body.fence) ?? DEFAULT_FENCE;
      const facts = { ...body.facts, now: body.facts.now ?? ctx.clock.now() } as FenceFacts;
      res.json(evaluateFence(fence, facts));
    });

    // The same check, sold per call over x402 (USDC on Arc) for agents listed on Circle's Agent Marketplace.
    // The body is validated before payment, so a malformed request never costs anything.
    const paidSchema = z.object({ fence: z.unknown().optional(), facts: factsSchema });
    router.post(
      "/x402/fence/evaluate",
      (req, _res, next) => {
        parseBody(req, paidSchema);
        next();
      },
      paid(ctx, "Fence check: allow, confirm or deny a planned DeFi move against an owner's Fence, with a verdict digest"),
      (req, res) => {
        const body = parseBody(req, paidSchema);
        const fence = fenceFrom(body.fence) ?? DEFAULT_FENCE;
        res.json(evaluateFence(fence, { ...body.facts, now: body.facts.now ?? ctx.clock.now() } as FenceFacts));
      },
    );
  },
};
