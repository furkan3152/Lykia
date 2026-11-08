# Lykia examples

Small programs that use Lykia on Arc mainnet. None of them moves money
unless you give it a key and tell it to.

| Example | What it shows |
|---|---|
| [`agent-mcp`](agent-mcp) | An agent talks to Lykia over MCP: lists the tools, checks a move against a Fence, plans a sentence. |
| [`sdk-node`](sdk-node) | The full loop with `@lykia/sdk` and viem: plan with the fee, read the verdict, prepare the calls, simulate them, and sign only when you ask. |
| [`embed`](embed) | The "Routed by Lykia" ecosystem strip on any web page, in two lines of HTML. |
| [`nextjs-widget`](nextjs-widget) | `@lykia/widget` in a Next.js App Router layout: the assistant, send and swap in your brand. Typechecks with plain React. |
| [`html-embed`](html-embed) | `@lykia/embed`: `<lykia-assistant>` and `<lykia-swap>` with one script tag, DOM events and the host page's wallet. |
| [`headless-hooks`](headless-hooks) | Your own markup with `useLykiaPlan` and `useScent`: a payroll button and a token badge. |
| [`ai-sdk-agent`](ai-sdk-agent) | `@lykia/agent-tools` in an agent loop: Scent first, then a plan with its Fence verdict. Runs offline with a scripted model. |
| [`adapter-manifest`](adapter-manifest) | A `lykia.adapter/v1` manifest for an ERC-4626 vault: submit it, validate it on chain, and after review the vault becomes routable without a redeploy. |

Run them from the repository root after `npm ci` and `npm run build:packages`.
`npm run test:examples` checks the five examples that have a `test/` folder offline.
Point them at another API with `LYKIA_API=https://…`.
