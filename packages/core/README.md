# @lykia/core

The zero-I/O spec behind Lykia, built on Arc Network: networks, verified
Circle and Arc contract addresses, the token and venue registry, the intent
graph and its lifecycle, the Fence (`lykia.fence/v1`) and its evaluator,
Tags (ERC-8004), the protocol fee, white-label projects
(`lykia.project/v1`) and the Outrun.

```sh
npm install @lykia/core
```

```ts
import { DEFAULT_FENCE, evaluateFence, projectFence, tightenFence } from "@lykia/core";

// A project's caps and modules only ever tighten a Fence.
const fence = tightenFence(DEFAULT_FENCE, { fence: { caps: { perStepUsd: "100" } }, modules: ["send", "swap"] });
```

Everything here is pure TypeScript with one dependency (`@noble/hashes`),
so it runs in browsers, Node, Deno, Bun and edge runtimes. Subpaths such as
`@lykia/core/api/platform` hold the API's contract types.

MIT licensed.
