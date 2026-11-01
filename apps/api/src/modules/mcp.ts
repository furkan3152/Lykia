/**
 * MCP over streamable HTTP at /v1/mcp: read-only tools for agents. Nothing
 * here signs; lykia_plan returns unsigned plans the owner executes.
 */
import { createMcpHandler, McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { DEFAULT_FENCE, evaluateFence, protocolsFor, validateFence, type Address, type ArcEnvironment, type FenceFacts } from "@lykia/core";
import express, { type Request, type Response } from "express";
import { z, type ZodType } from "zod";
import type { AppContext } from "../context.js";
import type { ApiModule } from "../http/router.js";
import { readSentence } from "../language/reader.js";
import { services } from "../services.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";

const env = z.enum(["mainnet", "testnet"]).optional();
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/u);

/** Wraps a zod schema and its JSON Schema as a Standard Schema the MCP SDK accepts. */
export function toolSchema<T>(schema: ZodType<T>, json: Record<string, unknown>): StandardSchemaWithJSON<T, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "lykia",
      validate: (value: unknown) => {
        const result = schema.safeParse(value);
        return result.success ? { value: result.data } : { issues: result.error.issues.map((i) => ({ message: i.message, path: i.path })) };
      },
      jsonSchema: { input: () => json, output: () => json },
    },
  } as unknown as StandardSchemaWithJSON<T, T>;
}

const ENV_JSON = { type: "string", enum: ["mainnet", "testnet"], description: "Arc environment (default: the server's mode)" };
const ADDRESS_JSON = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
function objectJson(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function buildMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: "lykia", version: ctx.config.version });
  const environmentOf = (e: ArcEnvironment | undefined) => e ?? ctx.config.mode;
  server.registerTool("lykia_venues", { description: "Venues on Arc Network and which ones Lykia executes.", inputSchema: toolSchema(z.object({ environment: env }), objectJson({ environment: ENV_JSON }, [])) }, async ({ environment }) =>
    text(protocolsFor(environmentOf(environment)).map((p) => ({ id: p.id, name: p.name, category: p.category, executable: EXECUTABLE_VENUES[environmentOf(environment)].has(p.id), summary: p.summary }))),
  );
  server.registerTool("lykia_flock", { description: "Balance sheet of an address on Arc: tokens, Morpho vaults, Gateway balance, USD values.", inputSchema: toolSchema(z.object({ address, environment: env }), objectJson({ address: ADDRESS_JSON, environment: ENV_JSON }, ["address"])) }, async ({ address: a, environment }) =>
    text(await services(ctx).flock.snapshot(environmentOf(environment), a as Address)),
  );
  server.registerTool("lykia_scent", { description: "Scent report for a token: registry, proxy, privileges, owner, transfer simulation. Never says safe.", inputSchema: toolSchema(z.object({ token: address, environment: env }), objectJson({ token: ADDRESS_JSON, environment: ENV_JSON }, ["token"])) }, async ({ token, environment }) =>
    text(await services(ctx).scent.sniff(environmentOf(environment), token as Address)),
  );
  server.registerTool(
    "lykia_plan",
    { description: "Plan an intent from a sentence (English or Turkish) for an owner, with the Fence verdict. Returns unsigned steps; the owner signs.", inputSchema: toolSchema(z.object({ sentence: z.string().min(1).max(500), owner: address, environment: env, fence: z.unknown().optional() }), objectJson({ sentence: { type: "string", maxLength: 500 }, owner: ADDRESS_JSON, environment: ENV_JSON, fence: { type: "object", description: "A lykia.fence/v1 document" } }, ["sentence", "owner"])) },
    async ({ sentence, owner, environment, fence }) => {
      const parsed = readSentence(sentence);
      if (parsed.clarify.length > 0 || parsed.actions.length === 0) return text({ clarify: parsed.clarify, reply: parsed.reply });
      const checked = fence === undefined ? undefined : validateFence(fence);
      if (checked && !checked.ok) return text({ error: "Invalid Fence", issues: checked.issues });
      const result = await services(ctx).intents.create({ environment: environmentOf(environment), owner: owner as Address, actions: parsed.actions, source: sentence, ...(checked?.ok ? { fence: checked.fence } : {}), proposedByAgent: true });
      return text(result);
    },
  );
  server.registerTool("lykia_outrun", { description: "Where the money is for a planned intent.", inputSchema: toolSchema(z.object({ intentId: z.string().regex(/^out_[A-Za-z0-9_-]{6,32}$/u) }), objectJson({ intentId: { type: "string" } }, ["intentId"])) }, async ({ intentId }) =>
    text((await services(ctx).intents.get(intentId)).outrun),
  );
  server.registerTool("lykia_fence_evaluate", { description: "Evaluate a Fence against plan facts; returns allow/confirm/deny with reasons and a verdict digest.", inputSchema: toolSchema(z.object({ fence: z.unknown().optional(), facts: z.record(z.string(), z.unknown()) }), objectJson({ fence: { type: "object" }, facts: { type: "object", description: "lykia FenceFacts" } }, ["facts"])) }, async ({ fence, facts }) => {
    const checked = fence === undefined ? null : validateFence(fence);
    if (checked && !checked.ok) return text({ error: "Invalid Fence", issues: checked.issues });
    return text(evaluateFence(checked?.ok ? checked.fence : DEFAULT_FENCE, { now: ctx.clock.now(), ...(facts as object) } as FenceFacts));
  });
  return server;
}

export const mcpModule: ApiModule = {
  name: "mcp",
  register(router, ctx) {
    const handler = createMcpHandler(() => buildMcpServer(ctx), { legacy: "stateless" });
    const serve = async (req: Request, res: Response) => {
      const url = `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
      const init: RequestInit = { method: req.method, headers };
      if (req.method === "POST") init.body = JSON.stringify(req.body ?? {});
      const response = await handler.fetch(new globalThis.Request(url, init), req.method === "POST" ? { parsedBody: req.body } : {});
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.send(Buffer.from(await response.arrayBuffer()));
    };
    router.post("/mcp", ctx.limits.heavy, express.json({ limit: "256kb" }), serve);
    router.get("/mcp", serve);
    router.delete("/mcp", serve);
  },
};
