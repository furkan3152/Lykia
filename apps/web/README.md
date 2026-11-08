# @lykia/web

The Lykia web app: Vite 6, React 18, Tailwind 3 (layout utilities only), wagmi 2 (browser wallets), Circle Modular Wallets (passkey smart accounts) and react-query. It is built on **Mosaic**, Lykia's own design system: pixels are tesserae. Every surface is laid from the same stones: a limestone floor, meander bands between sections, one stone frame for every card and scene, and data-driven mosaic scenes.

```sh
npm run dev -w @lykia/web        # http://localhost:5176
npm run build -w @lykia/web      # tsc -b && vite build -> dist/
npm run typecheck -w @lykia/web
npm test -w @lykia/web           # node --test, pure modules only
```

Build-time environment (all public values, never secrets):

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Origin of the Lykia API (default `http://localhost:3002`). |
| `VITE_CIRCLE_CLIENT_KEY` | Circle Modular Wallets client key (from console.circle.com, Modular Wallets). Passkey wallets are hidden without it. |
| `VITE_LYKIA_ROOT_DOMAIN` | The domain League cities run under as `<slug>.<domain>` (`lykiaai.com` in production). `/c/<slug>` works without it. |
| `VITE_CIRCLE_CLIENT_URL` | Circle Modular Wallets client URL (https). The app appends `/arc` or `/arcTestnet` per network. |

## Connecting

The connect modal offers two ways in, with no WalletConnect or QR codes:

- **Passkey wallet**: a Circle smart account on Arc owned by a device passkey (Face ID, Touch ID, Windows Hello). The SDK loads only when someone opens it. Plan steps go out as one user operation through Circle's bundler and are submitted to the API by user operation hash; sign-in uses the smart account's ERC-1271 signature.
- **Browser wallet**: wallets announced through EIP-6963 (MetaMask, Rabby, OKX, Coinbase Wallet and others) with their own icons, falling back to `window.ethereum`. Switching to Arc adds the chain (USDC as the native currency) when the wallet does not know it.

The interface is English only. Lyko always replies in English and understands requests written in any language.

## Mosaic

| Path | What it holds |
|---|---|
| `src/mosaic/tessera.ts` | The renderer: a logical grid of colours laid as stones, each with its own grout and a deterministic tone jitter, plus the "assemble" reveal where stones drop in by a diagonal wave. Pure, so it can be tested. |
| `src/mosaic/sprites.ts` | Lyko (face, sitting, trotting, sniffing, lying), pups, sheep and wolves as text art. Face moods are watching, happy, alert, growling, proud, resting, sleeping and herding. The live palette follows the owner's look (collar, coat, tag). |
| `src/mosaic/scenes/` | Scene builders, all data-driven: `bay` (home), `strip` (the chat header), `pasture` (Flock), `pastures` (yields), `kennel` (Pack), `fenceScene`, `sniff` (Scent), `harbor` (Outrun), `archive` (Memory), `market` (Circle) and `arcadia`. Each one takes data and a time and returns a buffer, so the same input always draws the same picture. |
| `src/mosaic/MosaicCanvas.tsx` | Paints a scene. It is DPR-aware and animates only while the scene is on screen, the tab is visible and motion is allowed. |
| `src/mosaic/textures.ts` | Generates the floor, meander, wave and frame textures at boot, using the same renderer, as CSS variables. |
| `src/mosaic/ui.tsx` | Components: Frame, Card, MeanderBand, PageHead, Medallion (CAVE CANEM), Button, Tag, Seal, Stat, Skeleton, Field, Input, Select, Toggle, Tabs, Sprite, LykoFace, LykoTile, PupIcon, EmptyState and Modal. Toasts are small mosaic tiles. |
| `src/styles/mosaic.css` | Tokens, components, chat layout, the shared-element morph and the motion rules. |

Data becomes landscape:

- Grass height in a pen is the venue's yield.
- Wool colour is the token.
- Islands are CCTP chains.
- Wolves outside the fence are bad tokens the token check (Scent) catches.
- The Patara lighthouse blinks on every Arc block the pulse stream reports.
- Pups are sub-agents.
- Market stalls are Circle products.
- Carved tablets are memories.

## Pages

