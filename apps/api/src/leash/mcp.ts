/**
 * MCP for a leashed agent. When /v1/mcp is called with a leash key, the
 * server it gets has only the leash's own tools: status, plan and submit
 * always, trail, venues and Scent when the leash allows them. Nothing that
 * plans for another owner, reads private data or touches another agent.
 * A denial comes back as the tool's result (isError) with the same reason
 * codes and remaining budget the REST route returns.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { protocolsFor, type Address, type Leash, type LeashTool } from "@lykia/core";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { services } from "../services.js";
import { leashService } from "./service.js";
import { toolSchema } from "../modules/mcp.js";

/** The MCP tool name for each leash tool. */
export const LEASH_MCP_TOOLS: Readonly<Record<LeashTool, string>> = {
  status: "leash_status",
  plan: "leash_plan",
  submit: "leash_submit",
  trail: "leash_trail",
  venues: "lykia_venues",
  scent: "lykia_scent",
};

function text(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function refusal(error: unknown) {
  if (error instanceof LykiaHttpError) return text({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, true);
  throw error;
}

export function buildLeashMcpServer(ctx: AppContext, leash: Pick<Leash, "id" | "tools">, version: string): McpServer {
  const server = new McpServer({ name: "lykia-leash", version });
  const s = leashService(ctx);
  const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
  // Every call reloads the leash: a revocation between calls is seen at once.
  const load = () => s.get(leash.id);
  {
    const allowed = new Set(leash.tools);
    if (allowed.has("status"))
      server.registerTool(LEASH_MCP_TOOLS.status, { description: "This leash: what it allows, its budget and what is left (read from the LykiaAccount on Arc), and when it expires.", inputSchema: toolSchema(z.object({}), object({}, [])) }, async () => text(await s.view(await load())));
    if (allowed.has("plan"))
      server.registerTool(
        LEASH_MCP_TOOLS.plan,
        { description: "Plan a move in plain English inside this leash. Inside: the plan and its first step as one unsigned transaction for your session key. Outside: a refusal with reason codes and the budget left.", inputSchema: toolSchema(z.object({ sentence: z.string().min(1).max(500), dryRun: z.boolean().optional() }), object({ sentence: { type: "string", maxLength: 500 }, dryRun: { type: "boolean" } }, ["sentence"])) },
        async ({ sentence, dryRun }: { sentence: string; dryRun?: boolean }) => {
          try {
            return text(await s.plan(await load(), { text: sentence, ...(dryRun ? { dryRun: true } : {}) }));
          } catch (error) {
            return refusal(error);
          }
        },
      );
    if (allowed.has("submit"))
      server.registerTool(
        LEASH_MCP_TOOLS.submit,
        { description: "Report the hash of the step transaction your session key sent. Returns whether it settled, whether the chain proves it, and the next step prepared.", inputSchema: toolSchema(z.object({ intentId: z.string().regex(/^out_[A-Za-z0-9_-]{6,32}$/u), stepId: z.string().regex(/^s\d{1,2}$/u), hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/u) }), object({ intentId: { type: "string" }, stepId: { type: "string" }, hash: { type: "string" } }, ["intentId", "stepId", "hash"])) },
        async ({ intentId, stepId, hash }: { intentId: string; stepId: string; hash: string }) => {
          try {
            return text(await s.submit(await load(), { intentId, stepId, hash: hash.toLowerCase() as `0x${string}` }));
          } catch (error) {
            return refusal(error);
          }
        },
      );
    if (allowed.has("trail")) server.registerTool(LEASH_MCP_TOOLS.trail, { description: "Everything done under this leash, each item marked chain-proven or not.", inputSchema: toolSchema(z.object({}), object({}, [])) }, async () => text(await s.trail(await load())));
    if (allowed.has("venues"))
      server.registerTool(LEASH_MCP_TOOLS.venues, { description: "Venues on Arc and which ones this leash may use.", inputSchema: toolSchema(z.object({}), object({}, [])) }, async () => {
        const l = await load();
        return text(protocolsFor(l.environment).map((p) => ({ id: p.id, name: p.name, category: p.category, executable: EXECUTABLE_VENUES[l.environment].has(p.id), allowedByLeash: l.venues ? l.venues.includes(p.id) || (p.via ? l.venues.includes(p.via) : false) : true })));
      });
    if (allowed.has("scent"))
      server.registerTool(LEASH_MCP_TOOLS.scent, { description: "Scent report for a token on Arc: registry, proxy, privileges, owner, transfer simulation. Never says safe.", inputSchema: toolSchema(z.object({ token: z.string().regex(/^0x[0-9a-fA-F]{40}$/u) }), object({ token: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, ["token"])) }, async ({ token }: { token: string }) =>
        text(await services(ctx).scent.sniff((await load()).environment, token as Address)),
      );
  }
  return server;
}
