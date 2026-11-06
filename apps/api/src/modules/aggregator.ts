/**
 * The aggregator API: one "quote -> build" shape for every action on Arc.
 *
 *   GET  /aggregator/quote            swap quote from query params (tokenIn, tokenOut, amount, taker, ...)
 *   POST /aggregator/quote            quote any action ({ kind, ... }); returns a quote id
 *   POST /aggregator/build            ready-to-sign calls from { quoteId } or the action's params
 *   POST /quote/:kind                 the same quote, kind in the path
 *   POST /build/:kind                 the same build, kind in the path:
 *                                     transfer, swap, fx, bridge, deposit, withdraw, supply, borrow, repay, batch
 *
 * Every build is simulated as one batch on Arc before it is returned and
 * goes through the Fence (beta caps included) and the security layer; both
 * fail closed. Nothing is signed or broadcast. See docs/platform/aggregator.md.
 */
import { MAX_INTEGRATOR_FEE_BPS, type Address } from "@lykia/core";
import type { Request } from "express";
import { z } from "zod";
import { ACTION_KINDS, actionsOf, buildAction, quoteAction, type ActionKind, type ActionRequest, type BuildOptions } from "../aggregator/service.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery, queryBoolean, queryList, queryString } from "../http/validate.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { actionsFrom, environmentSchema, fenceFrom } from "./common.js";

const amount = z.union([z.literal("all"), z.string().regex(/^\d{1,18}(?:\.\d{1,18})?$/u, "A decimal amount in whole tokens, or \"all\".")]);
const token = z.string().min(2).max(12);
const venueId = z.string().regex(/^[a-z0-9-]{2,48}$/u);

export const actionFields = {
  environment: environmentSchema.optional(),
  taker: evmAddress.optional(),
  owner: evmAddress.optional(),
  tokenIn: token.optional(),
  tokenOut: token.optional(),
  token: token.optional(),
  amount: amount.optional(),
  to: evmAddress.optional(),
  memo: z.string().max(256).optional(),
  destination: z.string().min(2).max(20).optional(),
  recipient: evmAddress.optional(),
  venue: z.string().max(80).optional(),
  maxRisk: z.enum(["low", "medium", "high"]).optional(),
  collateral: z.object({ token, amount: amount.optional() }).optional(),
  minHealth: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/u).optional(),
  actions: z.array(z.unknown()).min(1).max(12).optional(),
  slippageBps: z.number().int().min(0).max(1000).optional(),
  integratorFee: z.object({ bps: z.number().int().min(0).max(MAX_INTEGRATOR_FEE_BPS), recipient: evmAddress }).optional(),
  venues: z.object({ include: z.array(venueId).max(24).optional(), exclude: z.array(venueId).max(24).optional() }).optional(),
  split: z.boolean().optional(),
  fence: z.unknown().optional(),
  signer: z.enum(["wallet", "agent"]).optional(),
  agent: z.object({ address: evmAddress, agentId: z.string().regex(/^\d{1,30}$/u).optional() }).optional(),
};

export const buildFields = {
  format: z.enum(["transactions", "calls", "eip5792"]).optional(),
  batch: z.enum(["step", "single"]).optional(),
  confirm: z.boolean().optional(),
  preview: z.boolean().optional(),
  /** A registered execution provider (engine/providers.ts), e.g. a Circle-native path; default "lykia". */
  provider: z.string().regex(/^[a-z0-9-]{2,48}$/u).optional(),
};

const kindSchema = z.enum(ACTION_KINDS);
const quoteBody = z.object({ kind: kindSchema.default("swap"), ...actionFields }).strict();
const buildBody = z.object({ kind: kindSchema.optional(), quoteId: z.string().regex(/^q_[A-Za-z0-9_-]{8,40}$/u).optional(), ...actionFields, ...buildFields }).strict();
const kindParams = z.object({ kind: kindSchema });

const quoteQuery = z.object({
  kind: z.enum(["swap", "fx"]).optional(),
  environment: environmentSchema.optional(),
  tokenIn: queryString(12),
  tokenOut: queryString(12),
  amount: queryString(40),
  taker: evmAddress,
  slippageBps: z.coerce.number().int().min(0).max(1000).optional(),
  integratorFeeBps: z.coerce.number().int().min(0).max(MAX_INTEGRATOR_FEE_BPS).optional(),
  integratorFeeRecipient: evmAddress.optional(),
  includeVenues: queryList(24, venueId).optional(),
  excludeVenues: queryList(24, venueId).optional(),
  split: queryBoolean.optional(),
});

type Fields = z.infer<z.ZodObject<typeof actionFields>>;

