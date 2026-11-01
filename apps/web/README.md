# @lykia/web

The Lykia web app: the valley, the deck and every page around it. Vite 6, React 18,
Tailwind 3, wagmi 2 + RainbowKit 2, react-query and zustand. Arc testnet (5042002) is
the default; Arc mainnet (5042) is one switch away and never shares an intent with
testnet.

```sh
npm run dev -w @lykia/web        # http://localhost:5176
npm run build -w @lykia/web      # tsc -b && vite build -> dist/
npm run typecheck -w @lykia/web
npm test -w @lykia/web           # node --test, pure modules only
```

Build-time environment:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3002` | Origin of the Lykia API (origin only, no path). |
| `VITE_WALLETCONNECT_PROJECT_ID` | none | 32-hex Reown project id. Without it WalletConnect is hidden and injected wallets are offered. |

## Pages

| Route | What it is |
|---|---|
| `/` | The valley: the hero scene, the sixty-second story, the four pillars, a builder's teaser. |
| `/app` | The deck. One sentence (English or Turkish) becomes an Outrun: the arc drawing, the Fence verdict with every rule, and each step's Prepare and sign. Follows the intent's event stream. |
| `/app/flock/:address?` | The Flock: wallet, Gateway unified balance and venue positions, totals that never treat unpriced as zero, health factors and a pasture where holdings are sheep sized by value. `?as=0x…` is view-only. |
| `/app/fence` | The Fence editor: templates (Lamb, Shepherd, Treasury, Caravan), every rule as a form field, live validation and hash, loosening warnings, the Whistle, and a try-evaluate playground. Saved in local storage. |
| `/app/scent/:token?` | A token's Scent report: level, the wolves found and every check. Never "safe". |
| `/app/kunye/:agentId?` | Künye: read an ERC-8004 identity on Arc, or draft a new one that pins the current Fence hash and register it from the connected wallet. |
| `/app/outrun/:id` | One Outrun, live. |
| `/developers` | API routes, curl examples, the MCP configuration, the x402 flow and the Arc features Lykia uses. |
| `/flock`, `/fence`, `/scent`, `/kunye`, `/outrun` | Short links that forward to the deck routes. |
| `/lykaion` | Unlisted. |

The Fence validation, hash, loosening check and playground run on `@lykia/core` in the
browser, the same code the API runs, so the editor works with the API offline.

## Lyko and the valley

Everything is drawn on `PixelCanvas` at whole device pixels (`src/pixel`).

- `sprite.ts`: colour grids, outlines, mirroring and `fromArt`, which reads pixel art
  written as text and refuses unknown characters.
- `lyko.ts`: Lyko's 32 x 34 front portrait, built from shapes on the left half,
  mirrored and outlined: a cream coat, black mask and drop ears, amber eyes, a spiked
  collar and a steel tag (the Künye). Side-view frames (run, sit, lie), sheep and wolves.
- `moods.ts`: one drawing per core `LykoMood` (watching, herding, alert, growling,
  proud, resting, sleeping). Lines come from core `LYKO_LINES`.
- `valley.ts`: the Lycian coast on one canvas: sky with a rainbow by day and stars by
  night, the Taurus ridge, a rock tomb, the sea, pines, the flock, the Fence with
  wolves outside it, Lyko, and the Outrun arc from the start post to the Fold.
- `KunyeTag.tsx`: the steel tag with real text stamped over it.

Motion follows the kit's rules: one shared ticker, paused off screen and in hidden tabs,
nothing changes faster than 3 Hz, and reduced motion (the system or the Motion switch)
draws the end state. `public/favicon.svg` is generated from the portrait by
`npx tsx scripts/favicon.ts`.

## The whistle box

`⌘K`, `Ctrl-K` or `/` opens the whistle box (`src/app/shell/WhistleBox.tsx`); the deck's
sentence box accepts the same input. `src/lib/commands.ts` decides what a line is:

- Shepherd commands from core lore: "come bye" re-counts the flock, "away to me"
  re-sniffs tokens, "walk up" prepares the next step (the wallet still signs), "lie down"
  blows the Whistle, "that'll do" releases it, "look back" opens the last Outrun.
- Hidden words from core `EASTER_EGGS`.
- Page names in English and Turkish, a token address (opens Scent), `agent 12`
  (opens a Künye), or a sentence (planned on the deck).

No command moves value.

## Layout

```
src/
  app/        router, route table, shells, keyboard, wallet (Arc chains with USDC as the
              18-decimal native currency), ui preferences
  features/   outrun/ (Outrun card, verdict panel, step runner, intent stream)
  lib/        api client and error envelope, SSE, Arc RPC fallback for the pulse, i18n,
              commands, the local Fence store, contract types
  pixel/      the sprite engine, Lyko, the valley, layout primitives
  ui/         the component kit
  pages/      one folder per route
```

## Honesty rules

- Data that is unavailable says so: the header pulse labels when it reads Arc's public
  RPC directly because the API is unreachable, plans made without a wallet are dry runs,
  unpriced holdings read "unpriced".
- The app never signs. Steps are prepared by the API, signed in the user's wallet and
  submitted as transaction hashes only.
- Lykia's name and marks never use "Arc"; the product is built on Arc Network.
