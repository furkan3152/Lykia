# @lykia/widget

Lykia inside any React app, built on Arc Network: drop-in components and
headless hooks for the assistant, send, swap, earn, bridge, the Fence,
Scent, the Flock, the Pack and the Outrun. They take your project's brand
and modules, sign with the wallet your app already has, and render on the
server.

```sh
npm install @lykia/widget
```

```tsx
import { LykiaProvider, LykiaChat, Swap } from "@lykia/widget";

<LykiaProvider project="prj_…" apiKey="lk_pk_…" wagmiConfig={config}>
  <LykiaChat />
  <Swap />
</LykiaProvider>
```

## Setup

1. Create a project on Lykia's `/build` page, add your origin and prove it
   (DNS TXT or `/.well-known/lykia-verify.txt`).
2. Issue a browser key (`lk_pk_…`). It only works from the project's
   verified origins and only plans and reads; it never moves money.
3. Wrap your components in `LykiaProvider`.

## Components

| Component | Module | What it does |
|---|---|---|
| `LykiaChat` | chat | The assistant, under Lyko's name or yours, with proposals. |
| `Send` | send | Pay an address in USDC or EURC. |
| `Swap` | swap | StableFX for USDC/EURC, the best AMM route otherwise. |
| `Earn` | earn | A vetted vault within the Fence's risk tier. |
| `Bridge` | bridge | USDC to another chain with Circle CCTP. |
| `Fence` | fence | Templates, caps and every rule an edit would loosen. |
| `Scent` | scent | What can be proven about a token. |
| `Flock` | flock | Everything the owner holds on Arc. |
| `Pack` | pack | The owner's agents and their Tags. |
| `Outrun` | (always) | The path of a plan, drawn as an arc. |

A component whose module the project turned off renders a short notice
instead. Every plan shows Lykia's fee and your app fee before signing.

## Hooks

`useLykiaPlan`, `useLykiaChat`, `useFence`, `useScent`, `useFlock`,
`usePack`, `useOutrun`. Each wraps a framework-free controller
(`createPlanController`, `createChatController`, ...), exported too.

```tsx
const plan = useLykiaPlan();
await plan.plan({ text: "send 25 USDC to 0x…" });
await plan.run(); // prepare, sign and submit every step
```

## Wallets

`LykiaProvider` accepts a viem `walletClient`, any EIP-1193 `provider` or a
wagmi `wagmiConfig`. Without one it discovers an injected wallet (EIP-6963,
then `window.ethereum`) when the user acts. It switches to Arc before
sending.

## Theming

The project's brand becomes CSS variables (`--lykia-primary`,
`--lykia-radius`, ...) on each component's root, and every style rule is
scoped under `[data-lykia]`. Override with the `theme` prop or the
variables in your CSS. `brand`, `modules`, `assistantName` and
`vocabulary` props work without a project.

## Tree-shaking and SSR

Import from subpaths to keep bundles small: `@lykia/widget/swap`,
`@lykia/widget/hooks`, `@lykia/widget/theme`, `@lykia/widget/wallet`.
Nothing touches `window` during render, so Next.js, Remix and other SSR
frameworks render the components on the server.

MIT licensed.
