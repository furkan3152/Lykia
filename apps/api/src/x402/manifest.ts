/**
 * What Lykia sells over x402, in machine-readable form: the service manifest
 * at /.well-known/x402 (with an `items` list in the shape of Circle's
 * Discovery API and x402 bazaar listings), the x402 details of the OpenAPI
 * document, and the bazaar extension every 402 carries. Prices and the
 * pay-to wallet come from the live config and the request schemas from the
 * routes' own validators, so the documents never drift from the 402s.
 */
import { networkFor, contractAddress, VERDICT_SCHEMA, type Address, type ArcEnvironment } from "@lykia/core";
import type { Request } from "express";
import type { ZodTypeAny } from "zod";
import type { AppContext } from "../context.js";
import { environmentQuerySchema, fenceCheckSchema, quoteSchema, tokenParamsSchema } from "../modules/inputs.js";
import { zodToJsonSchema, type JsonSchema } from "../platform/openapi/zodSchema.js";
import { requirementsFor, settlementMode, X402_VERSION } from "./x402.js";

export type PaidServiceId = "fence-check" | "scent-report" | "route-quote";

export interface PaidService {
  readonly id: PaidServiceId;
  readonly method: "GET" | "POST";
  /** The OpenAPI path; `{name}` marks a path parameter. */
  readonly path: string;
  readonly name: string;
  readonly description: string;
  /** Agent Marketplace category (the Discovery API's enum). */
  readonly category: "FINANCIAL_ANALYSIS" | "INFRASTRUCTURE";
  readonly tags: readonly string[];
  /** A request agents can copy: the JSON body of a POST, the path and query parameters of a GET. */
  readonly example: { readonly body?: Record<string, unknown>; readonly path?: Record<string, string>; readonly query?: Record<string, string> };
  /** JSON Schemas of the request: the body of a POST, the path and query parameters of a GET. */
  readonly request: { readonly body?: JsonSchema; readonly path?: JsonSchema; readonly query?: JsonSchema };
  /** JSON Schema of the answer. */
  readonly output: JsonSchema;
}

const HASH = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } as const;
const ADDRESS = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } as const;
const json = (schema: ZodTypeAny): JsonSchema => zodToJsonSchema(schema);

