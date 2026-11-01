/** Tag (ERC-8004): read an agent, draft a card + register call, file a Fence verdict, serve cards. */
import type { Address, FenceVerdict } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { LykiaHttpError } from "../http/errors.js";
import { cachePublicly } from "../http/request.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { services } from "../services.js";
import { sessionOf } from "../platform/session.js";
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

export const tagModule: ApiModule = {
  name: "tags",
  register(router, ctx) {
    router.get("/tags/cards/:digest", async (req, res) => {
      const { digest } = parseParams(req, z.object({ digest: z.string().regex(/^[0-9a-f]{64}$/u) }));
      const stored = await services(ctx).tags.card(digest);
      if (!stored) throw new LykiaHttpError("NOT_FOUND", 404, "No such card.");
      cachePublicly(res, 3600);
      res.json(stored.card);
    });

    // ERC-8354 request/response documents named by their ValidationRegistry hashes.
    router.get("/tags/verdicts/:hash", async (req, res) => {
      const { hash } = parseParams(req, z.object({ hash: z.string().regex(/^0x[0-9a-f]{64}$/u) }));
      const doc = await services(ctx).tags.verdictDoc(hash);
      if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No such verdict document.");
      cachePublicly(res, 86_400);
      res.json(doc);
    });

    // The salt padding an agent's policy commitment: only for the agent's owner, so they can disclose it to an auditor.
    router.get("/tags/:agentId/policy-salt", async (req, res) => {
      const { agentId } = parseParams(req, z.object({ agentId: z.string().regex(/^\d{1,30}$/u) }));
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      const session = await sessionOf(ctx, req);
      if (!session) throw new LykiaHttpError("UNAUTHORIZED", 401, "Sign in with the agent owner's wallet.");
      const view = await services(ctx).tags.view(environment, agentId);
      if (!view.owner || view.owner.toLowerCase() !== session.address.toLowerCase()) throw new LykiaHttpError("FORBIDDEN", 403, "Only the agent's owner can read its policy salt.");
      res.setHeader("cache-control", "no-store");
      res.json({ agentId, environment, salt: await services(ctx).tags.policySalt(environment, agentId), note: "policyRoot = keccak256(abi.encode(fenceHash, salt)). Share (Fence, salt) only with auditors." });
    });

    router.get("/tags/:agentId", ctx.limits.heavy, async (req, res) => {
      const { agentId } = parseParams(req, z.object({ agentId: z.string().regex(/^\d{1,30}$/u) }));
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      res.json(await services(ctx).tags.view(environment, agentId));
    });

    router.post("/tags/draft", async (req, res) => {
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
      if (!fence) throw new LykiaHttpError("INVALID_FENCE", 400, "A Tag pins a Fence: send one.");
      res.json(
        await services(ctx).tags.draft({
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

    router.post("/tags/attest", async (req, res) => {
      const body = parseBody(
        req,
        z.object({
          environment: environmentSchema.optional(),
          agentId: z.string().regex(/^\d{1,30}$/u),
          intentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
          owner: evmAddress,
          validator: evmAddress,
          verdict: verdictSchema.optional(),
          // ERC-8354: the judged action, from a prepared step or given directly.
          erc8354: z
            .object({
              executor: evmAddress,
              stepId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/u).optional(),
              action: z.object({ to: evmAddress, data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/u).max(200_000), value: z.string().regex(/^\d{1,78}$/u).default("0") }).optional(),
              confirmed: z.boolean().optional(),
              mechanism: z.enum(["independent-mediator", "public-recomputable"]).optional(),
              expirySeconds: z.number().int().min(60).max(7 * 86_400).optional(),
            })
            .optional(),
        }),
      );
      let verdict = body.verdict as FenceVerdict | undefined;
      const stored = !verdict || body.erc8354?.stepId ? await services(ctx).intents.get(body.intentId).catch(() => null) : null;
      if (!verdict) {
        if (!stored) throw new LykiaHttpError("NOT_FOUND", 404, "No such intent; send the verdict.");
        verdict = stored.intent.verdict;
      }
      const environment = environmentOf(ctx, body.environment);
      const legacy = services(ctx).tags.attest({ environment, agentId: body.agentId, intentId: body.intentId, verdict, owner: body.owner as Address, validator: body.validator as Address });
      if (!body.erc8354) return void res.json(legacy);
      let action = body.erc8354.action as { to: Address; data: `0x${string}`; value: string } | undefined;
      if (!action && body.erc8354.stepId) {
        const step = stored?.intent.steps.find((s) => s.id === body.erc8354?.stepId);
        const tx = step?.transactions?.[0];
        if (!tx) throw new LykiaHttpError("STEP_NOT_READY", 409, "Prepare the step first: its transaction is the action the verdict judges.");
        action = { to: tx.to, data: tx.data, value: tx.value };
      }
      if (!action) throw new LykiaHttpError("INVALID_REQUEST", 400, "erc8354 needs stepId (a prepared step) or action { to, data, value }.");
      const erc8354 = await services(ctx).tags.attest8354({
        environment,
        agentId: body.agentId,
        intentId: body.intentId,
        verdict,
        ...(body.erc8354.confirmed ? { confirmed: true } : {}),
        owner: body.owner as Address,
        executor: body.erc8354.executor as Address,
        action,
        ...(body.erc8354.mechanism ? { mechanism: body.erc8354.mechanism } : {}),
        ...(body.erc8354.expirySeconds ? { expirySeconds: body.erc8354.expirySeconds } : {}),
        publicBaseUrl: publicBaseUrl(req),
      });
      res.json({ ...legacy, erc8354 });
    });
  },
};
