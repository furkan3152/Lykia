/**
 * Official Circle products on Arc. Keyless products work for everyone;
 * keyed ones answer 503 with the variable they need when it is missing.
 * Nothing here signs: every value-moving step comes back unsigned or as
 * typed data for the owner's (or agent's) wallet.
 *
 *   GET  /circle/status                      every product: live, configured, needs key, not on Arc
 *   GET  /circle/services                    Agent Marketplace x402 services (filter to Arc)
 *   GET  /circle/cctp/fees                   live CCTP fees from Arc to a destination
 *   POST /circle/cctp/forward                approve + depositForBurnWithHook (Forwarding Service)
 *   POST /circle/gateway/transfer/draft      burn intent typed data for the depositor to sign
 *   POST /circle/gateway/transfer            signed intents -> attestation + unsigned gatewayMint, or { owner, amount, destination } -> draft
 *   POST /circle/gateway/transfer/attest     signature for a server-kept draft -> unsigned gatewayMint
 *   GET  /circle/gateway/balance             unified USDC balance per Gateway chain
 *   GET  /circle/compliance/:address         screening result ("not-configured" without CIRCLE_API_KEY)
 *   POST /circle/agent-wallets               alias of /circle/wallets/agent for the web app
 *   POST /circle/x402/prepare                read a service's 402, check the Fence, typed data to sign
 *   POST /circle/x402/pay                    signature -> paid request -> the service's answer
 *   POST /circle/screen                      Compliance Engine screening (CIRCLE_API_KEY)
 *   POST /circle/stablefx/quote | /trade     StableFX RFQ (Circle StableFX access)
 *   GET  /circle/stablefx/trades/:id
 *   POST /circle/wallets/agent               SCA agent wallet on Arc (CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET)
 *   GET  /circle/wallets/:id/balances
 *   GET  /oracles                            Chainlink vs Pyth, display rates (EUR, TRY)
 */
import { evaluateFence, fenceForProfile, findCctpDestination, toBaseUnitsBig, type Address } from "@lykia/core";
import { z } from "zod";
import type { Hex } from "viem";
import { randomBytes } from "node:crypto";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { cctpFees, forwardedBridge } from "../circle/cctp.js";
import { GATEWAY_CHAINS, gatewayChain } from "../circle/chains.js";
import { circleFetch } from "../circle/http.js";
import { GATEWAY_API } from "../flock/flock.js";
import { screenAddress } from "../circle/compliance.js";
import { ARC_NETWORKS, discoverServices } from "../circle/discovery.js";
import { draftGatewayTransfer, submitGatewayTransfer } from "../circle/gateway.js";
import { circleStatus } from "../circle/status.js";
import { stablefxQuote, stablefxTrade, stablefxTradeStatus } from "../circle/stablefx.js";
import { createAgentWallet, walletBalances } from "../circle/wallets.js";
import { arcRequirement, authorizationTypedData, fetchChallenge, payAndFetch, paymentHeader, type PaymentRequirement } from "../circle/x402buyer.js";
import { deviationBps, pythPrices } from "../oracles/pyth.js";
import { referenceFx } from "../oracles/referenceFx.js";
import { getProfile } from "../personal/profile.js";
import { mustSession } from "../platform/session.js";
import { typedCollection } from "../platform/typed.js";
import { services } from "../services.js";
import { environmentOf, environmentSchema, fenceFrom } from "./common.js";

const amountSchema = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/u, "A USDC amount like 25 or 0.5.");

interface PendingPayment {
  readonly resource: string;
  readonly method: "GET" | "POST";
  readonly environment: "mainnet" | "testnet";
  readonly version: number;
  readonly requirement: PaymentRequirement;
  readonly authorization: Record<string, string>;
  readonly from: Address;
}

function needKey(name: string): never {
  throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 503, `This needs ${name}: set it in the API's environment.`, { needs: name });
}

