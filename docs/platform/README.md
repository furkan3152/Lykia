# Building on Lykia

Lykia brings Circle's rails and Arc's features together with its own (the
Fence, Scent, the Pack, the Outrun) and offers them as an interface and as
infrastructure. Any app can add AI-assisted money moves on Arc in its own
brand, or take one part of Lykia and shape it.

| Path | Package | For |
|---|---|---|
| React components | `@lykia/widget` | React apps that want the assistant, send, swap, earn, bridge, the Fence, Scent, the Flock or the Pack in their brand. |
| Headless hooks | `@lykia/widget` (hooks) | Apps that keep their own markup and use Lykia's logic. |
| Web components | `@lykia/embed` | Any page: one script tag, sandboxed frames, DOM events. |
| Agent tools | `@lykia/agent-tools` | AI agents on the Vercel AI SDK, LangChainJS, OpenAI or Anthropic. |
| MCP | the API's `/v1/mcp` | Claude Code, the Claude Agent SDK, Cursor and other MCP clients. No code. |
| SDK | `@lykia/sdk` | Servers and custom clients; modular subpaths and typed events. |
| REST | `/v1` | Everything above is built on it (`/v1/openapi.json`). |

Every path rests on a **project** ([projects.md](projects.md)): the brand,
the origins that may use it, the modules it turns on, a default Fence with
hard caps, the network, the app fee, a webhook, assistant context and
custom strings.

## Three steps

1. Sign in on `/build` with your wallet (SIWE on Arc), become a developer
   and create a project. Add your origin and prove it.
2. Issue a browser key for the project (or a secret key for a server or an
   agent).
3. Pick a path above. `/build` has a quickstart and a live playground for
   each; the playground writes the code for your brand and modules.

## What never changes

- The server never signs. Every plan comes back with its Fence verdict and
  the user's wallet signs each step.
- A project can only tighten a user's Fence, never loosen it.
- Lykia's protocol fee and the app fee are shown before signing and paid in
  the same transaction as the step.
- Prompt additions add tone and context; they cannot change the assistant's
  rules, the Fence, confirmations, Scent checks or the Whistle.

See also: [embed-protocol.md](embed-protocol.md) and
[agents.md](agents.md). Runnable examples live in `examples/`.
