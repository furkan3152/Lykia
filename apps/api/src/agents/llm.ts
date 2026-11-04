/**
 * The model seam. Lyko and the specialists talk to Claude through this
 * narrow interface, so tests can script a model turn by turn and nothing
 * else in the agents layer imports the SDK. The key comes from
 * ANTHROPIC_API_KEY and is never logged or echoed.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AppContext } from "../context.js";

export type LlmMessage = Anthropic.MessageParam;
export type LlmTool = Anthropic.Tool;
export type LlmResponse = Pick<Anthropic.Message, "content" | "stop_reason">;

export interface LlmRequest {
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly LlmTool[];
  readonly maxTokens: number;
}

export interface LlmClient {
  readonly model: string;
  turn(request: LlmRequest): Promise<LlmResponse>;
}

export function anthropicClient(ctx: AppContext): LlmClient | null {
  const { anthropicApiKey, model } = ctx.config.agent;
  if (!anthropicApiKey || !model) return null;
  const sdk = new Anthropic({ apiKey: anthropicApiKey, maxRetries: 2, timeout: 120_000 });
  return {
    model,
    async turn(request) {
      const response = await sdk.messages.create({
        model,
        max_tokens: request.maxTokens,
        // The system prompt and tool list are stable, so they form a cacheable prefix.
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        tools: request.tools.map((t, i) => (i === request.tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t)),
        messages: [...request.messages],
      });
      return { content: response.content, stop_reason: response.stop_reason };
    },
  };
}

export function textOf(response: LlmResponse): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function toolCallsOf(response: LlmResponse): Anthropic.ToolUseBlock[] {
  return response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
}
