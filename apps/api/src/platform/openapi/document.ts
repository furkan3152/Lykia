/**
 * Builds the OpenAPI 3.1 document served at GET /v1/openapi.json from
 * `documentedRoutes()` (what modules register) merged over the catalogue of
 * older routes, plus the x402 details of the paid routes. Shared
 * components: the error envelope, the security schemes (Lykia-Key,
 * Lykia-Session, x402), the Idempotency-Key and Lykia-Version headers, and
 * the rate-limit response headers.
 */
import { API_VERSIONS, LATEST_API_VERSION, SCOPE_DESCRIPTIONS } from "@lykia/core/api/platform";
import type { AppContext } from "../../context.js";
import { openApi as x402Document } from "../../x402/manifest.js";
import { EXISTING_ROUTES } from "./catalog.js";
import { documentedRoutes, type DocumentedRoute } from "./registry.js";
import { zodToJsonSchema, isOptional, type JsonSchema } from "./zodSchema.js";

const TAG_DESCRIPTIONS: Record<string, string> = {
  Platform: "The API itself: this document, the reference, versions and the event catalogue.",
  Auth: "Sign in with your wallet (SIWE on Arc) for a session token.",
  Developers: "Developer profile, keys and settings.",
  Keys: "API keys: live and test, scopes, rotation, IP allowlists and limits.",
  Webhooks: "Signed webhooks: endpoints, the event catalogue, deliveries, replays and test events.",
  Events: "The event feed behind webhooks.",
  Logs: "Request logs per key and project.",
  Billing: "Plans, usage and credits for API usage.",
  Projects: "White-label projects: brand, origins, keys and limits.",
  Intents: "Plan an outcome, prepare unsigned steps, submit hashes. The server never signs.",
  Fence: "The rule book around an agent or an owner.",
  x402: "Pay per call in USDC on Arc.",
};

/** Express path to OpenAPI path: /v1/intents/:id -> /v1/intents/{id}. */
function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
}

function operationId(route: DocumentedRoute): string {
  if (route.operationId) return route.operationId;
  const parts = route.path
    .replace(/^\/v1\//u, "")
    .split("/")
    .filter(Boolean)
    .map((p) => (p.startsWith(":") ? `by_${p.slice(1)}` : p))
    .join("_")
    .replace(/[^A-Za-z0-9_]+/gu, "_");
  const camel = `${route.method}_${parts}`.replace(/_+([a-zA-Z0-9])/gu, (_m, c: string) => c.toUpperCase());
  return camel.replace(/^./u, (c) => c.toLowerCase());
}

function pathParams(route: DocumentedRoute): JsonSchema[] {
  const declared = route.params ? zodToJsonSchema(route.params) : null;
  const props = (declared?.properties ?? {}) as Record<string, JsonSchema>;
  return [...route.path.matchAll(/:([A-Za-z0-9_]+)/gu)].map((m) => ({ name: m[1], in: "path", required: true, schema: props[m[1] as string] ?? { type: "string" } }));
}

function queryParams(route: DocumentedRoute): JsonSchema[] {
  if (!route.query) return [];
  const schema = zodToJsonSchema(route.query);
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, s]) => ({ name, in: "query", required: required.has(name), schema: s, ...(typeof s.description === "string" ? { description: s.description } : {}) }));
}

function security(route: DocumentedRoute): JsonSchema[] | undefined {
  switch (route.auth) {
    case "public":
      return [{}, { LykiaKey: [] }];
    case "session":
      return [{ LykiaSession: [] }, { LykiaKey: [] }];
    case "secret":
      return [{ LykiaKey: [] }, { LykiaSession: [] }];
    case "key":
      return [{ LykiaKey: [] }, {}];
    default:
      return undefined;
  }
}

const ERROR_RESPONSES = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "429": { $ref: "#/components/responses/RateLimited" },
  "500": { $ref: "#/components/responses/ServerError" },
};

function operation(route: DocumentedRoute): JsonSchema {
  const status = String(route.status ?? 200);
  const parameters: JsonSchema[] = [...pathParams(route), ...queryParams(route), { $ref: "#/components/parameters/LykiaVersion" }];
  if (route.idempotent) parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });
  if (route.x402) parameters.push({ name: "X-PAYMENT", in: "header", required: false, description: "Base64 JSON x402 payment payload (EIP-3009 authorization in USDC on Arc).", schema: { type: "string" } });
  const op: JsonSchema = {
    operationId: operationId(route),
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    tags: [route.tag],
    parameters,
    responses: {
      [status]: {
        description: "OK",
        headers: { "X-Request-Id": { $ref: "#/components/headers/RequestId" }, "X-RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" }, "X-RateLimit-Remaining": { $ref: "#/components/headers/RateLimitRemaining" }, "Lykia-Version": { $ref: "#/components/headers/LykiaVersion" } },
        content: { "application/json": { schema: route.response ? zodToJsonSchema(route.response) : { type: "object" }, ...(route.example !== undefined ? { example: route.example } : {}) } },
      },
      ...ERROR_RESPONSES,
      ...(route.x402 ? { "402": { $ref: "#/components/responses/PaymentRequired" } } : {}),
      ...(route.idempotent ? { "409": { $ref: "#/components/responses/Conflict" } } : {}),
    },
    "x-lykia-auth": route.auth ?? "public",
    ...(route.scope ? { "x-lykia-scope": route.scope } : {}),
    ...(route.idempotent ? { "x-lykia-idempotent": true } : {}),
    ...(route.deprecated ? { deprecated: true } : {}),
  };
  const sec = security(route);
  if (sec) op.security = sec;
  if (route.body && route.method !== "get" && route.method !== "delete") {
    op.requestBody = { required: !isOptional(route.body), content: { "application/json": { schema: zodToJsonSchema(route.body) } } };
  }
  return op;
}

