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
}

export const PAID_SERVICES: readonly PaidService[] = [
  {
    id: "fence-check",
    method: "POST",
    path: "/v1/x402/fence/evaluate",
    name: "Fence check",
    description: "Checks a planned DeFi move against an owner's Fence (caps, venues, tokens, recipients, schedule, Scent) and returns allow, confirm or deny with one reason per rule and a verdict digest an agent can put in its Arc Memo.",
    example: { facts: { environment: "mainnet", owner: "0x0000000000000000000000000000000000000001", signer: "agent", steps: [{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "25", tokens: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000", listed: true, acquired: false }], recipient: "0x0000000000000000000000000000000000000002" }] } },
  },
  {
    id: "scent-report",
    method: "GET",
    path: "/v1/x402/scent/{token}",
    name: "Deep Scent report",
    description: "What can be proven about an Arc token before anyone touches it: look-alikes, mint authority, upgradeability, blacklists, transfer fees and owner activity, with a wider balance-slot search than the free report.",
  },
  {
    id: "route-quote",
    method: "POST",
    path: "/v1/x402/quote",
    name: "Route quote",
    description: "The best executable venue on Arc for a swap, deposit or borrow, with every alternative it beat and why. Covers Uniswap, Aerodrome, Morpho, Aave, Circle StableFX and every other venue Lykia routes to.",
    example: { kind: "swap", environment: "mainnet", from: "USDC", to: "EURC", amount: "100" },
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
    description: "Fence checks, token Scent and route quotes for agents on Arc Network. Built on Circle's rails, routing value to every Arc protocol, keeping every agent inside its Fence.",
    provider: { name: "Lykia", url: origin.replace("lykia-api-", "lykia-"), category: "DeFi infrastructure" },
    enabled: payTo !== null,
    payTo,
    scheme: "exact",
    price: { amount: priceUnits, display: `${usdcAmount(priceUnits)} USDC`, asset: "USDC" },
    networks,
    settlement: { mode: settlement.mode, facilitator: settlement.facilitator, note: settlement.note },
    openapi: `${origin}/v1/openapi.json`,
    services: PAID_SERVICES.map((s) => ({ id: s.id, name: s.name, description: s.description, method: s.method, resource: `${origin}${s.path}`, price: { amount: priceUnits, asset: "USDC" }, mimeType: "application/json" })),
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
  paths["/v1/health"] = { get: { operationId: "health", summary: "Service health and features", tags: ["public"], responses: { "200": { description: "Health." } } } };
  return {
    openapi: "3.1.0",
    info: { title: "Lykia API", version: ctx.config.version, description: "Built on Circle's rails, routing value to every Arc protocol, keeping every agent inside its Fence. Paid routes take USDC on Arc over x402.", contact: { name: "Lykia", url: origin.replace("lykia-api-", "lykia-") } },
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
