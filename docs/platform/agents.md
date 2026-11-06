# Agents

Three ways for an AI agent to use Lykia, from no code to full control.

## MCP (no code)

The API serves MCP over streamable HTTP at `/v1/mcp`:

```json
{ "mcpServers": { "lykia": { "type": "http", "url": "https://<api>/v1/mcp", "headers": { "Lykia-Key": "lk_sk_…" } } } }
```

Any MCP client (IDE assistants, desktop chat apps, agent SDKs through their
`mcpServers` option) gets Lykia's read and propose tools. `lykiaMcpServer()` from
`@lykia/agent-tools` returns that object.

## `@lykia/agent-tools`

Nine JSON Schema tools (`plan_intent`, `check_fence`, `scent_token`,
`quote_route`, `flock`, `spawn_agent`, `standing_order`, `place_order`,
`x402_buy`), an executor that calls the API and adapters for the Vercel AI
SDK, LangChainJS, OpenAI function calling and Anthropic tool use. See
`packages/agent-tools/README.md` and `examples/ai-sdk-agent`.

## `@lykia/sdk`

Full control from a server: `lykia.agent.chat()` streams Lyko's turn,
`lykia.pack` manages agents and sub-agents, `lykia.standing` arms standing
orders and `lykia.intents` plans, prepares and submits.

## Rules every path keeps

- Tools read and propose. Nothing signs on the server.
- Every plan is judged by the owner's Fence (and tightened by the project's
  caps when a project key is used).
- An agent can only pay recipients on its Fence's allowlist.