/** A validated body as an ActionRequest; the actions it implies are checked by core before any quote. */
export function toActionRequest(kind: ActionKind, body: Fields): ActionRequest {
  const taker = (body.taker ?? body.owner) as Address | undefined;
  if (!taker) throw new LykiaHttpError("INVALID_REQUEST", 400, "taker (the signing address) is required.");
  const fence = fenceFrom(body.fence);
  const req: ActionRequest = {
    kind,
    taker,
    ...(body.environment ? { environment: body.environment } : {}),
    ...(body.tokenIn ? { tokenIn: body.tokenIn } : {}),
    ...(body.tokenOut ? { tokenOut: body.tokenOut } : {}),
    ...(body.token ? { token: body.token } : {}),
    ...(body.amount ? { amount: body.amount } : {}),
    ...(body.to ? { to: body.to as Address } : {}),
    ...(body.memo ? { memo: body.memo } : {}),
    ...(body.destination ? { destination: body.destination } : {}),
    ...(body.recipient ? { recipient: body.recipient as Address } : {}),
    ...(body.venue ? { venue: body.venue } : {}),
    ...(body.maxRisk ? { maxRisk: body.maxRisk } : {}),
    ...(body.collateral ? { collateral: { token: body.collateral.token, ...(body.collateral.amount ? { amount: body.collateral.amount } : {}) } } : {}),
    ...(body.minHealth ? { minHealth: body.minHealth } : {}),
    ...(body.actions ? { actions: actionsFrom(body.actions) } : {}),
    ...(body.slippageBps !== undefined ? { slippageBps: body.slippageBps } : {}),
    ...(body.integratorFee ? { integratorFee: { bps: body.integratorFee.bps, recipient: body.integratorFee.recipient as Address } } : {}),
    ...(body.venues ? { venues: body.venues } : {}),
    ...(body.split !== undefined ? { split: body.split } : {}),
    ...(fence ? { fence } : {}),
    ...(body.signer ? { signer: body.signer } : {}),
    ...(body.agent ? { agent: { address: body.agent.address as Address, ...(body.agent.agentId ? { agentId: body.agent.agentId } : {}) } } : {}),
  };
  return req;
}

function optionsOf(body: { format?: BuildOptions["format"]; batch?: BuildOptions["batch"]; confirm?: boolean; preview?: boolean; provider?: string }): BuildOptions {
  return { ...(body.provider ? { provider: body.provider } : {}), ...(body.format ? { format: body.format } : {}), ...(body.batch ? { batch: body.batch } : {}), ...(body.confirm ? { confirm: true } : {}), ...(body.preview ? { preview: true } : {}) };
}

async function build(ctx: Parameters<ApiModule["register"]>[1], req: Request, kind: ActionKind | undefined, body: z.infer<typeof buildBody>) {
  if (body.quoteId) return buildAction(ctx, { quoteId: body.quoteId }, optionsOf(body), req);
  const k = kind ?? body.kind;
  if (!k) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send a quoteId, or the action's kind and params.");
  const request = toActionRequest(k, body);
  actionsFrom(actionsOf(request));
  return buildAction(ctx, { request }, optionsOf(body), req);
}

/* ------------------------------------------------------------------ docs */

const amountView = z.object({ symbol: z.string(), token: z.string(), amount: z.string(), units: z.string(), minimum: z.string().optional(), usd: z.string().nullable() });
const quoteResponse = z
  .object({
    id: z.string(),
    kind: kindSchema,
    environment: environmentSchema,
    taker: z.string(),
    expiresAt: z.string(),
    sell: z.array(amountView),
    buy: z.array(amountView),
    route: z.object({ steps: z.array(z.object({ id: z.string(), kind: z.string(), venue: z.string(), summary: z.string(), reason: z.string().nullable() })) }),
    best: z.object({ venue: z.string(), label: z.string() }).passthrough().nullable(),
    alternatives: z.array(z.object({ venue: z.string(), label: z.string() }).passthrough()),
    priceImpactBps: z.number().nullable(),
    gas: z.object({ units: z.number(), priceWei: z.string(), usdc: z.string() }),
    fees: z.object({ lykiaBps: z.number(), lykiaUsd: z.string().nullable(), integratorUsd: z.string().nullable(), totalUsd: z.string().nullable() }).passthrough(),
    fence: z.object({ decision: z.string(), signable: z.boolean(), reasons: z.array(z.string()), digest: z.string() }),
    warnings: z.array(z.string()),
  })
  .passthrough();
