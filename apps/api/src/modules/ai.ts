/**
 * AI routing.
 *
 *   POST /ai/route          { text, owner, constraints?, build? } -> actions -> route search -> best route + explain
 *   POST /ai/explain-route  { route } | { quoteId } -> a plain explanation (the model's when configured)
 *
 * Any language in when ANTHROPIC_API_KEY is set; the deterministic English
 * reader otherwise. Constraints only tighten the Fence. Nothing is signed.
 */
import type { Address } from "@lykia/core";
import { z } from "zod";
import { agentServices } from "../agents/index.js";
import { aiRoute, explainRoute } from "../aggregator/ai.js";
import { quoteAction, quoteRequest } from "../aggregator/service.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody } from "../http/validate.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { buildFields } from "./aggregator.js";
import { environmentSchema, fenceFrom } from "./common.js";

const venueId = z.string().regex(/^[a-z0-9-]{2,48}$/u);
const routeBody = z
  .object({
    text: z.string().min(1).max(1000),
    owner: evmAddress,
    environment: environmentSchema.optional(),
    constraints: z
      .object({
        fence: z.unknown().optional(),
        venues: z.object({ allow: z.array(venueId).max(24).optional(), deny: z.array(venueId).max(24).optional() }).optional(),
        appetite: z.enum(["low", "medium", "high"]).optional(),
        maxSteps: z.number().int().min(1).max(12).optional(),
        maxCandidates: z.number().int().min(1).max(24).optional(),
        horizonDays: z.number().int().min(1).max(3650).optional(),
      })
      .strict()
      .optional(),
    simulate: z.boolean().optional(),
    build: z.boolean().optional(),
    buildOptions: z.object(buildFields).strict().optional(),
  })
  .strict();
const explainBody = z.union([z.object({ route: z.unknown(), language: z.string().max(40).optional(), question: z.string().max(300).optional() }).strict(), z.object({ quoteId: z.string().regex(/^q_[A-Za-z0-9_-]{8,40}$/u), language: z.string().max(40).optional() }).strict()]);

documentRoutes([
  {
    method: "post",
    path: "/v1/ai/route",
    tag: "AI routing",
    summary: "Natural language -> actions -> best route",
    description: "Any language when a model is configured (deterministic English reader otherwise). Constraints (Fence, venue allow/deny, risk appetite, max steps) only tighten the Fence. build: true also returns the aggregator build of the best route.",
    scope: "quote",
    auth: "public",
    body: routeBody,
    response: z.object({ status: z.enum(["routed", "no-route", "clarify"]), understood: z.object({ actions: z.array(z.unknown()), clarify: z.array(z.string()), source: z.enum(["llm", "deterministic"]) }).passthrough(), best: z.unknown().nullable(), explain: z.unknown().nullable(), build: z.unknown().nullable() }).passthrough(),
  },
  { method: "post", path: "/v1/ai/explain-route", tag: "AI routing", summary: "Explain a route or a quote in plain words", scope: "quote", auth: "public", body: explainBody, response: z.object({ text: z.string(), source: z.enum(["llm", "deterministic"]) }) },
]);

export const aiModule: ApiModule = {
  name: "ai",
  register(router, ctx) {
    router.post("/ai/route", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, routeBody);
      const fence = fenceFrom(body.constraints?.fence);
      const c = body.constraints;
      res.json(
        await aiRoute(
          ctx,
          {
            text: body.text,
            owner: body.owner as Address,
            ...(body.environment ? { environment: body.environment } : {}),
            ...(c ? { constraints: { ...(fence ? { fence } : {}), ...(c.venues ? { venues: c.venues } : {}), ...(c.appetite ? { appetite: c.appetite } : {}), ...(c.maxSteps ? { maxSteps: c.maxSteps } : {}), ...(c.maxCandidates ? { maxCandidates: c.maxCandidates } : {}), ...(c.horizonDays ? { horizonDays: c.horizonDays } : {}) } } : {}),
            ...(body.simulate !== undefined ? { simulate: body.simulate } : {}),
            ...(body.build ? { build: true } : {}),
            ...(body.buildOptions ? { buildOptions: { ...(body.buildOptions.format ? { format: body.buildOptions.format } : {}), ...(body.buildOptions.batch ? { batch: body.buildOptions.batch } : {}), ...(body.buildOptions.confirm ? { confirm: true } : {}), ...(body.buildOptions.preview ? { preview: true } : {}), ...(body.buildOptions.provider ? { provider: body.buildOptions.provider } : {}) } } : {}),
          },
          req,
        ),
      );
    });

    router.post("/ai/explain-route", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, explainBody);
      const llm = agentServices(ctx).llm();
      if ("quoteId" in body) {
        const { request } = await quoteRequest(ctx, body.quoteId);
        const fresh = await quoteAction(ctx, request, req);
        return void res.json(await explainRoute(llm, { route: fresh, language: body.language ?? null }));
      }
      res.json(await explainRoute(llm, { route: body.route, language: body.language ?? null, ...(body.question ? { question: body.question } : {}) }));
    });
  },
};