export const circleModule: ApiModule = {
  name: "circle",
  register(router, ctx: AppContext) {
    const pending = typedCollection<PendingPayment>(ctx, "x402_pending");

    router.get("/circle/status", (_req, res) => {
      res.json(circleStatus(ctx.config, ctx.clock.now()));
    });

    router.get("/circle/services", ctx.limits.heavy, async (req, res) => {
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional(), category: z.enum(["SOCIAL_INTELLIGENCE", "FINANCIAL_ANALYSIS", "WEB_SEARCH_RESEARCH", "PREDICTION_MARKETS", "CREATIVE", "INFRASTRUCTURE"]).optional(), query: z.string().max(80).optional(), maxUsdPrice: z.coerce.number().positive().max(1000).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), all: z.enum(["true", "false"]).optional() }));
      const environment = environmentOf(ctx, q.environment);
      res.json(await discoverServices(ctx.fetch, { ...(q.all === "true" ? {} : { network: ARC_NETWORKS[environment] }), ...(q.category ? { category: q.category } : {}), ...(q.query ? { query: q.query } : {}), ...(q.maxUsdPrice ? { maxUsdPrice: q.maxUsdPrice } : {}), ...(q.limit ? { limit: q.limit } : {}) }, ctx.clock.now()));
    });

    router.get("/circle/cctp/fees", async (req, res) => {
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional(), destination: z.string().max(20), forward: z.enum(["true", "false"]).optional() }));
      const dest = findCctpDestination(q.destination);
      if (!dest) throw new LykiaHttpError("INVALID_REQUEST", 400, "Unknown CCTP destination.");
      res.json({ destination: dest.key, domain: dest.domain, fees: await cctpFees(ctx.fetch, environmentOf(ctx, q.environment), dest.domain, q.forward === "true") });
    });

    router.post("/circle/cctp/forward", ctx.limits.heavy, async (req, res) => {
      const b = parseBody(req, z.object({ owner: evmAddress, recipient: evmAddress.optional(), destination: z.string().max(20), amount: amountSchema, environment: environmentSchema.optional(), fast: z.boolean().optional() }));
      const dest = findCctpDestination(b.destination);
      if (!dest) throw new LykiaHttpError("INVALID_REQUEST", 400, "Unknown CCTP destination.");
      res.json(await forwardedBridge(ctx.fetch, { environment: environmentOf(ctx, b.environment), owner: b.owner as Address, recipient: (b.recipient ?? b.owner) as Address, destination: dest.key, amountUnits: toBaseUnitsBig(b.amount, 6), fast: b.fast !== false }));
    });

    router.post("/circle/gateway/transfer/draft", async (req, res) => {
      const b = parseBody(req, z.object({ owner: evmAddress, recipient: evmAddress.optional(), destination: z.string().max(20), amount: amountSchema, environment: environmentSchema.optional() }));
      res.json(draftGatewayTransfer({ environment: environmentOf(ctx, b.environment), depositor: b.owner as Address, ...(b.recipient ? { recipient: b.recipient as Address } : {}), destination: b.destination, valueUnits: toBaseUnitsBig(b.amount, 6) }));
    });

    const gatewayDrafts = typedCollection<{ environment: "mainnet" | "testnet"; destination: string; burnIntent: unknown; owner: string }>(ctx, "gateway_drafts");

    // Two shapes on one path: { owner, amount, destination } drafts (the web app's flow, the intent is kept server-side
    // and finished with /transfer/attest), { burnIntents, signatures } submits intents the caller drafted itself.
    router.post("/circle/gateway/transfer", ctx.limits.heavy, async (req, res) => {
      const body = req.body as Record<string, unknown> | undefined;
      if (body && Array.isArray(body.burnIntents)) {
        const b = parseBody(req, z.object({ destination: z.string().max(20), environment: environmentSchema.optional(), burnIntents: z.array(z.unknown()).min(1).max(8), signatures: z.array(z.string().regex(/^0x[0-9a-fA-F]{130}$/u)).min(1).max(8) }));
        if (!gatewayChain(b.destination)) throw new LykiaHttpError("INVALID_REQUEST", 400, "Unknown Gateway destination.");
        return res.json(await submitGatewayTransfer(ctx.fetch, { environment: environmentOf(ctx, b.environment), destination: b.destination, burnIntents: b.burnIntents, signatures: b.signatures as Hex[] }));
      }
      const b = parseBody(req, z.object({ owner: evmAddress, recipient: evmAddress.optional(), destination: z.string().max(20), amount: amountSchema, environment: environmentSchema.optional() }));
      const environment = environmentOf(ctx, b.environment);
      const draft = draftGatewayTransfer({ environment, depositor: b.owner as Address, ...(b.recipient ? { recipient: b.recipient as Address } : {}), destination: b.destination, valueUnits: toBaseUnitsBig(b.amount, 6) });
      const transferId = `gwd_${randomBytes(9).toString("base64url")}`;
      await gatewayDrafts.put(transferId, { environment, destination: b.destination, burnIntent: draft.burnIntents[0], owner: b.owner.toLowerCase() }, { ttlMs: 30 * 60_000 });
      res.json({ typedData: draft.typedData[0], transferId, fee: draft.fee });
    });

    router.post("/circle/gateway/transfer/attest", ctx.limits.heavy, async (req, res) => {
      const b = parseBody(req, z.object({ owner: evmAddress, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/u), transferId: z.string().regex(/^gwd_[A-Za-z0-9_-]{8,20}$/u), environment: environmentSchema.optional() }));
      const doc = await gatewayDrafts.get(b.transferId);
      if (!doc || doc.value.owner !== b.owner.toLowerCase()) throw new LykiaHttpError("NOT_FOUND", 404, "That transfer draft expired; draft it again.");
      await gatewayDrafts.delete(b.transferId);
      const result = await submitGatewayTransfer(ctx.fetch, { environment: doc.value.environment, destination: doc.value.destination, burnIntents: [doc.value.burnIntent], signatures: [b.signature as Hex] });
      res.json({ transaction: result.mint, attestation: result.attestation, transferId: result.transferId, note: "Send this on the destination chain to mint the USDC." });
    });

    router.get("/circle/gateway/balance", async (req, res) => {
      const q = parseQuery(req, z.object({ owner: evmAddress, environment: environmentSchema.optional() }));
      const environment = environmentOf(ctx, q.environment);
      const response = await circleFetch(ctx.fetch, `${GATEWAY_API[environment]}/v1/balances`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "USDC", sources: GATEWAY_CHAINS.map((c) => ({ domain: c.domain, depositor: q.owner })) }), signal: AbortSignal.timeout(8_000) }, "Circle Gateway");
      if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Gateway answered ${response.status}.`);
      const json = (await response.json()) as { balances?: { domain: number; balance: string }[] };
      const perChain = (json.balances ?? []).map((row) => ({ chain: GATEWAY_CHAINS.find((c) => c.domain === row.domain)?.name ?? `domain ${row.domain}`, balance: row.balance }));
      const total = perChain.reduce((sum, row) => sum + Number(row.balance || 0), 0);
      res.json({ total: total.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, ""), perChain, note: "Unified USDC balance in Circle Gateway, spendable on any Gateway chain." });
    });

    router.get("/circle/compliance/:address", async (req, res) => {
      const { address } = parseParams(req, z.object({ address: evmAddress }));
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      if (!ctx.config.circle.apiKey) return res.json({ result: "not-configured", reasons: ["Circle Compliance Engine needs CIRCLE_API_KEY on the API."], provider: "Circle Compliance Engine" });
      const r = await screenAddress(ctx.fetch, ctx.config.circle.apiKey, environmentOf(ctx, q.environment), address, ctx.clock.now());
      res.json({ result: r.result, reasons: [r.ruleName, r.riskScore].filter(Boolean), provider: "Circle Compliance Engine" });
    });

    router.post("/circle/x402/prepare", ctx.limits.heavy, async (req, res) => {
      const b = parseBody(req, z.object({ resource: z.string().url().max(500), method: z.enum(["GET", "POST"]).optional(), owner: evmAddress, environment: environmentSchema.optional(), signer: z.enum(["wallet", "agent"]).optional(), fence: z.unknown().optional() }));
      const environment = environmentOf(ctx, b.environment);
      const method = b.method ?? "GET";
      const probe = await fetchChallenge(ctx.publicFetch, b.resource, method);
      if (!probe.challenge) return res.json({ paid: false, status: probe.status, note: "The service did not ask for payment.", preview: probe.preview });
      const requirement = arcRequirement(probe.challenge, environment);
      if (!requirement) throw new LykiaHttpError("NO_ROUTE", 422, `This service does not take USDC on Arc ${environment}.`, { accepts: probe.challenge.accepts.map((a) => ({ scheme: a.scheme, network: a.network })) });
      const owner = b.owner as Address;
      const profile = await getProfile(ctx, owner);
      const fence = fenceFrom(b.fence) ?? fenceForProfile(profile);
      const usd = (Number(requirement.amount) / 1e6).toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "");
      const verdict = evaluateFence(fence, {
        environment,
        signer: b.signer ?? "wallet",
        owner,
        steps: [{ id: "s1", kind: "transfer", venue: "circle-x402", usd, tokens: [{ symbol: "USDC", address: requirement.asset as Address, listed: true, acquired: false }], recipient: requirement.payTo }],
        spent: await services(ctx).intents.spent(environment, owner),
        now: ctx.clock.now(),
      });
      const typedData = authorizationTypedData({ environment, from: owner, requirement, now: ctx.clock.now() });
      const paymentId = `pay_${randomBytes(9).toString("base64url")}`;
      if (verdict.signable) await pending.put(paymentId, { resource: b.resource, method, environment, version: probe.challenge.x402Version, requirement, authorization: typedData.message, from: owner }, { ttlMs: Math.max(60_000, requirement.maxTimeoutSeconds * 1000) });
      res.json({ paid: false, paymentId: verdict.signable ? paymentId : null, priceUsdc: usd, payTo: requirement.payTo, network: requirement.network, verdict, typedData: verdict.signable ? typedData : null });
    });

    router.post("/circle/x402/pay", ctx.limits.heavy, async (req, res) => {
      const b = parseBody(req, z.object({ paymentId: z.string().regex(/^pay_[A-Za-z0-9_-]{8,20}$/u), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/u), body: z.string().max(8_000).optional() }));
      const doc = await pending.get(b.paymentId);
      if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "That payment expired or was already used; prepare it again.");
      await pending.delete(b.paymentId);
      const p = doc.value;
      const header = paymentHeader(p.version, p.requirement, p.authorization, b.signature as Hex);
      const result = await payAndFetch(ctx.publicFetch, { resource: p.resource, method: p.method, header, ...(b.body ? { body: b.body } : {}) });
      res.json({ paid: result.status < 400, ...result });
    });

    router.post("/circle/screen", async (req, res) => {
      const b = parseBody(req, z.object({ address: evmAddress, environment: environmentSchema.optional() }));
      if (!ctx.config.circle.apiKey) needKey("CIRCLE_API_KEY");
      res.json(await screenAddress(ctx.fetch, ctx.config.circle.apiKey, environmentOf(ctx, b.environment), b.address, ctx.clock.now()));
    });

    router.post("/circle/stablefx/quote", async (req, res) => {
      const b = parseBody(req, z.object({ from: z.enum(["USDC", "EURC"]), to: z.enum(["USDC", "EURC"]), amount: amountSchema, side: z.enum(["from", "to"]).optional(), type: z.enum(["reference", "tradable"]).optional(), tenor: z.enum(["instant", "hourly", "daily"]).optional(), recipientAddress: evmAddress.optional() }));
      if (b.from === b.to) throw new LykiaHttpError("INVALID_REQUEST", 400, "from and to must differ.");
      if (!ctx.config.stablefxApiKey) needKey("CIRCLE_API_KEY with StableFX access (or STABLEFX_API_KEY)");
      if ((b.type ?? "tradable") === "tradable" && !b.recipientAddress) throw new LykiaHttpError("INVALID_REQUEST", 400, "Tradable quotes need recipientAddress.");
      res.json(await stablefxQuote(ctx.fetch, ctx.config.stablefxApiKey, { from: b.from, to: b.to, amount: b.amount, side: b.side ?? "from", type: b.type ?? "tradable", tenor: b.tenor ?? "instant", ...(b.recipientAddress ? { recipientAddress: b.recipientAddress } : {}) }));
    });
    router.post("/circle/stablefx/trade", async (req, res) => {
      const b = parseBody(req, z.object({ quoteId: z.string().min(8).max(64), address: evmAddress, message: z.unknown(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/u) }));
      if (!ctx.config.stablefxApiKey) needKey("CIRCLE_API_KEY with StableFX access (or STABLEFX_API_KEY)");
      res.status(201).json(await stablefxTrade(ctx.fetch, ctx.config.stablefxApiKey, { quoteId: b.quoteId, address: b.address, message: b.message, signature: b.signature }));
    });
    router.get("/circle/stablefx/trades/:id", async (req, res) => {
      const { id } = parseParams(req, z.object({ id: z.string().min(8).max(64) }));
      if (!ctx.config.stablefxApiKey) needKey("CIRCLE_API_KEY with StableFX access (or STABLEFX_API_KEY)");
      res.json(await stablefxTradeStatus(ctx.fetch, ctx.config.stablefxApiKey, id));
    });

    router.post("/circle/wallets/agent", ctx.limits.heavy, async (req, res) => {
      const session = await mustSession(ctx, req);
      const b = parseBody(req, z.object({ name: z.string().min(1).max(50), refId: z.string().min(1).max(50), environment: environmentSchema.optional() }));
      const { apiKey, entitySecret, walletSetId } = ctx.config.circle;
      if (!apiKey || !entitySecret) needKey("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET");
      const wallet = await createAgentWallet(ctx.fetch, { apiKey, entitySecret, walletSetId }, { environment: environmentOf(ctx, b.environment), refId: `${session.address.slice(0, 10)}:${b.refId}`, name: b.name }, ctx.clock.now());
      res.status(201).json({ wallet, note: "SCA wallet on Arc: pair it with a LykiaAccount session, and add a Gas Station policy in the Circle Console to sponsor its gas." });
    });
    router.post("/circle/agent-wallets", ctx.limits.heavy, async (req, res) => {
      const session = await mustSession(ctx, req);
      const b = parseBody(req, z.object({ agentId: z.string().min(1).max(50), name: z.string().min(1).max(50).optional(), environment: environmentSchema.optional() }));
      const { apiKey, entitySecret, walletSetId } = ctx.config.circle;
      if (!apiKey || !entitySecret) needKey("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET");
      const wallet = await createAgentWallet(ctx.fetch, { apiKey, entitySecret, walletSetId }, { environment: environmentOf(ctx, b.environment), refId: `${session.address.slice(0, 10)}:${b.agentId}`, name: b.name ?? b.agentId }, ctx.clock.now());
      res.status(201).json({ address: wallet.address, walletId: wallet.id, wallet, note: "SCA wallet on Arc: bind it to the agent's LykiaAccount session; a Gas Station policy in the Circle Console can sponsor its gas." });
    });
    router.get("/circle/wallets/:id/balances", async (req, res) => {
      await mustSession(ctx, req);
      const { id } = parseParams(req, z.object({ id: z.string().uuid() }));
      if (!ctx.config.circle.apiKey) needKey("CIRCLE_API_KEY");
      res.json(await walletBalances(ctx.fetch, ctx.config.circle.apiKey, id));
    });

    router.get("/oracles", async (_req, res) => {
      const chainlink = await services(ctx).prices.prices(["USDC", "EURC", "cirBTC"]);
      const pyth = await pythPrices(ctx.chains, ["USDC", "EURC", "cirBTC", "USD/TRY"], ctx.clock.now());
      const rows = ["USDC", "EURC", "cirBTC"].map((s) => ({ symbol: s, chainlink: chainlink[s]?.usd ?? null, pyth: pyth[s]?.price ?? null, deviationBps: deviationBps(chainlink[s]?.usd ?? null, pyth[s]?.price ?? null) }));
      const reference = await referenceFx(ctx.fetch, ctx.clock.now());
      const eurUsd = chainlink.EURC?.usd ?? pyth.EURC?.price ?? null;
      const pythTry = pyth["USD/TRY"]?.price ?? null;
      const refTry = reference?.perUsd.TRY ?? null;
      const tryUsd = pythTry !== null ? String(1 / Number(pythTry)) : refTry !== null ? String(1 / Number(refTry)) : null;
      // Display-only cross-check: ECB EUR against the Chainlink EURC/USD feed (EURC tracks EUR, so a wide gap means a stale feed or a depeg).
      const refEurUsd = reference?.perUsd.EUR ? String(1 / Number(reference.perUsd.EUR)) : null;
      res.json({
        prices: rows,
        display: { EUR: eurUsd, TRY: tryUsd },
        displaySources: { EUR: chainlink.EURC?.usd ? "chainlink" : pyth.EURC?.price ? "pyth" : null, TRY: pythTry !== null ? "pyth" : refTry !== null ? "ecb-reference" : null },
        reference: reference ? { ...reference, eurcVsEcbBps: deviationBps(chainlink.EURC?.usd ?? null, refEurUsd) } : null,
        sources: { chainlink: "Chainlink feeds on Arc mainnet", pyth: "Pyth contract on Arc mainnet (getPriceUnsafe; only feeds pushed in the last hour)", ecb: "ECB reference rates (display only, not tradable)" },
        note: "display.X is USD per unit of X. The Fence's oracle-gap fact compares fresh on-chain feeds only (Chainlink vs Pyth); with no fresh second feed it makes no claim.",
      });
    });
  },
};
