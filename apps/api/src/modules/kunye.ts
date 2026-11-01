/** Künye (ERC-8004): read an agent, draft a card + register call, file a Fence verdict, serve cards. */
import type { Address, FenceVerdict } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { LykiaHttpError } from "../http/errors.js";
import { cachePublicly } from "../http/request.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { services } from "../services.js";
import { environmentOf, environmentQuery, environmentSchema, fenceFrom, publicBaseUrl } from "./common.js";

const verdictSchema = z.object({
  schema: z.literal("lykia.verdict/v1"),
  decision: z.enum(["allow", "confirm", "deny"]),
  signable: z.boolean(),
  reasons: z.array(z.object({ rule: z.string(), decision: z.enum(["allow", "confirm", "deny"]), message: z.string(), step: z.string().optional() })).max(64),
  waived: z.array(z.unknown()).max(64),
  fenceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  factsDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});

export const kunyeModule: ApiModule = {
  name: "kunye",
  register(router, ctx) {
    router.get("/kunye/cards/:digest", async (req, res) => {
      const { digest } = parseParams(req, z.object({ digest: z.string().regex(/^[0-9a-f]{64}$/u) }));
      const stored = await services(ctx).kunye.card(digest);
      if (!stored) throw new LykiaHttpError("NOT_FOUND", 404, "No such card.");
      cachePublicly(res, 3600);
      res.json(stored.card);
    });

    router.get("/kunye/:agentId", ctx.limits.heavy, async (req, res) => {
      const { agentId } = parseParams(req, z.object({ agentId: z.string().regex(/^\d{1,30}$/u) }));
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      res.json(await services(ctx).kunye.view(environment, agentId));
    });

    router.post("/kunye/draft", async (req, res) => {
      const body = parseBody(
        req,
        z.object({
          environment: environmentSchema.optional(),
          owner: evmAddress,
          agentWallet: evmAddress.optional(),
          name: z.string().min(2).max(64),
          description: z.string().max(500).default(""),
          image: z.string().url().max(512).optional(),
          fence: z.unknown(),
          endpoints: z.array(z.object({ name: z.string().min(1).max(32), endpoint: z.string().min(1).max(512), version: z.string().max(16).optional() })).max(8).optional(),
          serveCard: z.boolean().default(true),
        }),
      );
      const fence = fenceFrom(body.fence);
      if (!fence) throw new LykiaHttpError("INVALID_FENCE", 400, "A Künye pins a Fence: send one.");
      res.json(
        await services(ctx).kunye.draft({
          environment: environmentOf(ctx, body.environment),
          owner: body.owner as Address,
          ...(body.agentWallet ? { agentWallet: body.agentWallet as Address } : {}),
          name: body.name,
          description: body.description,
          ...(body.image ? { image: body.image } : {}),
          fence,
          ...(body.endpoints ? { endpoints: body.endpoints } : {}),
          ...(body.serveCard ? { publicBaseUrl: publicBaseUrl(req) } : {}),
        }),
      );
    });

    router.post("/kunye/attest", async (req, res) => {
      const body = parseBody(
        req,
        z.object({
          environment: environmentSchema.optional(),
          agentId: z.string().regex(/^\d{1,30}$/u),
          intentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
          owner: evmAddress,
          validator: evmAddress,
          verdict: verdictSchema.optional(),
        }),
      );
      let verdict = body.verdict as FenceVerdict | undefined;
      if (!verdict) verdict = (await services(ctx).intents.get(body.intentId)).intent.verdict;
      res.json(services(ctx).kunye.attest({ environment: environmentOf(ctx, body.environment), agentId: body.agentId, intentId: body.intentId, verdict, owner: body.owner as Address, validator: body.validator as Address }));
    });
  },
};
