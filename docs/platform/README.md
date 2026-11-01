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
| Aggregator | `/v1/aggregator`, `/v1/build/*` | Best execution on Arc: quote -> build for every action ([aggregator.md](aggregator.md)). |
| Integrations | `/v1/integrations`, `/v1/contracts/*` | Adapter manifests and any contract call ([integrations.md](integrations.md)). |
| Data | `/v1/data/*`, `/v1/security/screen`, `/v1/tx/explain` | Tokens, prices, protocols, portfolios, screening ([data.md](data.md)). |

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

## The API platform

Start at [overview.md](overview.md) (from a one-line call to enterprise),
then [authentication](authentication.md), [keys and scopes](keys-and-scopes.md),
[idempotency](idempotency.md), [webhooks](webhooks.md), [errors](errors.md),
[rate limits](rate-limits.md), [versioning](versioning.md)
([changelog](changelog.md)), [billing](billing.md), [SDKs](sdks.md) and the
[CLI](cli.md). The reference is `GET /v1/openapi.json` (rendered at
`/v1/reference` and on `/build`, API Reference tab).

See also: [embed-protocol.md](embed-protocol.md) and
[agents.md](agents.md). Runnable examples live in `examples/`.

Developer APIs for money flows: [payouts.md](payouts.md) (batch payouts
with an Arc Memo per row), [invoices.md](invoices.md) (invoices and hosted
payment links), [agents-api.md](agents-api.md) (configure and run agents,
verify verdicts) and [automations.md](automations.md) (one trigger API).