export const PAID_SERVICES: readonly PaidService[] = [
  {
    id: "fence-check",
    method: "POST",
    path: "/v1/x402/fence/evaluate",
    name: "Fence check",
    description: "Checks a planned DeFi move against an owner's Fence (caps, venues, tokens, recipients, schedule, Scent) and returns allow, confirm or deny with one reason per rule and a verdict digest an agent can put in its Arc Memo.",
    category: "FINANCIAL_ANALYSIS",
    tags: ["policy", "agents", "risk", "arc", "usdc", "fence"],
    example: { body: { facts: { environment: "mainnet", owner: "0x0000000000000000000000000000000000000001", signer: "agent", steps: [{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "25", tokens: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000", listed: true, acquired: false }], recipient: "0x0000000000000000000000000000000000000002" }] } } },
    request: { body: json(fenceCheckSchema) },
    output: {
      type: "object",
      required: ["schema", "decision", "signable", "reasons", "waived", "fenceHash", "factsDigest", "digest"],
      properties: {
        schema: { const: VERDICT_SCHEMA },
        decision: { type: "string", enum: ["allow", "confirm", "deny"], description: "The verdict: allow, confirm (the owner must confirm) or deny." },
        signable: { type: "boolean", description: "False on deny or in dry-run: nothing may be signed." },
        reasons: { type: "array", description: "One entry per rule that spoke.", items: { type: "object", required: ["rule", "decision", "message"], properties: { rule: { type: "string" }, decision: { type: "string", enum: ["allow", "confirm", "deny"] }, message: { type: "string" }, step: { type: "string" } } } },
        waived: { type: "array", description: "Reasons set aside for a step that brings funds home.", items: { type: "object" } },
        fenceHash: { ...HASH, description: "Hash of the Fence that was applied." },
        factsDigest: { ...HASH, description: "Digest of the facts that were checked." },
        digest: { ...HASH, description: "Binds the Fence, the facts and the decision; goes into the Arc Memo." },
      },
    },
  },
  {
    id: "scent-report",
    method: "GET",
    path: "/v1/x402/scent/{token}",
    name: "Deep Scent report",
    description: "What can be proven about an Arc token before anyone touches it: look-alikes, mint authority, upgradeability, blacklists, transfer fees and owner activity, with a wider balance-slot search than the free report.",
    category: "FINANCIAL_ANALYSIS",
    tags: ["token-risk", "security", "arc", "scent"],
    example: { path: { token: "0x3600000000000000000000000000000000000000" }, query: { environment: "mainnet" } },
    request: { path: json(tokenParamsSchema), query: json(environmentQuerySchema) },
    output: {
      type: "object",
      required: ["token", "environment", "level", "wolves", "checks", "trust", "at"],
      properties: {
        token: ADDRESS,
        environment: { type: "string", enum: ["mainnet", "testnet"] },
        symbol: { type: ["string", "null"] },
        name: { type: ["string", "null"] },
        decimals: { type: ["integer", "null"] },
        level: { type: "string", enum: ["verified", "no-red-flags", "caution", "danger", "unknown"], description: "The best level a token outside the registry can reach is no-red-flags; Scent never says safe." },
        wolves: { type: "array", items: { type: "string" }, description: "The red flags found." },
        checks: { type: "array", description: "Every check that ran: true passed, false is a red flag, null could not run.", items: { type: "object", required: ["id", "ok", "detail"], properties: { id: { type: "string" }, ok: { type: ["boolean", "null"] }, detail: { type: "string" } } } },
        trust: { type: "object", description: "Registry status: verified, lookalike or unverified." },
        at: { type: "string", format: "date-time" },
        deep: { type: "boolean" },
      },
    },
  },
  {
    id: "route-quote",
    method: "POST",
    path: "/v1/x402/quote",
    name: "Route quote",
    description: "The best executable venue on Arc for a swap, earn or borrow, with every alternative it beat and why. Covers Uniswap, Aerodrome, Morpho, Aave and every other venue Lykia can route through today.",
    category: "INFRASTRUCTURE",
    tags: ["routing", "defi", "swap", "lending", "arc", "usdc", "eurc"],
    example: { body: { kind: "swap", environment: "mainnet", from: "USDC", to: "EURC", amount: "100" } },
    request: { body: json(quoteSchema) },
    output: {
      type: "object",
      required: ["kind", "environment", "options", "choice"],
      properties: {
        kind: { type: "string", enum: ["swap", "earn", "borrow"] },
        environment: { type: "string", enum: ["mainnet", "testnet"] },
        options: { type: "array", description: "Every live venue's option, priced the same way.", items: { type: "object", required: ["venue", "label"], properties: { venue: { type: "string" }, label: { type: "string" } } } },
        choice: { type: ["object", "null"], description: "The engine's pick: { chosen, alternatives, reason }; null when no venue can do it.", properties: { chosen: { type: "object" }, alternatives: { type: "array", items: { type: "object" } }, reason: { type: "string" } } },
      },
    },
  },
];

export function paidService(id: PaidServiceId): PaidService {
  const service = PAID_SERVICES.find((s) => s.id === id);
  if (!service) throw new Error(`unknown paid service ${id}`);
  return service;
}

function usdcAmount(units: string): string {
  const padded = units.padStart(7, "0");
  return `${padded.slice(0, -6)}.${padded.slice(-6)}`.replace(/\.?0+$/u, "") || "0";
}

/** The origin a request reached us on (trust proxy is configured, so this is the public host). */
export function originOf(req: { protocol: string; get(name: string): string | undefined }): string {
  const host = req.get("host") ?? "localhost";
  const local = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(host);
  return `${local ? req.protocol : "https"}://${host}`;
}

/** The web app for an API origin: api.<domain> belongs to <domain>; any other host uses the first https web origin configured. */
export function siteOrigin(ctx: AppContext, apiOrigin: string): string {
  const url = new URL(apiOrigin);
  if (url.hostname.startsWith("api.")) return `${url.protocol}//${url.host.slice("api.".length)}`;
  return ctx.config.webOrigins.find((origin) => origin.startsWith("https://")) ?? apiOrigin;
}

/** Where agents read how to call the API: the reference the API renders itself, readable without scripts. */
export function docsUrl(apiOrigin: string): string {
  return `${apiOrigin}/v1/reference`;
}

/**
 * The absolute URL a request buys, as discovery lists it: the service path
 * with its path parameters filled in from the request. A parameter that is
 * still its `{name}` placeholder stays one, so a probe of the listed URL
 * gets that URL back.
 */
export function resourceUrl(service: PaidService, origin: string, params: Readonly<Record<string, string | undefined>> = {}): string {
  return `${origin}${service.path.replace(/\{(\w+)\}/gu, (placeholder, name: string) => {
    const value = params[name];
    if (value === undefined || value === placeholder) return placeholder;
    return /^[A-Za-z0-9._~-]+$/u.test(value) ? value : encodeURIComponent(value);
  })}`;
}

/** A JSON Schema without its `description` texts: the shape alone, small enough for a PAYMENT-REQUIRED header. */
function shapeOf(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (schema === undefined) return undefined;
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, inner]) => (key === "description" && typeof inner === "string" ? [] : [[key, strip(inner)]])));
  };
  return strip(schema) as JsonSchema;
}

