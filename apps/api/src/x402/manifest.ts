/**
 * What Lykia sells over x402, in machine-readable form: the service manifest
 * at /.well-known/x402 and an OpenAPI 3.1 document at /v1/openapi.json. The
 * Agent Marketplace listing points at these; prices and the pay-to wallet
 * come from the live config, so the documents never drift from the 402s.
 */
import { networkFor, contractAddress, type ArcEnvironment } from "@lykia/core";
import type { AppContext } from "../context.js";
import { settlementMode } from "./x402.js";

export interface PaidService {
  readonly id: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly example?: Record<string, unknown>;
  /** Agent Marketplace category (the Discovery API's enum). */
  readonly category: "FINANCIAL_ANALYSIS" | "INFRASTRUCTURE";
  readonly tags: readonly string[];
  /** JSON Schemas for the Discovery API's metadata.input / metadata.output. */
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
}

const ADDRESS_SCHEMA = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } as const;
const ENVIRONMENT_SCHEMA = { type: "string", enum: ["mainnet", "testnet"] } as const;

export const PAID_SERVICES: readonly PaidService[] = [
  {
    id: "fence-check",
    method: "POST",
    path: "/v1/x402/fence/evaluate",
    name: "Fence check",
    description: "Checks a planned DeFi move against an owner's Fence (caps, venues, tokens, recipients, schedule, Scent) and returns allow, confirm or deny with one reason per rule and a verdict digest an agent can put in its Arc Memo.",
    example: { facts: { environment: "mainnet", owner: "0x0000000000000000000000000000000000000001", signer: "agent", steps: [{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "25", tokens: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000", listed: true, acquired: false }], recipient: "0x0000000000000000000000000000000000000002" }] } },
    category: "FINANCIAL_ANALYSIS",
    tags: ["policy", "agents", "risk", "arc", "usdc", "fence"],
    input: { type: "object", required: ["facts"], properties: { fence: { type: "object", description: "A lykia.fence/v1 document; absent = the default Fence (the Balanced preset)." }, facts: { type: "object", required: ["environment", "owner", "signer", "steps"], properties: { environment: ENVIRONMENT_SCHEMA, owner: ADDRESS_SCHEMA, signer: { type: "string", enum: ["wallet", "agent"] }, steps: { type: "array", maxItems: 12, items: { type: "object" } } } } } },
    output: { type: "object", required: ["schema", "decision", "signable", "reasons", "digest"], properties: { schema: { const: "lykia.verdict/v1" }, decision: { type: "string", enum: ["allow", "confirm", "deny"] }, signable: { type: "boolean" }, reasons: { type: "array", items: { type: "object" } }, fenceHash: { type: "string" }, digest: { type: "string" } } },
  },
  {
    id: "scent-report",
    method: "GET",
    path: "/v1/x402/scent/{token}",
    name: "Deep Scent report",
    description: "What can be proven about an Arc token before anyone touches it: look-alikes, mint authority, upgradeability, blacklists, transfer fees and owner activity, with a wider balance-slot search than the free report.",
    category: "FINANCIAL_ANALYSIS",
    tags: ["token-risk", "security", "arc", "scent"],
    input: { type: "object", required: ["token"], properties: { token: ADDRESS_SCHEMA, environment: ENVIRONMENT_SCHEMA } },
    output: { type: "object", properties: { token: ADDRESS_SCHEMA, level: { type: "string", enum: ["verified", "no-red-flags", "caution", "danger", "unknown"] }, findings: { type: "array", items: { type: "object" } } } },
  },
  {
    id: "route-quote",
    method: "POST",
    path: "/v1/x402/quote",
    name: "Route quote",
    description: "The best executable venue on Arc for a swap, deposit or borrow, with every alternative it beat and why. Covers Uniswap, Aerodrome, Morpho, Aave and every other venue Lykia can route through today.",
    example: { kind: "swap", environment: "mainnet", from: "USDC", to: "EURC", amount: "100" },
    category: "INFRASTRUCTURE",
    tags: ["routing", "defi", "swap", "lending", "arc", "usdc", "eurc"],
    input: { type: "object", required: ["kind", "amount"], properties: { kind: { type: "string", enum: ["swap", "deposit", "borrow"] }, environment: ENVIRONMENT_SCHEMA, from: { type: "string" }, to: { type: "string" }, amount: { type: "string", pattern: "^\\d+(?:\\.\\d+)?$" } } },
    output: { type: "object", properties: { best: { type: "object" }, alternatives: { type: "array", items: { type: "object" } } } },
  },
];

function usdcAmount(units: string): string {
  const padded = units.padStart(7, "0");
  return `${padded.slice(0, -6)}.${padded.slice(-6)}`.replace(/\.?0+$/u, "") || "0";
}

export function serviceManifest(ctx: AppContext, origin: string) {
  const { payTo, priceUnits } = ctx.config.x402;
  const settlement = settlementMode(ctx);
  const networks = (["mainnet", "testnet"] as ArcEnvironment[]).map((environment) => ({ environment, network: networkFor(environment).caip2, asset: contractAddress("usdc", environment) }));
  return {
    x402Version: 2,
    name: "Lykia",
    description: "Fence checks, token Scent and route quotes for agents on Arc Network. Built on Circle's rails, routing value through every Arc venue with an executable adapter (every other Arc protocol is mapped), keeping every agent inside its Fence.",
    provider: { name: "Lykia", url: origin.replace("lykia-api-", "lykia-"), category: "DeFi infrastructure" },
    enabled: payTo !== null,
    payTo,
    scheme: "exact",
    price: { amount: priceUnits, display: `${usdcAmount(priceUnits)} USDC`, asset: "USDC" },
    networks,
    settlement: { mode: settlement.mode, facilitator: settlement.facilitator, note: settlement.note },
    openapi: `${origin}/v1/openapi.json`,
    health: `${origin}/v1/x402/health`,
    listing: { marketplace: "Circle Agent Marketplace", status: "submission-ready", guide: "docs/circle/marketplace-listing.md", package: `${origin}/v1/circle/marketplace/listing` },
    services: PAID_SERVICES.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      method: s.method,
      resource: `${origin}${s.path}`,
      price: { amount: priceUnits, asset: "USDC" },
      mimeType: "application/json",
      // Discovery API item metadata (developers.circle.com/agent-stack/agent-marketplace/discovery-api).
      type: "http",
      metadata: {
        provider: { name: "Lykia", description: "Fence checks, token Scent and route quotes for agents on Arc Network.", category: s.category, tags: s.tags, website: origin.replace("lykia-api-", "lykia-"), docsUrl: `${origin.replace("lykia-api-", "lykia-")}/build`, openApiUrl: `${origin}/v1/openapi.json` },
        path: s.path,
        method: s.method,
        description: s.description,
        mimeType: "application/json",
        input: s.input,
        output: s.output,
        supportsVanillax402: true,
        supportsCircleGateway: false,
      },
    })),
    free: { ecosystem: `${origin}/v1/ecosystem`, fenceEvaluate: `${origin}/v1/fence/evaluate`, scent: `${origin}/v1/scent/{token}`, quote: `${origin}/v1/quote` },
  };
}

export function openApi(ctx: AppContext, origin: string) {
  const { payTo, priceUnits } = ctx.config.x402;
  const paidOp = (s: PaidService) => ({
    operationId: s.id.replace(/-(\w)/gu, (_m, c: string) => c.toUpperCase()),
    summary: s.name,
    description: `${s.description} Paid per call over x402: ${usdcAmount(priceUnits)} USDC on Arc to ${payTo ?? "(disabled)"}. Without a payment the route answers 402 with the requirements.`,
    tags: ["x402"],
    "x-x402": { scheme: "exact", amount: priceUnits, asset: "USDC", payTo, networks: ["eip155:5042", "eip155:5042002"] },
    parameters: [
      ...(s.path.includes("{token}") ? [{ name: "token", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }] : []),
      { name: "environment", in: "query", required: false, schema: { type: "string", enum: ["mainnet", "testnet"] } },
      { name: "X-PAYMENT", in: "header", required: false, description: "Base64 JSON x402 payment payload (EIP-3009 authorization).", schema: { type: "string" } },
    ],
    ...(s.method === "POST" ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object" }, ...(s.example ? { example: s.example } : {}) } } } } : {}),
    responses: {
      "200": { description: "The answer. PAYMENT-RESPONSE carries the settlement result.", content: { "application/json": { schema: { type: "object" } } } },
      "402": { description: "Payment required: { x402Version, error, accepts: [PaymentRequirements] }.", content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } } },
      "400": { description: "Invalid request (validated before any payment is taken)." },
    },
  });
  const paths: Record<string, Record<string, unknown>> = {};
  for (const s of PAID_SERVICES) paths[s.path] = { ...(paths[s.path] ?? {}), [s.method.toLowerCase()]: paidOp(s) };
  paths["/v1/ecosystem"] = { get: { operationId: "ecosystem", summary: "The Arc ecosystem: every protocol, Circle product, TVL and value routed by Lykia", tags: ["public"], parameters: [{ name: "environment", in: "query", schema: { type: "string", enum: ["mainnet", "testnet"] } }], responses: { "200": { description: "Ecosystem snapshot (CORS-open, cached 60 s)." } } } };
  paths["/v1/fees"] = { get: { operationId: "fees", summary: "Lykia's protocol fee and the beta caps", tags: ["public"], responses: { "200": { description: "Fee and caps." } } } };
  paths["/v1/x402/health"] = { get: { operationId: "x402Health", summary: "Health of the paid x402 routes (for Agent Marketplace health checks)", tags: ["public"], responses: { "200": { description: "Healthy." }, "503": { description: "Paid routes are off." } } } };
  paths["/v1/health"] = { get: { operationId: "health", summary: "Service health and features", tags: ["public"], responses: { "200": { description: "Health." } } } };
  return {
    openapi: "3.1.0",
    info: { title: "Lykia API", version: ctx.config.version, description: "Built on Circle's rails, routing value through every Arc venue with an executable adapter (every other Arc protocol is mapped), keeping every agent inside its Fence. Paid routes take USDC on Arc over x402.", contact: { name: "Lykia", url: origin.replace("lykia-api-", "lykia-") } },
    servers: [{ url: origin }],
    tags: [{ name: "x402", description: "Pay per call in USDC on Arc." }, { name: "public", description: "Free, no key." }],
    paths,
    components: {
      schemas: {
        PaymentRequired: {
          type: "object",
          required: ["x402Version", "accepts"],
          properties: {
            x402Version: { type: "integer", const: 2 },
            error: { type: "string" },
            accepts: { type: "array", items: { type: "object", properties: { scheme: { const: "exact" }, network: { type: "string" }, amount: { type: "string" }, asset: { type: "string" }, payTo: { type: "string" }, maxTimeoutSeconds: { type: "integer" }, resource: { type: "string" }, description: { type: "string" }, mimeType: { type: "string" }, extra: { type: "object" } } } },
          },
        },
      },
    },
  };
}

/** The origin a request reached us on (trust proxy is configured, so this is the public host). */
export function originOf(req: { protocol: string; get(name: string): string | undefined }): string {
  const host = req.get("host") ?? "localhost";
  const local = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(host);
  return `${local ? req.protocol : "https"}://${host}`;
}
