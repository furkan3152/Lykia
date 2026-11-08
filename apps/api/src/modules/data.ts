/**
 * Data and security as a service, and generic contract integration.
 *
 *   GET  /data/tokens                     the token registry with prices and sources
 *   GET  /data/prices[?symbols=EURC,cirBTC]
 *   GET  /data/protocols                  the protocols mapped on Arc: status, TVL, APYs, routable adapters
 *   GET  /data/portfolio/:address         balances and positions across venues, in USD
 *   GET  /security/screen/address/:address[?owner]   address screening
 *   GET  /security/scent/token/:token     Scent report for a token
 *   POST /tx/explain  { hash } | { transaction }      plain-English explanation
 *   GET  /tx/explain/:hash
 *   POST /contracts/encode | /contracts/read | /contracts/simulate | /contracts/decode
 *
 * Public reads are cacheable for a short time (see cachePublicly); nothing here signs.
 */
import type { Address } from "@lykia/core";
import type { Hex } from "viem";
import { z } from "zod";
import { cachePublicly } from "../http/request.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery, queryList, txHash } from "../http/validate.js";
import { dataPortfolio, dataPrices, dataProtocols, dataTokens, explainTransaction, screenAddressReport } from "../data/service.js";
import { decodeData, encodeCall, readCalls, simulateBatch, type AbiInput } from "../integrations/contracts.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { services } from "../services.js";
import { environmentOf, environmentQuery, environmentSchema } from "./common.js";

const hex = z.string().regex(/^0x(?:[0-9a-fA-F]{2}){0,24576}$/u, "0x-prefixed hex.");
const abiInput = z.union([z.array(z.string().max(1000)).min(1).max(64), z.array(z.record(z.string(), z.unknown())).min(1).max(256)]);
const args = z.array(z.unknown()).max(32);
const value = z.string().regex(/^\d{1,40}$/u);

const encodeBody = z.object({ abi: abiInput, function: z.string().min(1).max(200), args: args.optional() }).strict();
const readBody = z.object({ environment: environmentSchema.optional(), calls: z.array(z.object({ address: evmAddress, abi: abiInput, function: z.string().min(1).max(200), args: args.optional() })).min(1).max(50) }).strict();
const simCall = z.union([z.object({ to: evmAddress, data: hex, value: value.optional() }).strict(), z.object({ to: evmAddress, abi: abiInput, function: z.string().min(1).max(200), args: args.optional(), value: value.optional() }).strict()]);
const simulateBody = z.object({ environment: environmentSchema.optional(), from: evmAddress, calls: z.array(simCall).min(1).max(20), tokens: z.array(evmAddress).max(10).optional(), abi: abiInput.optional() }).strict();
const logSchema = z.object({ address: evmAddress, topics: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/u)).min(1).max(4), data: hex });
const decodeBody = z.object({ environment: environmentSchema.optional(), to: evmAddress.optional(), data: hex.optional(), value: value.optional(), logs: z.array(logSchema).max(100).optional(), abi: abiInput.optional() }).strict();
const explainBody = z.union([z.object({ environment: environmentSchema.optional(), hash: txHash }).strict(), z.object({ environment: environmentSchema.optional(), transaction: z.object({ from: evmAddress, to: evmAddress, data: hex, value: value.optional() }).strict() }).strict()]);
const AddressParams = z.object({ address: evmAddress });
const TokenParams = z.object({ token: evmAddress });
const HashParams = z.object({ hash: txHash });
const pricesQuery = environmentQuery.extend({ symbols: queryList(30, z.string().min(2).max(12)).optional() });
const screenQuery = environmentQuery.extend({ owner: evmAddress.optional() });

const loose = z.object({}).passthrough();
documentRoutes([
  { method: "get", path: "/v1/data/tokens", tag: "Data", summary: "Token registry with prices and sources", scope: "read", auth: "public", query: environmentQuery, response: z.object({ environment: environmentSchema, tokens: z.array(z.object({ symbol: z.string(), address: z.string().nullable(), decimals: z.number(), priceUsd: z.string().nullable(), priceSource: z.string().nullable() }).passthrough()) }).passthrough() },
  { method: "get", path: "/v1/data/prices", tag: "Data", summary: "USD prices (Chainlink on Arc, pegs, NAV)", scope: "read", auth: "public", query: pricesQuery, response: z.object({ prices: z.array(z.object({ symbol: z.string(), usd: z.string().nullable(), source: z.string() }).passthrough()) }).passthrough() },
  { method: "get", path: "/v1/data/protocols", tag: "Data", summary: "The protocols mapped on Arc: status, TVL, APYs and routable adapters", scope: "read", auth: "public", query: environmentQuery, response: z.object({ protocols: z.array(loose) }).passthrough() },
  { method: "get", path: "/v1/data/portfolio/:address", tag: "Data", summary: "Balances and positions across venues, in USD", scope: "read", auth: "public", params: AddressParams, query: environmentQuery, response: z.object({ totalUsd: z.string().nullable(), holdings: z.array(loose), venues: z.array(loose) }).passthrough() },
  { method: "get", path: "/v1/security/screen/address/:address", tag: "Security", summary: "Screen an address", description: "Blocklist (USDC/EURC), look-alikes against the owner's contacts, poisoning, contract Scent and Circle Compliance when configured.", scope: "read", auth: "public", params: AddressParams, query: screenQuery, response: z.object({ decision: z.enum(["pass", "warn", "block"]), findings: z.array(loose) }).passthrough() },
  { method: "get", path: "/v1/security/scent/token/:token", tag: "Security", summary: "Scent report for a token", scope: "read", auth: "public", params: TokenParams, query: environmentQuery, response: loose },
  { method: "post", path: "/v1/tx/explain", tag: "Data", summary: "Explain a transaction in plain English", description: "A mined transaction by hash (decoded calls and events), or an unsigned one (decoded, simulated, with a security verdict).", scope: "quote", auth: "public", body: explainBody, response: z.object({ summary: z.string(), steps: z.array(z.string()) }).passthrough() },
  { method: "get", path: "/v1/tx/explain/:hash", tag: "Data", summary: "Explain a mined transaction", scope: "read", auth: "public", params: HashParams, query: environmentQuery, response: z.object({ summary: z.string(), steps: z.array(z.string()) }).passthrough() },
  { method: "post", path: "/v1/contracts/encode", tag: "Contracts", summary: "ABI + function + args -> calldata", scope: "quote", auth: "public", body: encodeBody, response: z.object({ data: z.string(), selector: z.string(), signature: z.string() }) },
  { method: "post", path: "/v1/contracts/read", tag: "Contracts", summary: "Many view calls in one multicall", scope: "quote", auth: "public", body: readBody, response: z.object({ block: z.string().nullable(), results: z.array(loose) }).passthrough() },
  { method: "post", path: "/v1/contracts/simulate", tag: "Contracts", summary: "Simulate a call batch from an address", description: "One Multicall3From eth_call: balance diff, decoded calls, events when eth_simulateV1 is available, and a security verdict.", scope: "quote", auth: "public", body: simulateBody, response: z.object({ ok: z.boolean(), balanceChanges: z.array(loose), security: z.object({ decision: z.string(), findings: z.array(loose) }).passthrough() }).passthrough() },
  { method: "post", path: "/v1/contracts/decode", tag: "Contracts", summary: "Calldata and logs -> plain English", scope: "quote", auth: "public", body: decodeBody, response: z.object({ calls: z.array(z.unknown()), lines: z.array(z.string()), events: z.array(z.unknown()) }) },
]);