/**
 * The x402 `bazaar` extension: what to send and what comes back, so an
 * agent can call the service from the 402 alone. `info` holds a working
 * example (for a GET, this request's path parameters); `schema` validates
 * `info` and carries the shape of the real request and answer (the field
 * descriptions are in the discovery document and the OpenAPI document).
 */
export function bazaarExtension(service: PaidService, pathParams?: Readonly<Record<string, string>>) {
  const request = { body: shapeOf(service.request.body), path: shapeOf(service.request.path), query: shapeOf(service.request.query) };
  const params = pathParams && Object.keys(pathParams).length > 0 ? pathParams : service.example.path;
  const input =
    service.method === "GET"
      ? { type: "http", method: "GET", ...(service.example.query ? { queryParams: service.example.query } : {}), ...(params ? { pathParams: params } : {}) }
      : { type: "http", method: "POST", bodyType: "json", body: service.example.body ?? {} };
  const inputSchema =
    service.method === "GET"
      ? { type: "object", required: ["type", "method"], properties: { type: { const: "http" }, method: { const: "GET" }, ...(request.query ? { queryParams: request.query } : {}), ...(request.path ? { pathParams: request.path } : {}) } }
      : { type: "object", required: ["type", "method", "bodyType", "body"], properties: { type: { const: "http" }, method: { const: "POST" }, bodyType: { const: "json" }, body: request.body ?? { type: "object" } } };
  const routeTemplate = service.path.includes("{") ? service.path.replace(/\{(\w+)\}/gu, ":$1") : null;
  return {
    bazaar: {
      info: { input, output: { type: "json" } },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["input"],
        properties: { input: inputSchema, output: { type: "object", required: ["type"], properties: { type: { const: "json" }, example: shapeOf(service.output) } } },
      },
      ...(routeTemplate ? { routeTemplate } : {}),
    },
  };
}

/** The offer side of a paid route: what it sells, the URL it is listed under and the bazaar extension. */
export function paidOffer(id: PaidServiceId) {
  const service = paidService(id);
  return {
    description: service.description,
    resource: (req: Request) => resourceUrl(service, originOf(req), req.params as Record<string, string>),
    extensions: (req: Request) => bazaarExtension(service, req.params as Record<string, string>),
  };
}

/** The agent-facing summary in the OpenAPI document (`info.x-guidance`): what each paid call gives and when to make it. */
export function agentGuidance(ctx: AppContext): string {
  const price = `${usdcAmount(ctx.config.x402.priceUnits)} USDC`;
  return [
    `Lykia sells three checks for agents that move money on Arc Network, each ${price} per call over x402 (scheme exact, USDC on Arc, EIP-3009).`,
    "POST /v1/x402/fence/evaluate before an agent signs a DeFi move: send the planned steps and, optionally, the owner's Fence; get allow, confirm or deny, one reason per rule and a verdict digest for the Arc Memo.",
    "GET /v1/x402/scent/{token} before touching an unfamiliar Arc token: get its risk level, the red flags and every check that ran. Scent never calls a token safe.",
    "POST /v1/x402/quote to choose where to swap, earn or borrow on Arc: get every live venue's option and the engine's pick with its reason.",
    "An unpaid call answers 402 with the offer. Sign the EIP-3009 authorization and send it again in PAYMENT-SIGNATURE or X-PAYMENT. With a valid payment, an invalid request answers 400 and nothing is settled; the payment settles only when the answer is ready.",
    "Each call is paid on the Arc network it runs on (mainnet or testnet): facts.environment for the Fence check, environment in the body for a quote, the environment query parameter for Scent; the last two default to the server's network.",
  ].join(" ");
}

/** The `x-payment-info` block of a paid operation: price, currency and protocol. */
export function paymentInfo(ctx: AppContext) {
  const { payTo, priceUnits } = ctx.config.x402;
  return {
    price: { mode: "fixed", currency: "USDC", amount: usdcAmount(priceUnits) },
    protocols: [{ x402: { x402Version: X402_VERSION, scheme: "exact", payTo, networks: (["mainnet", "testnet"] as ArcEnvironment[]).map((environment) => ({ environment, network: networkFor(environment).caip2, asset: contractAddress("usdc", environment) })) } }],
  };
}

