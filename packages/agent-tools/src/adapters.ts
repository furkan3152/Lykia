/**
 * Adapters for agent frameworks. None of them imports the framework: you
 * pass in the one helper each needs (Vercel AI SDK's `jsonSchema`,
 * LangChain's `tool`), so this package stays dependency-free.
 */
import type { LykiaToolExecutor, ToolResult } from "./executor.js";
import { LYKIA_BUILDER_TOOLS } from "./builderTools.js";
import { LYKIA_FLOW_TOOLS, LYKIA_TOOLS, type JsonSchema, type ToolDefinition, type ToolName } from "./tools.js";

function pick(names?: readonly ToolName[]): readonly ToolDefinition[] {
  return names ? [...LYKIA_TOOLS, ...LYKIA_FLOW_TOOLS, ...LYKIA_BUILDER_TOOLS].filter((t) => names.includes(t.name)) : LYKIA_TOOLS;
}

const asText = (result: ToolResult) => JSON.stringify(result);

/* ------------------------------------------------------ Vercel AI SDK */

/**
 * Tools for `generateText` / `streamText`:
 *
 *   import { jsonSchema } from "ai";
 *   const tools = aiSdkTools(executor, { jsonSchema });
 */
export function aiSdkTools<S>(executor: LykiaToolExecutor, helpers: { readonly jsonSchema: (schema: JsonSchema) => S }, names?: readonly ToolName[]) {
  const out: Record<string, { description: string; parameters: S; inputSchema: S; execute: (args: unknown) => Promise<ToolResult> }> = {};
  for (const t of pick(names)) {
    const schema = helpers.jsonSchema(t.parameters);
    out[t.name] = { description: t.description, parameters: schema, inputSchema: schema, execute: (args) => executor.execute(t.name, args) };
  }
  return out;
}

/* -------------------------------------------------------- LangChainJS */

/**
 * LangChain tools:
 *
 *   import { tool } from "@langchain/core/tools";
 *   const tools = langchainTools(executor, { tool });
 */
export function langchainTools<T>(executor: LykiaToolExecutor, helpers: { readonly tool: (fn: (input: unknown) => Promise<string>, fields: { name: string; description: string; schema: JsonSchema }) => T }, names?: readonly ToolName[]): T[] {
  return pick(names).map((t) => helpers.tool(async (input) => asText(await executor.execute(t.name, input)), { name: t.name, description: t.description, schema: t.parameters }));
}

/* ------------------------------------------------ OpenAI function calling */

export interface OpenAiTool {
  readonly type: "function";
  readonly function: { readonly name: string; readonly description: string; readonly parameters: JsonSchema };
}

export function openaiTools(names?: readonly ToolName[]): OpenAiTool[] {
  return pick(names).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/** Runs one `tool_calls[i]` from a chat completion; returns the `role: "tool"` message to append. */
export async function runOpenAiToolCall(executor: LykiaToolExecutor, call: { readonly id: string; readonly function: { readonly name: string; readonly arguments: string } }) {
  const result = await executor.execute(call.function.name, call.function.arguments);
  return { role: "tool" as const, tool_call_id: call.id, content: asText(result) };
}

/* ------------------------------------------- Anthropic (Claude) tool use */

export interface AnthropicTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JsonSchema;
}

export function anthropicTools(names?: readonly ToolName[]): AnthropicTool[] {
  return pick(names).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

/** Runs one `tool_use` block from a Messages API response; returns the `tool_result` block for the next user turn. */
export async function runAnthropicToolUse(executor: LykiaToolExecutor, block: { readonly id: string; readonly name: string; readonly input: unknown }) {
  const result = await executor.execute(block.name, block.input);
  return { type: "tool_result" as const, tool_use_id: block.id, content: asText(result), ...(result.ok ? {} : { is_error: true }) };
}

/**
 * The zero-code path for the Claude Agent SDK, Claude Code and any MCP
 * client: Lykia's MCP server. Pass the result as `mcpServers`.
 */
export function lykiaMcpServer(options: { readonly baseUrl?: string; readonly apiKey?: string } = {}) {
  const base = (options.baseUrl ?? "https://lykia-api-akdogan1.vercel.app").replace(/\/+$/u, "");
  return { lykia: { type: "http" as const, url: `${base}/v1/mcp`, ...(options.apiKey ? { headers: { "Lykia-Key": options.apiKey } } : {}) } };
}