/** Every documented route: module registrations first, then the catalogue fills the gaps. */
export function allDocumentedRoutes(): DocumentedRoute[] {
  const out = new Map<string, DocumentedRoute>();
  for (const route of EXISTING_ROUTES) out.set(`${route.method} ${route.path}`, route);
  for (const route of documentedRoutes()) out.set(`${route.method} ${route.path}`, route);
  return [...out.values()].sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

let cache: { key: string; doc: JsonSchema } | null = null;

export function buildOpenApi(ctx: AppContext, origin: string): JsonSchema {
  const routes = allDocumentedRoutes();
  const cacheKey = `${origin}|${routes.length}|${ctx.config.version}|${ctx.config.x402.payTo ?? ""}`;
  if (cache?.key === cacheKey) return cache.doc;
  const paid = x402Document(ctx, origin) as { paths: Record<string, Record<string, JsonSchema>>; components: { schemas: Record<string, JsonSchema> } };
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const route of routes) {
    const p = openApiPath(route.path);
    const op = operation(route);
    const extra = paid.paths[p]?.[route.method];
    if (extra?.["x-x402"]) op["x-x402"] = extra["x-x402"];
    paths[p] = { ...(paths[p] ?? {}), [route.method]: op };
  }
  const tags = [...new Set(routes.map((r) => r.tag))].sort().map((name) => ({ name, ...(TAG_DESCRIPTIONS[name] ? { description: TAG_DESCRIPTIONS[name] } : {}) }));
  const doc: JsonSchema = {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "Lykia API",
      version: ctx.config.version,
      summary: "Agents and stablecoins on Arc Network through one API, from a one-line quote to enterprise payouts.",
      description:
        "Built on Arc Network and Circle's rails. Plan money moves in plain words, check them against a Fence, hand unsigned steps to the user's wallet and follow them to finality. The server never holds user keys; intents come back unsigned. Optional server signers (a gas-only keeper, opt-in Circle developer-controlled wallets) are off unless the operator configures them.\n\nAuthenticate with `Lykia-Key` (lk_live_… or lk_test_…; test keys only reach testnet) or a `Lykia-Session` from wallet sign-in. Pin behaviour with `Lykia-Version` (" +
        API_VERSIONS.join(", ") +
        "). Send `Idempotency-Key` on POSTs. Every answer carries `X-Request-Id`; every error is `{ error: { code, message, details?, requestId } }`.",
      contact: { name: "Lykia", url: origin.replace("lykia-api-", "lykia-") },
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: origin }],
    security: [{}, { LykiaKey: [] }, { LykiaSession: [] }],
    tags,
    paths,
    components: {
      securitySchemes: {
        LykiaKey: { type: "apiKey", in: "header", name: "Lykia-Key", description: `API key. Scopes: ${Object.entries(SCOPE_DESCRIPTIONS).map(([k, v]) => `${k} (${v})`).join("; ")}` },
        LykiaSession: { type: "apiKey", in: "header", name: "Lykia-Session", description: "Session token from POST /v1/auth/verify (SIWE on Arc)." },
        X402: { type: "apiKey", in: "header", name: "X-PAYMENT", description: "x402 payment (USDC on Arc) for paid routes and pay-as-you-go overage." },
      },
      parameters: {
        IdempotencyKey: { name: "Idempotency-Key", in: "header", required: false, description: "8 to 128 characters. Retries with the same key and body replay the first answer (Idempotent-Replayed: true); a different body is 409.", schema: { type: "string", pattern: "^[A-Za-z0-9_.:-]{8,128}$" } },
        LykiaVersion: { name: "Lykia-Version", in: "header", required: false, description: `API version date. Defaults to the key's pinned version, else ${LATEST_API_VERSION}.`, schema: { type: "string", enum: [...API_VERSIONS] } },
      },
      headers: {
        RequestId: { description: "Unique id of this request; quote it to support.", schema: { type: "string" } },
        RateLimitLimit: { description: "Requests per minute allowed for this key.", schema: { type: "integer" } },
        RateLimitRemaining: { description: "Requests left in the current minute.", schema: { type: "integer" } },
        LykiaVersion: { description: "The API version that served the request.", schema: { type: "string" } },
      },
      schemas: {
        ...paid.components.schemas,
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "requestId"],
              properties: { code: { type: "string", pattern: "^[A-Z][A-Z0-9_]*$", examples: ["INVALID_REQUEST", "RATE_LIMITED"] }, message: { type: "string" }, details: { type: "object" }, requestId: { type: "string" } },
            },
          },
        },
      },
      responses: {
        BadRequest: { description: "Invalid request (details.issues lists each problem).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Unauthorized: { description: "Missing, unknown or revoked credentials.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Forbidden: { description: "The key lacks a scope, the IP or origin is not allowed, or a test key asked for mainnet (LIVE_MODE_REQUIRED).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Conflict: { description: "IDEMPOTENCY_CONFLICT: the key was used with a different body, or the first request is still running.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        RateLimited: { description: "RATE_LIMITED or QUOTA_EXCEEDED. Retry-After says when.", headers: { "Retry-After": { schema: { type: "integer" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        PaymentRequired: { description: "x402 payment required: { x402Version, error, accepts: [PaymentRequirements] }.", content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } } },
        ServerError: { description: "An internal or upstream failure. Safe to retry GETs; retry POSTs with the same Idempotency-Key.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    "x-lykia-versions": API_VERSIONS,
  };
  cache = { key: cacheKey, doc };
  return doc;
}