export function serviceManifest(ctx: AppContext, origin: string) {
  const { payTo, priceUnits } = ctx.config.x402;
  const settlement = settlementMode(ctx);
  const networks = (["mainnet", "testnet"] as ArcEnvironment[]).map((environment) => ({ environment, network: networkFor(environment).caip2, asset: contractAddress("usdc", environment) }));
  const site = siteOrigin(ctx, origin);
  const provider = { name: "Lykia", description: "Fence checks, token Scent and route quotes for agents on Arc Network.", website: site, docsUrl: docsUrl(origin), openApiUrl: `${origin}/v1/openapi.json` };
  const metadataOf = (s: PaidService) => ({
    provider: { name: provider.name, description: provider.description, category: s.category, tags: s.tags, website: provider.website, docsUrl: provider.docsUrl, openApiUrl: provider.openApiUrl },
    path: s.path,
    method: s.method,
    description: s.description,
    mimeType: "application/json",
    input: s.method === "GET" ? { type: "object", required: (s.request.path?.required as string[] | undefined) ?? [], properties: { ...((s.request.path?.properties as JsonSchema | undefined) ?? {}), ...((s.request.query?.properties as JsonSchema | undefined) ?? {}) } } : s.request.body,
    output: s.output,
    siwx: false,
    supportsVanillax402: true,
    supportsCircleGateway: false,
  });
  // The offer an unpaid call that names no network gets, as the live 402 states it.
  const offerOf = (s: PaidService, to: Address) => {
    const { scheme, network, asset, amount, maxTimeoutSeconds, extra } = requirementsFor(ctx.config.mode, to, priceUnits, resourceUrl(s, origin), s.description);
    return { scheme, network, asset, amount, payTo: to, maxTimeoutSeconds, extra };
  };
  const items = payTo
    ? PAID_SERVICES.map((s) => ({
        resource: resourceUrl(s, origin),
        type: "http",
        x402Version: X402_VERSION,
        accepts: [offerOf(s, payTo)],
        description: s.description,
        mimeType: "application/json",
        serviceName: "Lykia",
        tags: s.tags,
        metadata: metadataOf(s),
        extensions: bazaarExtension(s),
      }))
    : [];
  return {
    x402Version: X402_VERSION,
    name: "Lykia",
    description: "Fence checks, token Scent and route quotes for agents on Arc Network. Built on Circle's rails, routing value through every Arc venue with an executable adapter (every other Arc protocol is mapped), keeping every agent inside its Fence.",
    provider: { name: "Lykia", url: site, docsUrl: provider.docsUrl, category: "DeFi infrastructure" },
    enabled: payTo !== null,
    payTo,
    scheme: "exact",
    price: { amount: priceUnits, display: `${usdcAmount(priceUnits)} USDC`, asset: "USDC" },
    networks,
    settlement: { mode: settlement.mode, facilitator: settlement.facilitator, note: settlement.note },
    openapi: `${origin}/v1/openapi.json`,
    health: `${origin}/v1/x402/health`,
    listing: { marketplace: "Circle Agent Marketplace", status: "submission-ready", guide: "docs/circle/marketplace-listing.md", package: `${origin}/v1/circle/marketplace/listing` },
    // Discovery listings (Circle's Discovery API ServiceListing, x402 bazaar): one per paid resource, none while paid routes are off.
    items,
    pagination: { limit: items.length, offset: 0, total: items.length },
    services: PAID_SERVICES.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      method: s.method,
      resource: resourceUrl(s, origin),
      price: { amount: priceUnits, asset: "USDC" },
      mimeType: "application/json",
      // Discovery API item metadata (developers.circle.com/agent-stack/agent-marketplace/discovery-api).
      type: "http",
      metadata: metadataOf(s),
    })),
    free: { ecosystem: `${origin}/v1/ecosystem`, fenceEvaluate: `${origin}/v1/fence/evaluate`, scent: `${origin}/v1/scent/{token}`, quote: `${origin}/v1/quote` },
  };
}

