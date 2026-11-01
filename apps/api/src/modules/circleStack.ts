/**
 * Lykia on Circle's Agent Stack: the Fence compiled into Circle Agent Wallet
 * policies, Circle execution providers, Agent Marketplace listing and
 * discovery, Arc mandate drafts, and the public traction numbers.
 *
 *   POST /circle/policies/compile        Fence -> Circle spending policy + who enforces each rule
 *   POST /circle/policies/apply          the owner's CLI commands (Circle applies policies only with an owner OTP)
 *   GET  /circle/providers               Circle products Lykia executes through, with status
 *   GET  /circle/marketplace/services    Agent Marketplace services payable on Arc (pay with /circle/x402/prepare)
 *   GET  /circle/marketplace/listing     Lykia's own listing package for the Agent Marketplace
 *   POST /circle/mandates/draft          Fence -> Arc typed-mandate draft (status pending)
 *   POST /circle/mandates/proof          verdict -> Arc execution-proof draft (status pending)
 *   GET  /x402/health                    health of the paid routes (Marketplace health checks)
 *   GET  /stats                          public aggregate traction numbers (no personal data)
 */
import { DEFAULT_FENCE, FENCE_TEMPLATES, VERDICT_SCHEMA, type Address, type FenceTemplateKey, type FenceVerdict } from "@lykia/core";
import type { Response } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { cachePublicly } from "../http/request.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseQuery } from "../http/validate.js";
import { ARC_MANDATE_ADAPTER } from "../circle/mandates.js";
import { applyCirclePolicy, compileFenceToCirclePolicy } from "../circle/policy.js";
import { circleCapabilities, circleProviders, registerCircleProviders } from "../circle/providers.js";
import { ARC_NETWORKS, discoverServices } from "../circle/discovery.js";
import { EXTRA_PROVIDERS } from "../engine/providers.js";
import { originOf, PAID_SERVICES } from "../x402/manifest.js";
import { settlementMode } from "../x402/x402.js";
import { publicStats } from "../stats/stats.js";
import { environmentOf, environmentSchema, fenceFrom } from "./common.js";

const POWERED = "Powered by Circle" as const;
export const MARKETPLACE_FORM = "https://forms.gle/7YFzvdmMcn1JH5tF6";
const STARTED_AT = Date.now();

const templateSchema = z.enum(Object.keys(FENCE_TEMPLATES) as [FenceTemplateKey, ...FenceTemplateKey[]]);

function openToEveryone(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
}

function fenceOf(body: { fence?: unknown; template?: FenceTemplateKey }) {
  return fenceFrom(body.fence) ?? (body.template ? FENCE_TEMPLATES[body.template] : DEFAULT_FENCE);
}

const verdictSchema = z.object({
  schema: z.literal(VERDICT_SCHEMA),
  decision: z.enum(["allow", "confirm", "deny"]),
  signable: z.boolean(),
  reasons: z.array(z.object({ rule: z.string().max(40), decision: z.enum(["allow", "confirm", "deny"]), message: z.string().max(400), step: z.string().max(40).optional() })).max(64),
  waived: z.array(z.unknown()).max(64).default([]),
  fenceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  factsDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});

export function marketplaceListing(ctx: AppContext, origin: string) {
  const settlement = settlementMode(ctx);
  const site = origin.replace("lykia-api-", "lykia-");
  return {
    marketplace: "Circle Agent Marketplace",
    status: ctx.config.x402.payTo ? "ready-to-submit" : "paid-routes-off",
    submit: { form: MARKETPLACE_FORM, page: "https://developers.circle.com/agent-stack/agent-marketplace/get-listed", review: "Manual review by Circle; the payout wallet is sanctions-screened; listed services are health-checked continuously." },
    fields: {
      endpointUrl: `${origin}/.well-known/x402`,
      endpoints: PAID_SERVICES.map((s) => ({ name: s.name, method: s.method, url: `${origin}${s.path}`, category: s.category })),
      payoutWallet: ctx.config.x402.payTo,
      description: "Lykia: Fence checks, token Scent and route quotes for agents on Arc Network. Pay per call in USDC on Arc over x402.",
      openApiUrl: `${origin}/v1/openapi.json`,
      healthUrl: `${origin}/v1/x402/health`,
      website: site,
      docsUrl: `${site}/build`,
    },
    pricing: { perCallUsdc: (Number(ctx.config.x402.priceUnits) / 1e6).toString(), scheme: "exact", networks: Object.values(ARC_NETWORKS) },
    settlement,
    evidence: {
      unpaid402: `curl -si -X POST ${origin}/v1/x402/fence/evaluate -H 'content-type: application/json' -d '{}' | head -1   # expect HTTP 402`,
      inspect: `circle services inspect ${origin}/v1/x402/quote`,
      health: `curl -s ${origin}/v1/x402/health`,
    },
    guide: "docs/circle/marketplace-listing.md",
  };
}

