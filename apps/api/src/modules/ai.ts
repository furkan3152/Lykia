/**
 * AI routing.
 *
 *   POST /ai/route          { text, owner, constraints?, build? } -> actions -> route search -> best route + explain
 *   POST /ai/explain-route  { route } | { quoteId } -> a plain explanation (the model's when configured)
 *   POST /ai/compile        { text, owner?, overrides?, balances? } -> lykia.program/v1 + plan for now + drafts + why
 *
 * Any language in when ANTHROPIC_API_KEY is set; the deterministic English
 * reader otherwise. Constraints only tighten the Fence. Nothing is signed.
 */
import type { Address } from "@lykia/core";
import { z } from "zod";
import { agentServices } from "../agents/index.js";
import { aiRoute, explainRoute } from "../aggregator/ai.js";
import { compileIntent } from "../compiler/service.js";
import { programView } from "../compiler/deliver.js";
import { quoteAction, quoteRequest } from "../aggregator/service.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody } from "../http/validate.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { buildFields } from "./aggregator.js";
import { environmentSchema, fenceFrom } from "./common.js";
import { sharedLimit } from "../http/sharedLimits.js";

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
const decimal = z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,18})?$/u);
const compileBody = z
  .object({
    text: z.string().min(1).max(1000),
    owner: evmAddress.optional(),
    environment: environmentSchema.optional(),
    overrides: z.record(z.string().regex(/^[a-z][a-z0-9.:_|-]{0,60}$/u), z.string().max(64)).optional(),
    balances: z.record(z.string().regex(/^[A-Za-z0-9]{2,10}$/u), decimal).optional(),
    constraints: z
      .object({
        fence: z.unknown().optional(),
        venues: z.object({ allow: z.array(venueId).max(24).optional(), deny: z.array(venueId).max(24).optional() }).optional(),
        maxCandidates: z.number().int().min(1).max(24).optional(),
        horizonDays: z.number().int().min(1).max(3650).optional(),
      })
      .strict()
      .optional(),
    search: z.boolean().optional(),
    plan: z.boolean().optional(),
    preview: z.boolean().optional(),
    reader: z.enum(["auto", "llm", "deterministic"]).optional(),
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
    response: z.object({ status: z.enum(["routed", "no-route", "clarify", "refused", "compiled"]), understood: z.object({ actions: z.array(z.unknown()), clarify: z.array(z.string()), source: z.enum(["llm", "deterministic"]) }).passthrough(), best: z.unknown().nullable(), explain: z.unknown().nullable(), build: z.unknown().nullable() }).passthrough(),
  },
  {
    method: "post",
    path: "/v1/ai/compile",
    tag: "AI routing",
    summary: "Goal language -> lykia.program/v1 -> plan for now + drafts for later",
    description:
      "The intent compiler. Reads several goals, time (every month, if BTC goes above) and abstract wording (safe, the rest, a third, out within a day) into a typed, hashed program; resolves shares, remainders and reserves against the owner's balances (or what-if balances); compiles one plan for now (route-searched under the Fence, the program digest pinned in the Fence facts) plus automation, order, alert and standing-order drafts with links to their prefilled forms; and explains assumptions, trade-offs, rejected alternatives and what is deferred. overrides change an assumption by id. Nothing is signed or saved; plan: true stores the plan for signing.",
    scope: "quote",
    auth: "public",
    body: compileBody,
    response: z.object({ schema: z.literal("lykia.compile-result/v1"), status: z.enum(["ready", "needs-input", "refused"]), source: z.enum(["llm", "deterministic"]), program: z.unknown(), programHash: z.string(), resolution: z.unknown(), now: z.unknown().nullable(), scheduled: z.array(z.unknown()), why: z.unknown(), questions: z.array(z.unknown()), pin: z.unknown() }).passthrough(),
  },
  { method: "post", path: "/v1/ai/explain-route", tag: "AI routing", summary: "Explain a route or a quote in plain words", scope: "quote", auth: "public", body: explainBody, response: z.object({ text: z.string(), source: z.enum(["llm", "deterministic"]) }) },
]);

export const aiModule: ApiModule = {
  name: "ai",
  register(router, ctx) {
    // Counted across every instance (the heavy bucket counts per process): these routes can reach the model provider.
    const shared = sharedLimit(ctx, "ai", ctx.config.rateLimits.sharedPerMinute ?? 20);
    router.post("/ai/route", ctx.limits.heavy, shared, async (req, res) => {
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

    router.post("/ai/compile", ctx.limits.heavy, shared, async (req, res) => {
      const body = parseBody(req, compileBody);
      const fence = fenceFrom(body.constraints?.fence);
      const c = body.constraints;
      const result = await compileIntent(
          ctx,
          {
            text: body.text,
            owner: (body.owner as Address | undefined) ?? null,
            ...(body.environment ? { environment: body.environment } : {}),
            ...(body.overrides ? { overrides: body.overrides } : {}),
            ...(body.balances ? { balances: body.balances } : {}),
            ...(c ? { constraints: { ...(fence ? { fence } : {}), ...(c.venues ? { venues: c.venues } : {}), ...(c.maxCandidates ? { maxCandidates: c.maxCandidates } : {}), ...(c.horizonDays ? { horizonDays: c.horizonDays } : {}) } } : {}),
            ...(body.search !== undefined ? { search: body.search } : {}),
            ...(body.plan ? { plan: true } : {}),
            ...(body.preview !== undefined ? { preview: body.preview } : {}),
            ...(body.reader ? { reader: body.reader } : {}),
          },
          req,
        );
      // `view` is the same compact shape the chat renders (Now / Scheduled / Assumptions).
      res.json({ ...result, view: programView(result, body.overrides ?? {}) });
    });

    router.post("/ai/explain-route", ctx.limits.heavy, shared, async (req, res) => {
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