export function openApi(ctx: AppContext, origin: string) {
  const { payTo, priceUnits } = ctx.config.x402;
  const paidOp = (s: PaidService) => ({
    operationId: s.id.replace(/-(\w)/gu, (_m, c: string) => c.toUpperCase()),
    summary: s.name,
    description: `${s.description} Paid per call over x402: ${usdcAmount(priceUnits)} USDC to ${payTo ?? "(disabled)"}, on the Arc network the request runs on. Without a payment the route answers 402 with the offer, whatever the request holds; with a valid payment an invalid request answers 400 and nothing is settled.`,
    tags: ["x402"],
    "x-payment-info": paymentInfo(ctx),
    "x-x402": { scheme: "exact", amount: priceUnits, asset: "USDC", payTo, networks: ["eip155:5042", "eip155:5042002"] },
    parameters: [
      ...(s.request.path ? Object.entries((s.request.path.properties as Record<string, JsonSchema>) ?? {}).map(([name, schema]) => ({ name, in: "path", required: true, description: schema.description, schema })) : []),
      ...(s.request.query ? Object.entries((s.request.query.properties as Record<string, JsonSchema>) ?? {}).map(([name, schema]) => ({ name, in: "query", required: false, description: schema.description, schema })) : []),
      { name: "PAYMENT-SIGNATURE", in: "header", required: false, description: "x402 v2: the payment payload, base64 JSON (an EIP-3009 authorization). Send this or X-PAYMENT.", schema: { type: "string" } },
      { name: "X-PAYMENT", in: "header", required: false, description: "x402 v1 name for the same payment payload. Send this or PAYMENT-SIGNATURE.", schema: { type: "string" } },
    ],
    ...(s.method === "POST" ? { requestBody: { required: true, content: { "application/json": { schema: s.request.body ?? { type: "object" }, ...(s.example.body ? { example: s.example.body } : {}) } } } } : {}),
    responses: {
      "200": { description: "The answer. PAYMENT-RESPONSE carries the settlement result.", content: { "application/json": { schema: s.output } } },
      "402": { description: "Payment required: { x402Version, error, resource, accepts: [PaymentRequirements], extensions }.", content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } } },
      "400": { description: "Invalid request, once a valid payment is attached; nothing is settled." },
    },
  });
  const paths: Record<string, Record<string, unknown>> = {};
  for (const s of PAID_SERVICES) paths[s.path] = { ...(paths[s.path] ?? {}), [s.method.toLowerCase()]: paidOp(s) };
  paths["/v1/ecosystem"] = { get: { operationId: "ecosystem", summary: "The Arc ecosystem: every protocol, Circle product, TVL and value routed by Lykia", tags: ["public"], parameters: [{ name: "environment", in: "query", schema: { type: "string", enum: ["mainnet", "testnet"] } }], responses: { "200": { description: "Ecosystem snapshot (CORS-open, cached 60 s)." } } } };
  paths["/v1/fees"] = { get: { operationId: "fees", summary: "Lykia's protocol fee and the beta caps", tags: ["public"], responses: { "200": { description: "Fee and caps." } } } };
  paths["/v1/x402/health"] = { get: { operationId: "x402Health", summary: "Health of the paid x402 routes (for Agent Marketplace health checks)", tags: ["public"], responses: { "200": { description: "Healthy." }, "503": { description: "Paid routes are off." } } } };
  paths["/v1/health"] = { get: { operationId: "health", summary: "Service health and features", tags: ["public"], responses: { "200": { description: "Health." } } } };
  const site = siteOrigin(ctx, origin);
  return {
    openapi: "3.1.0",
    info: { title: "Lykia API", version: ctx.config.version, description: "Built on Circle's rails, routing value through every Arc venue with an executable adapter (every other Arc protocol is mapped), keeping every agent inside its Fence. Paid routes take USDC on Arc over x402.", "x-guidance": agentGuidance(ctx), contact: { name: "Lykia", url: site, ...(ctx.config.platform.contactEmail ? { email: ctx.config.platform.contactEmail } : {}) } },
    externalDocs: { description: "The Lykia API reference", url: docsUrl(origin) },
    servers: [{ url: origin }],
    tags: [{ name: "x402", description: "Pay per call in USDC on Arc." }, { name: "public", description: "Free, no key." }],
    paths,
    components: {
      schemas: {
        PaymentRequired: {
          type: "object",
          required: ["x402Version", "resource", "accepts"],
          properties: {
            x402Version: { type: "integer", const: 2 },
            error: { type: "string" },
            resource: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" }, description: { type: "string" }, mimeType: { type: "string" } } },
            accepts: { type: "array", items: { type: "object", properties: { scheme: { const: "exact" }, network: { type: "string" }, amount: { type: "string" }, asset: { type: "string" }, payTo: { type: "string" }, maxTimeoutSeconds: { type: "integer" }, resource: { type: "string", format: "uri" }, description: { type: "string" }, mimeType: { type: "string" }, extra: { type: "object" } } } },
            extensions: { type: "object", description: "x402 extensions; bazaar carries the request and answer schemas." },
          },
        },
      },
    },
  };
}