export const circleStackModule: ApiModule = {
  name: "circle-stack",
  register(router, ctx) {
    registerCircleProviders();

    router.post("/circle/policies/compile", (req, res) => {
      const b = parseBody(req, z.object({ fence: z.unknown().optional(), template: templateSchema.optional(), wallet: evmAddress.optional(), owner: evmAddress.optional(), environment: environmentSchema.optional() }));
      const environment = b.environment ?? "mainnet";
      const compiled = compileFenceToCirclePolicy(fenceOf(b), { ...(b.wallet ? { wallet: b.wallet as Address } : {}), ...(b.owner ? { owner: b.owner as Address } : {}), environment, betaCap: environment === "mainnet" ? ctx.config.beta : null });
      res.json({ ...compiled, label: POWERED, defaultPath: "Circle wallet + Lykia Fence preflight. A Lykia smart account (LykiaAccount) is optional, for on-chain enforcement of the rules Circle does not cover." });
    });

    router.post("/circle/policies/apply", (req, res) => {
      const b = parseBody(req, z.object({ fence: z.unknown().optional(), template: templateSchema.optional(), wallet: evmAddress, owner: evmAddress.optional(), walletKind: z.enum(["agent-wallet", "developer-controlled"]).default("agent-wallet") }));
      const compiled = compileFenceToCirclePolicy(fenceOf(b), { wallet: b.wallet as Address, ...(b.owner ? { owner: b.owner as Address } : {}), environment: "mainnet", betaCap: ctx.config.beta });
      res.json({ ...applyCirclePolicy(compiled, b.walletKind), policy: compiled.policy, coverage: compiled.coverage, label: POWERED });
    });

    router.get("/circle/providers", (_req, res) => {
      const registered = new Set(EXTRA_PROVIDERS.map((p) => p.id));
      res.json({
        label: POWERED,
        capabilities: circleCapabilities(ctx),
        providers: circleProviders.map((p) => ({ id: p.id, label: p.label, kinds: p.kinds, poweredBy: POWERED, registered: registered.has(p.id), available: (() => { try { return p.available(ctx); } catch { return false; } })() })),
        note: "Providers are offered beside Lykia's own engine by the aggregator; every build is still judged by the Fence, simulated and security-checked.",
      });
    });

    router.get("/circle/marketplace/services", ctx.limits.heavy, async (req, res) => {
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional(), category: z.enum(["SOCIAL_INTELLIGENCE", "FINANCIAL_ANALYSIS", "WEB_SEARCH_RESEARCH", "PREDICTION_MARKETS", "CREATIVE", "INFRASTRUCTURE"]).optional(), query: z.string().max(80).optional(), maxUsdPrice: z.coerce.number().positive().max(1000).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }));
      const environment = environmentOf(ctx, q.environment);
      const found = await discoverServices(ctx.fetch, { network: ARC_NETWORKS[environment], ...(q.category ? { category: q.category } : {}), ...(q.query ? { query: q.query } : {}), ...(q.maxUsdPrice ? { maxUsdPrice: q.maxUsdPrice } : {}), ...(q.limit ? { limit: q.limit } : {}) }, ctx.clock.now());
      res.json({ ...found, services: found.services.filter((s) => s.arc !== null), label: POWERED, pay: { prepare: "POST /v1/circle/x402/prepare { resource, owner, signer, fence? } checks the price and payee against the Fence (caps included) and returns typed data to sign", pay: "POST /v1/circle/x402/pay { paymentId, signature }" } });
    });

    router.get("/circle/marketplace/listing", (req, res) => {
      openToEveryone(res);
      res.json(marketplaceListing(ctx, originOf(req)));
    });

    router.post("/circle/mandates/draft", (req, res) => {
      const b = parseBody(req, z.object({ fence: z.unknown().optional(), template: templateSchema.optional(), principal: evmAddress, agent: evmAddress.optional(), environment: environmentSchema.optional(), validUntil: z.string().datetime().optional() }));
      res.json({ adapter: { id: ARC_MANDATE_ADAPTER.id, status: ARC_MANDATE_ADAPTER.status, note: ARC_MANDATE_ADAPTER.note }, mandate: ARC_MANDATE_ADAPTER.toMandate(fenceOf(b), { principal: b.principal as Address, ...(b.agent ? { agent: b.agent as Address } : {}), environment: environmentOf(ctx, b.environment), ...(b.validUntil ? { validUntil: b.validUntil } : {}) }) });
    });

    router.post("/circle/mandates/proof", (req, res) => {
      const b = parseBody(req, z.object({ verdict: verdictSchema, transactions: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/u)).max(12).optional() }));
      res.json({ adapter: { id: ARC_MANDATE_ADAPTER.id, status: ARC_MANDATE_ADAPTER.status, note: ARC_MANDATE_ADAPTER.note }, proof: ARC_MANDATE_ADAPTER.toExecutionProof(b.verdict as unknown as FenceVerdict, { ...(b.transactions ? { transactions: b.transactions } : {}) }) });
    });

    router.get("/x402/health", (req, res) => {
      openToEveryone(res);
      const settlement = settlementMode(ctx);
      const origin = originOf(req);
      const up = settlement.mode !== "off";
      res.status(up ? 200 : 503).json({
        status: up ? "ok" : "off",
        settlement,
        services: PAID_SERVICES.map((s) => ({ id: s.id, method: s.method, resource: `${origin}${s.path}`, status: up ? "accepting-payments" : "off" })),
        uptimeSeconds: Math.max(0, Math.round((Date.now() - STARTED_AT) / 1000)),
        at: new Date(ctx.clock.now()).toISOString(),
      });
    });

    router.get("/stats", async (req, res) => {
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      openToEveryone(res);
      cachePublicly(res, 300);
      res.json(await publicStats(ctx, environmentOf(ctx, q.environment ?? "mainnet")));
    });
  },
};
