# Lykia examples

Three small programs that use the live Lykia API on Arc mainnet. None of them
moves money unless you give it a key and tell it to.

| Example | What it shows |
|---|---|
| [`agent-mcp`](agent-mcp) | An agent talks to Lykia over MCP: lists the tools, checks a move against a Fence, plans a sentence. |
| [`sdk-node`](sdk-node) | The full loop with `@lykia/sdk` and viem: plan with the fee, read the verdict, prepare the calls, simulate them, and sign only when you ask. |
| [`embed`](embed) | The "Routed by Lykia" ecosystem strip on any web page, in two lines of HTML. |

Run them from the repository root after `npm ci` and `npm run build -w @lykia/core -w @lykia/sdk`.
Point them at another API with `LYKIA_API=https://…`.