export const dataModule: ApiModule = {
  name: "data",
  register(router, ctx) {
    router.get("/data/tokens", async (req, res) => {
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      cachePublicly(res, 30);
      res.json(await dataTokens(ctx, environment));
    });

    router.get("/data/prices", async (req, res) => {
      const q = parseQuery(req, pricesQuery);
      cachePublicly(res, 15);
      res.json(await dataPrices(ctx, environmentOf(ctx, q.environment), q.symbols));
    });

    router.get("/data/protocols", ctx.limits.heavy, async (req, res) => {
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      cachePublicly(res, 60);
      res.json(await dataProtocols(ctx, environment));
    });

    router.get("/data/portfolio/:address", ctx.limits.heavy, async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      res.json(await dataPortfolio(ctx, environment, address as Address));
    });

    router.get("/security/screen/address/:address", ctx.limits.heavy, async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const q = parseQuery(req, screenQuery);
      res.json(await screenAddressReport(ctx, environmentOf(ctx, q.environment), address as Address, (q.owner as Address | undefined) ?? null));
    });

    router.get("/security/scent/token/:token", ctx.limits.heavy, async (req, res) => {
      const { token } = parseParams(req, TokenParams);
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      cachePublicly(res, 60);
      res.json(await services(ctx).scent.sniff(environment, token as Address));
    });

    router.post("/tx/explain", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, explainBody);
      const environment = environmentOf(ctx, body.environment);
      res.json(await explainTransaction(ctx, environment, "hash" in body ? { hash: body.hash } : { transaction: { from: body.transaction.from as Address, to: body.transaction.to as Address, data: body.transaction.data as Hex, ...(body.transaction.value ? { value: body.transaction.value } : {}) } }));
    });

    router.get("/tx/explain/:hash", ctx.limits.heavy, async (req, res) => {
      const { hash } = parseParams(req, HashParams);
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      res.json(await explainTransaction(ctx, environment, { hash }));
    });

    router.post("/contracts/encode", (req, res) => {
      const body = parseBody(req, encodeBody);
      res.json(encodeCall({ abi: body.abi as AbiInput, function: body.function, ...(body.args ? { args: body.args } : {}) }));
    });

    router.post("/contracts/read", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, readBody);
      res.json(await readCalls(ctx, environmentOf(ctx, body.environment), body.calls.map((c) => ({ address: c.address as Address, abi: c.abi as AbiInput, function: c.function, ...(c.args ? { args: c.args } : {}) }))));
    });

    router.post("/contracts/simulate", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, simulateBody);
      const calls = body.calls.map((c) => ("data" in c ? { to: c.to as Address, data: c.data as Hex, ...(c.value ? { value: c.value } : {}) } : { to: c.to as Address, data: encodeCall({ abi: c.abi as AbiInput, function: c.function, ...(c.args ? { args: c.args } : {}) }).data, ...(c.value ? { value: c.value } : {}) }));
      res.json(await simulateBatch(ctx, environmentOf(ctx, body.environment), { from: body.from as Address, calls, ...(body.tokens ? { tokens: body.tokens as Address[] } : {}), ...(body.abi ? { abi: body.abi as AbiInput } : {}) }));
    });

    router.post("/contracts/decode", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, decodeBody);
      res.json(await decodeData(ctx, environmentOf(ctx, body.environment), { ...(body.to ? { to: body.to as Address } : {}), ...(body.data ? { data: body.data as Hex } : {}), ...(body.value ? { value: body.value } : {}), ...(body.logs ? { logs: body.logs.map((l) => ({ address: l.address as Address, topics: l.topics as Hex[], data: l.data as Hex })) } : {}), ...(body.abi ? { abi: body.abi as AbiInput } : {}) }));
    });
  },
};
