# Agent over MCP

Lykia speaks the Model Context Protocol at `/v1/mcp` (streamable HTTP). Any
MCP client can use it; this example talks JSON-RPC directly so nothing needs
installing.

```bash
node examples/agent-mcp/index.mjs
```

It initializes a session, lists Lykia's tools, asks `lykia_fence_evaluate`
whether an agent may send 25 USDC to a stranger (no: strangers need the
allowlist) and to the owner (yes), then plans a sentence with `lykia_plan`.
The plan comes back unsigned, with every step's Lykia fee.

To use Lykia from any MCP client (an IDE assistant, a desktop chat app or an agent SDK):

```json
{ "mcpServers": { "lykia": { "url": "https://api.lykiaai.com/v1/mcp" } } }
```

Add `"headers": { "Lykia-Key": "lk_sk_…" }` with a free developer key from
`/mint/keys` for higher limits.