const tx = z.object({ chainId: z.number(), from: z.string(), to: z.string(), data: z.string(), value: z.string(), label: z.string() });
const buildResponse = quoteResponse
  .omit({ id: true, expiresAt: true })
  .extend({
    quoteId: z.string().nullable(),
    intentId: z.string(),
    format: z.enum(["transactions", "calls", "eip5792"]),
    preview: z.boolean(),
    transactions: z.array(tx),
    calls: z.array(z.object({ to: z.string(), data: z.string(), value: z.string(), label: z.string(), stepId: z.string() })),
    walletSendCalls: z.object({ version: z.literal("2.0.0"), chainId: z.string(), from: z.string(), atomicRequired: z.literal(true), calls: z.array(z.object({ to: z.string(), data: z.string(), value: z.string() })) }).nullable(),
    steps: z.array(z.object({ id: z.string(), kind: z.string(), venue: z.string(), summary: z.string(), binding: z.string(), memo: z.string(), security: z.object({ decision: z.string(), findings: z.array(z.unknown()) }).passthrough() }).passthrough()),
    simulation: z.object({ ok: z.boolean(), mode: z.literal("batch"), block: z.string().nullable() }).passthrough(),
    security: z.object({ decision: z.enum(["pass", "warn", "block"]), findings: z.number(), warnings: z.array(z.string()) }),
  });

documentRoutes([
  { method: "get", path: "/v1/aggregator/quote", tag: "Aggregator", summary: "Swap quote from query parameters", description: "Best route across every executable Arc venue, the alternatives it beat, price impact, gas in USDC, Lykia's fee, the integrator's fee and the Fence verdict. Returns a quote id to build from.", scope: "quote", auth: "public", query: quoteQuery, response: quoteResponse },
  { method: "post", path: "/v1/aggregator/quote", tag: "Aggregator", summary: "Quote any action", description: "kind: transfer, swap, fx, bridge, deposit, withdraw, supply, borrow, repay or batch.", scope: "quote", auth: "public", body: quoteBody, response: quoteResponse },
  { method: "post", path: "/v1/aggregator/build", tag: "Aggregator", summary: "Build ready-to-sign calls", description: "From a quote id or the action's params. Simulated on Arc in one batch and checked by the Fence and the security layer before it is returned; refuses (fail closed) on a deny, an unconfirmed confirm, a revert or any security block. format: transactions (EOA, Arc Memo + Multicall3From), calls (smart accounts) or eip5792 (wallet_sendCalls).", scope: "build", auth: "public", body: buildBody, response: buildResponse, idempotent: true },
  { method: "post", path: "/v1/quote/:kind", tag: "Aggregator", summary: "Quote one action type", scope: "quote", auth: "public", params: kindParams, body: quoteBody.omit({ kind: true }), response: quoteResponse },
  { method: "post", path: "/v1/build/:kind", tag: "Aggregator", summary: "Build one action type", description: "transfer, swap, fx, bridge, deposit, withdraw, supply, borrow, repay or batch; same answer as POST /v1/aggregator/build.", scope: "build", auth: "public", params: kindParams, body: buildBody.omit({ kind: true }), response: buildResponse, idempotent: true },
]);

export const aggregatorModule: ApiModule = {
  name: "aggregator",
  register(router, ctx) {
    router.get("/aggregator/quote", ctx.limits.heavy, async (req, res) => {
      const q = parseQuery(req, quoteQuery);
      const request = toActionRequest(q.kind ?? "swap", {
        taker: q.taker,
        tokenIn: q.tokenIn,
        tokenOut: q.tokenOut,
        amount: amount.parse(q.amount),
        ...(q.environment ? { environment: q.environment } : {}),
        ...(q.slippageBps !== undefined ? { slippageBps: q.slippageBps } : {}),
        ...(q.integratorFeeBps !== undefined && q.integratorFeeRecipient ? { integratorFee: { bps: q.integratorFeeBps, recipient: q.integratorFeeRecipient } } : {}),
        ...(q.includeVenues || q.excludeVenues ? { venues: { ...(q.includeVenues ? { include: q.includeVenues } : {}), ...(q.excludeVenues ? { exclude: q.excludeVenues } : {}) } } : {}),
        ...(q.split !== undefined ? { split: q.split } : {}),
      });
      actionsFrom(actionsOf(request));
      res.json(await quoteAction(ctx, request, req));
    });

    router.post("/aggregator/quote", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, quoteBody);
      const request = toActionRequest(body.kind, body);
      actionsFrom(actionsOf(request));
      res.json(await quoteAction(ctx, request, req));
    });

    router.post("/quote/:kind", ctx.limits.heavy, async (req, res) => {
      const { kind } = parseParams(req, kindParams);
      const body = parseBody(req, quoteBody.omit({ kind: true }));
      const request = toActionRequest(kind, body);
      actionsFrom(actionsOf(request));
      res.json(await quoteAction(ctx, request, req));
    });

    router.post("/aggregator/build", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, buildBody);
      res.json(await build(ctx, req, undefined, body));
    });

    router.post("/build/:kind", ctx.limits.heavy, async (req, res) => {
      const { kind } = parseParams(req, kindParams);
      const body = parseBody(req, buildBody.omit({ kind: true }));
      res.json(await build(ctx, req, kind, body));
    });
  },
};
