# @lykia/agent-tools

Lykia's tools for AI agents, built on Arc Network. JSON Schema definitions,
an executor that calls the Lykia API, and adapters for the Vercel AI SDK,
LangChainJS, OpenAI function calling and Anthropic tool use. No
dependencies.

```sh
npm install @lykia/agent-tools
```

```ts
import { generateText, jsonSchema } from "ai";
import { aiSdkTools, createLykiaExecutor } from "@lykia/agent-tools";

const lykia = createLykiaExecutor({ apiKey: process.env.LYKIA_SECRET_KEY, owner: userAddress, environment: "mainnet" });
const { text } = await generateText({ model, tools: aiSdkTools(lykia, { jsonSchema }), maxSteps: 5, prompt });
```

## Tools

| Tool | What it does |
|---|---|
| `plan_intent` | Plans a sentence; returns steps, fees and the Fence verdict. |
| `check_fence` | Dry-runs a move (or evaluates Fence facts); never stores a plan. |
| `scent_token` | What can be proven about a token. |
| `quote_route` | Every executable venue for a swap, deposit or borrow, and the pick. |
| `flock` | Everything an address holds on Arc. |
| `spawn_agent` | An agent in the Pack, or a sub-agent inside its parent's Fence. |
| `standing_order` | A sentence with a condition or a schedule. |
| `place_order` | Drafts a limit, stop-loss, take-profit, DCA or TWAP order to sign. |
| `x402_buy` | Prepares a pay-per-call purchase checked against the Fence. |

No tool signs. Plans, orders and x402 payments come back for the user's
wallet. Errors come back as data (`{ ok: false, error }`), so the model can
explain them.

## Adapters

```ts
aiSdkTools(lykia, { jsonSchema });                 // Vercel AI SDK
langchainTools(lykia, { tool });                   // @langchain/core/tools
openaiTools();  runOpenAiToolCall(lykia, call);     // OpenAI function calling
anthropicTools(); runAnthropicToolUse(lykia, block); // Anthropic Messages API
```

Pass a list of tool names to any adapter to expose fewer tools, or
`allow` to the executor to restrict what it runs.

## MCP: the zero-code path

Claude Code, the Claude Agent SDK, Cursor and any MCP client can use
Lykia's MCP server directly:

```ts
import { lykiaMcpServer } from "@lykia/agent-tools";
const mcpServers = lykiaMcpServer({ apiKey: process.env.LYKIA_SECRET_KEY });
// { lykia: { type: "http", url: "https://…/v1/mcp", headers: { "Lykia-Key": "…" } } }
```

MIT licensed.