The navigation lives in `src/shell/nav.ts` (tested in `src/shell/__tests__/nav.test.ts`): three primary areas, each a metaphor with a plain subtitle ("The Fold · everything you own and everything in motion"), plus Your Lyko in the avatar menu, a short "More" list and, for admins only, Letoon. If the agent can do something, there is no separate manual page for it. The reasoning is in [docs/product.md](../../docs/product.md#information-architecture) and the vocabulary in [docs/brand.md](../../docs/brand.md).

| Area | What it holds (route) |
|---|---|
| **Ask Lyko** · your agent | Every action: send, convert, earn, borrow, bridge, orders and automations (`/app`, `/app/ask/:threadId`); a full plan opens at `/app/outrun/:id`. |
| **The Fold** · everything you own and everything in motion | Flock · holdings (with the what-if slider), Trails · activity, Herding · instructions, Pack · agents and Fence · rules (`/app/fold/:tab`), with Lyko on watch docked beside them. Detail pages reached from it: an agent (`/app/pack/:id`), a Tag (`/app/tag/:id`), a token check (`/app/scent/:token`), Watch · security (`/app/security`) and Pastures · yields (`/app/pastures`). |
| **The Mint** · build | The Mint (`/mint/:section`: strike, workshop, cities, keys, usage, webhooks, reference), The League (`/league`, `/league/:city`), Harbour · ecosystem (`/ecosystem`), Circle (`/app/circle`), Ledger · stats (`/stats`). |

Account: Your Lyko (`/app/you`: preferences, voice and look, memory). More: Perps markets, New pools, Notice and risks. Team: Letoon (`/letoon/:section`, admins only, the server decides). Old addresses redirect (`src/app/routes/aliases.ts`): `/app/move` to Ask Lyko with the intent filled in, `/app/flock` and `/app/whatif` to Flock, `/app/orders`, `/app/alerts` and `/app/automations` to Herding, `/app/activity` to Trails, `/app/fence` to Fence, `/app/memory` to Your Lyko, `/build` (with its old tab names as hashes) and `/developers` to `/mint`, and `/owner` to `/letoon`. Unlisted on purpose: payment links (`/pay/:id`), the design kit (`/kit`), the night scene (`/lykaion`) and the 404.

### The League, The Mint and Letoon

| Path | What it holds |
|---|---|
| `src/features/league/art.ts` | Pure buffers: the struck coin (obverse: Lyko as the League's shared face; reverse: the city's emblem; gold, silver or bronze by state), the Lycian coast with a lit harbour per live city, the Letoon's temple door and The Mint's press. |
| `src/features/league/Coin.tsx` | A coin struck stone by stone that turns over (CSS 3D) to its emblem; hover, focus or tap turns it back. Reduced motion shows the emblem at once. |
| `src/pages/league/` | The League (coast scene, coins, a swipeable carousel on phones) and a city page (what it does, how it uses Lykia, live status, the city rendered from its project, embed code). |
| `src/pages/mint/` | The Mint: seven sections, the five-step Strike with the press, the League listing card on each project. |
| `src/pages/letoon/`, `src/features/letoon/` | Letoon: the door, the League council, contracts, flags and the Whistle, Circle setup, audit log, usage. |

### City mode

`src/city/detect.ts` decides at boot whether the page is a League city: `<slug>.<VITE_LYKIA_ROOT_DOMAIN>`, `/c/<slug>`, `?city=<slug>`, or a verified custom domain. A city boots `src/city/CityApp.tsx` instead of the router and renders its own shell on the same engine: `PayShell` (Lykia Pay), `AgentsShell` (Lykia Agents), `ComingShell` (coming cities) or `GenericShell` (community cities). Shells are mobile first: a pinned bottom tab bar with pixel icons, bottom sheets, a sticky primary action in the thumb zone and safe-area insets. Setup: [docs/platform/city-domains.md](../../docs/platform/city-domains.md).

The landing (`/`) tells the story for builders and reviewers: the problem, how it works in three steps, the three pillars, the League's coins, live mainnet proof, the Circle products used, developer entry points and the beta note.

## Motion

- **Shared-element morph.** Submitting a question on the landing page commits the route inside a View Transition. The composer grows into the chat dock, the bay folds into the scene strip with a tile-out, and the first message lands as the first bubble.
- **Scenes.** Scenes assemble stone by stone. Lyko blinks, trots and sniffs. Sheep graze, grass grows when rates load, and wolves slink.
- **Other motion.** Meander bands flow. Seals stamp in. Toasts tile in. The lamp in the strip flashes on each block.
- **Limits.** Everything uses transforms or a small canvas tick, stops off screen, and is disabled under reduced motion or with the Motion switch off.

## Honesty rules

- Unpriced amounts read "unpriced", never zero. Rates are read, never promised.
- Without a wallet, Ask Lyko plans dry runs for a sample address and says so.
- Endpoints that are still being built show "coming soon". Missing credentials show "needs a key".
- The server never holds user keys. Every value-moving step the app plans is signed in the owner's wallet.
