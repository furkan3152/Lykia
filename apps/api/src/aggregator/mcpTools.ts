/**
 * The builder tools on Lykia's MCP server: the aggregator, AI routing,
 * contract integration, adapters, data and security. Registered by
 * buildMcpServer (modules/mcp.ts). Read and build only: a build returns
 * unsigned calls that went through the Fence, the self-check and the
 * security layer; nothing is signed.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { Address, ArcEnvironment } from "@lykia/core";
import type { Hex } from "viem";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { agentServices } from "../agents/index.js";
import { dataPortfolio, dataPrices, dataProtocols, dataTokens, explainTransaction, screenAddressReport } from "../data/service.js";
import { decodeData, encodeCall, readCalls, simulateBatch, type AbiInput } from "../integrations/contracts.js";
import { listAdapters } from "../integrations/registry.js";
import { toolSchema } from "../modules/mcp.js";
import { actionFields, toActionRequest } from "../modules/aggregator.js";
import { actionsFrom } from "../modules/common.js";
import { aiRoute, explainRoute } from "./ai.js";
import { ACTION_KINDS, actionsOf, buildAction, quoteAction, type ActionKind } from "./service.js";

const env = z.enum(["mainnet", "testnet"]).optional();
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/u);
const ENV_JSON = { type: "string", enum: ["mainnet", "testnet"] };
const ADDRESS_JSON = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

const ACTION_JSON = {
  kind: { type: "string", enum: [...ACTION_KINDS] },
  taker: ADDRESS_JSON,
  environment: ENV_JSON,
  tokenIn: { type: "string" },
  tokenOut: { type: "string" },
  token: { type: "string" },
  amount: { type: "string", description: "Whole tokens as a decimal string, or \"all\"." },
  to: ADDRESS_JSON,
  memo: { type: "string" },
  destination: { type: "string" },
  recipient: ADDRESS_JSON,
  venue: { type: "string" },
  slippageBps: { type: "integer" },
  actions: { type: "array", items: { type: "object" } },
  integratorFee: { type: "object" },
  venues: { type: "object" },
  fence: { type: "object" },
};
const actionSchema = z.object({ kind: z.enum(ACTION_KINDS), ...actionFields }).passthrough();

function request(input: z.infer<typeof actionSchema>) {
  const { kind, ...rest } = input;
  const req = toActionRequest(kind as ActionKind, rest);
  actionsFrom(actionsOf(req));
  return req;
}

const wrap = async (fn: () => Promise<unknown>) => {
  try {
    return text(await fn());
  } catch (error) {
    const e = error as { code?: string; message?: string; details?: unknown };
    return text({ error: { code: e.code ?? "ERROR", message: e.message ?? String(error), ...(e.details ? { details: e.details } : {}) } });
  }
};

export function registerBuilderTools(server: McpServer, ctx: AppContext): void {
  const e = (x: ArcEnvironment | undefined) => x ?? ctx.config.mode;
  server.registerTool("lykia_aggregator_quote", { description: "Best-execution quote for any action on Arc (swap, fx, transfer, bridge, deposit, withdraw, supply, borrow, repay, batch): best route, alternatives, price impact, gas in USDC, Lykia's fee and the Fence verdict, plus a quote id.", inputSchema: toolSchema(actionSchema, obj(ACTION_JSON, ["kind", "taker"])) }, async (input) => wrap(() => quoteAction(ctx, request(input as z.infer<typeof actionSchema>))));
  server.registerTool(
    "lykia_build",
    { description: "Unsigned, ready-to-sign calls for an action or a quote id: simulated on Arc in one batch, checked by the Fence and the security layer (fails closed). format: transactions (EOA), calls (smart accounts) or eip5792.", inputSchema: toolSchema(actionSchema.partial({ kind: true }).extend({ quoteId: z.string().optional(), format: z.enum(["transactions", "calls", "eip5792"]).optional(), confirm: z.boolean().optional(), preview: z.boolean().optional() }), obj({ ...ACTION_JSON, quoteId: { type: "string" }, format: { type: "string", enum: ["transactions", "calls", "eip5792"] }, confirm: { type: "boolean" }, preview: { type: "boolean" } }, [])) },
    async (input) =>
      wrap(() => {
        const { quoteId, format, confirm, preview, ...rest } = input as Record<string, unknown>;
        const options = { ...(format ? { format: format as "transactions" } : {}), ...(confirm ? { confirm: true } : {}), ...(preview ? { preview: true } : {}) };
        if (quoteId) return buildAction(ctx, { quoteId: String(quoteId) }, options);
        return buildAction(ctx, { request: request(rest as z.infer<typeof actionSchema>) }, options);
      }),
  );
  server.registerTool("lykia_ai_route", { description: "A request in any language -> plan actions -> the best route across Arc venues, with an explanation. Constraints (venues allow/deny, appetite, maxSteps) only tighten the Fence.", inputSchema: toolSchema(z.object({ text: z.string().min(1).max(1000), owner: address, environment: env, constraints: z.record(z.string(), z.unknown()).optional() }), obj({ text: { type: "string" }, owner: ADDRESS_JSON, environment: ENV_JSON, constraints: { type: "object" } }, ["text", "owner"])) }, async ({ text: t, owner, environment, constraints }) =>
    wrap(() => aiRoute(ctx, { text: t, owner: owner as Address, ...(environment ? { environment } : {}), ...(constraints ? { constraints: constraints as never } : {}) })),
  );
  server.registerTool("lykia_explain_route", { description: "Explain a route, a quote or a build in plain words.", inputSchema: toolSchema(z.object({ route: z.unknown(), language: z.string().max(40).optional() }), obj({ route: { type: "object" }, language: { type: "string" } }, ["route"])) }, async ({ route, language }) => wrap(() => explainRoute(agentServices(ctx).llm(), { route, language: language ?? null })));
  server.registerTool("lykia_contract_encode", { description: "Encode calldata from an ABI (human-readable fragments or JSON), a function name and args (integers as decimal strings).", inputSchema: toolSchema(z.object({ abi: z.array(z.unknown()).min(1), function: z.string(), args: z.array(z.unknown()).optional() }), obj({ abi: { type: "array" }, function: { type: "string" }, args: { type: "array" } }, ["abi", "function"])) }, async ({ abi, function: fn, args }) => wrap(async () => encodeCall({ abi: abi as AbiInput, function: fn, ...(args ? { args } : {}) })));
  server.registerTool("lykia_contract_read", { description: "Read view functions on Arc in one multicall.", inputSchema: toolSchema(z.object({ environment: env, calls: z.array(z.object({ address, abi: z.array(z.unknown()), function: z.string(), args: z.array(z.unknown()).optional() })).min(1).max(50) }), obj({ environment: ENV_JSON, calls: { type: "array" } }, ["calls"])) }, async ({ environment, calls }) =>
    wrap(() => readCalls(ctx, e(environment), calls.map((c) => ({ address: c.address as Address, abi: c.abi as AbiInput, function: c.function, ...(c.args ? { args: c.args } : {}) })))),
  );
  server.registerTool("lykia_contract_simulate", { description: "Simulate a call batch from an address on Arc: balance diff, decoded calls and a security verdict.", inputSchema: toolSchema(z.object({ environment: env, from: address, calls: z.array(z.object({ to: address, data: z.string(), value: z.string().optional() })).min(1).max(20) }), obj({ environment: ENV_JSON, from: ADDRESS_JSON, calls: { type: "array" } }, ["from", "calls"])) }, async ({ environment, from, calls }) =>
    wrap(() => simulateBatch(ctx, e(environment), { from: from as Address, calls: calls.map((c) => ({ to: c.to as Address, data: c.data as Hex, ...(c.value ? { value: c.value } : {}) })) })),
  );
  server.registerTool("lykia_decode", { description: "Decode calldata and logs into plain English with Lykia's knowledge of Arc contracts.", inputSchema: toolSchema(z.object({ environment: env, to: address.optional(), data: z.string().optional(), logs: z.array(z.object({ address, topics: z.array(z.string()), data: z.string() })).optional() }), obj({ environment: ENV_JSON, to: ADDRESS_JSON, data: { type: "string" }, logs: { type: "array" } }, [])) }, async ({ environment, to, data, logs }) =>
    wrap(() => decodeData(ctx, e(environment), { ...(to ? { to: to as Address } : {}), ...(data ? { data: data as Hex } : {}), ...(logs ? { logs: logs.map((l) => ({ address: l.address as Address, topics: l.topics as Hex[], data: l.data as Hex })) } : {}) })),
  );
  server.registerTool("lykia_data_tokens", { description: "The Arc token registry with USD prices and their sources.", inputSchema: toolSchema(z.object({ environment: env }), obj({ environment: ENV_JSON }, [])) }, async ({ environment }) => wrap(() => dataTokens(ctx, e(environment))));
  server.registerTool("lykia_data_prices", { description: "USD prices for registry tokens (Chainlink on Arc, pegs, NAV); unpriced is null, never zero.", inputSchema: toolSchema(z.object({ environment: env, symbols: z.array(z.string()).max(30).optional() }), obj({ environment: ENV_JSON, symbols: { type: "array", items: { type: "string" } } }, [])) }, async ({ environment, symbols }) => wrap(() => dataPrices(ctx, e(environment), symbols)));
  server.registerTool("lykia_data_protocols", { description: "Every Arc protocol: status, TVL, live APYs and routable adapters.", inputSchema: toolSchema(z.object({ environment: env }), obj({ environment: ENV_JSON }, [])) }, async ({ environment }) => wrap(() => dataProtocols(ctx, e(environment))));
  server.registerTool("lykia_portfolio", { description: "An address's balances and positions across Arc venues, in USD.", inputSchema: toolSchema(z.object({ address, environment: env }), obj({ address: ADDRESS_JSON, environment: ENV_JSON }, ["address"])) }, async ({ address: a, environment }) => wrap(() => dataPortfolio(ctx, e(environment), a as Address)));
  server.registerTool("lykia_screen_address", { description: "Screen an address before paying it: blocklist, look-alikes, poisoning, contract Scent, Circle Compliance when configured.", inputSchema: toolSchema(z.object({ address, owner: address.optional(), environment: env }), obj({ address: ADDRESS_JSON, owner: ADDRESS_JSON, environment: ENV_JSON }, ["address"])) }, async ({ address: a, owner, environment }) => wrap(() => screenAddressReport(ctx, e(environment), a as Address, (owner as Address | undefined) ?? null)));
  server.registerTool("lykia_tx_explain", { description: "Explain a transaction hash, or an unsigned transaction, in plain English.", inputSchema: toolSchema(z.object({ environment: env, hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/u).optional(), transaction: z.object({ from: address, to: address, data: z.string(), value: z.string().optional() }).optional() }), obj({ environment: ENV_JSON, hash: { type: "string" }, transaction: { type: "object" } }, [])) }, async ({ environment, hash, transaction }) =>
    wrap(() => explainTransaction(ctx, e(environment), hash ? { hash: hash as Hex } : { ...(transaction ? { transaction: { from: transaction.from as Address, to: transaction.to as Address, data: transaction.data as Hex, ...(transaction.value ? { value: transaction.value } : {}) } } : {}) })),
  );
  server.registerTool("lykia_adapters", { description: "Protocols integrated through Lykia adapter manifests (approved and routable).", inputSchema: toolSchema(z.object({}), obj({}, [])) }, async () => wrap(async () => ({ adapters: (await listAdapters(ctx)).filter((a) => a.status === "approved" || a.status === "routable").map((a) => ({ id: a.id, status: a.status, name: a.manifest.protocol.name, capabilities: a.manifest.capabilities.map((c) => `${c.verb} ${c.tokenIn} -> ${c.tokenOut}`) })) })));
}
