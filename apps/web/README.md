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
| `VITE_CIRCLE_CLIENT_URL` | Circle Modular Wallets client URL (https). The app appends `/arc` or `/arcTestnet` per network. |

## Connecting

The connect modal offers two ways in, with no WalletConnect or QR codes:

- **Passkey wallet**: a Circle smart account on Arc owned by a device passkey (Face ID, Touch ID, Windows Hello). The SDK loads only when someone opens it. Plan steps go out as one user operation through Circle's bundler and are submitted to the API by user operation hash; sign-in uses the smart account's ERC-1271 signature.
- **Browser wallet**: wallets announced through EIP-6963 (MetaMask, Rabby, OKX, Coinbase Wallet and others) with their own icons, falling back to `window.ethereum`. Switching to Arc adds the chain (USDC as the native currency) when the wallet does not know it.

The interface is English only. With the model on, Lyko replies in the language the user writes in.

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

The navigation lives in `src/shell/nav.ts` (tested in `src/shell/__tests__/nav.test.ts`): five primary areas, each a short tab row, plus the account pages and a short "More" list. The full reasoning is in [docs/product.md](../../docs/product.md). URLs did not change when the labels did.

| Area | Tabs (route) |
|---|---|
| **Ask** | Ask (`/app`, `/app/ask/:threadId`): a thread rail and an SSE conversation; the route artifact holds the plan, the Fence seal, "why this route" and signing. A full plan opens at `/app/outrun/:id`. |
| **Portfolio** | Holdings (`/app/flock/:address?`), Move (`/app/move/:tab?`: send, receive, swap, earn, borrow, bridge without a sentence), Yields (`/app/pastures`), What-if (`/app/whatif`). |
| **Rules** | Fence (`/app/fence`), Agents (`/app/pack/:id?`), Tags (`/app/tag/:id?`), Token check (`/app/scent/:token?`), Security (`/app/security`). |
| **Automate** | Orders (`/app/orders`), Automations (`/app/automations`), Alerts (`/app/alerts`), Activity (`/app/activity`). |
| **Build** | Developers (`/build`, also `/developers`), Ecosystem (`/ecosystem`), Circle (`/app/circle`), Stats (`/stats`). |

Secondary: Settings (`/app/you`) and Memory (`/app/memory`) in the avatar menu, with their own tab row; More: Perps markets (`/app/markets`), New pools (`/app/discover`), Owner console (`/owner`), Notice and risks (`/legal/:doc?`). Unlisted on purpose: payment links (`/pay/:id`), the design kit (`/kit`), the hidden night scene (`/lykaion`) and the 404.

The landing (`/`) tells the story for builders and reviewers: the problem, how it works in three steps, the three pillars, live mainnet proof (contracts, the flow matrix, live Arc stats), the Circle products used, developer entry points and the beta note. Asking a question in its composer morphs into the conversation.

## Motion

- **Shared-element morph.** Submitting a question on the landing page commits the route inside a View Transition. The composer grows into the chat dock, the bay folds into the scene strip with a tile-out, and the first message lands as the first bubble.
- **Scenes.** Scenes assemble stone by stone. Lyko blinks, trots and sniffs. Sheep graze, grass grows when rates load, and wolves slink.
- **Other motion.** Meander bands flow. Seals stamp in. Toasts tile in. The lamp in the strip flashes on each block.
- **Limits.** Everything uses transforms or a small canvas tick, stops off screen, and is disabled under reduced motion or with the Motion switch off.

## Honesty rules

- Unpriced amounts read "unpriced", never zero. Rates are read, never promised.
- Without a wallet, Ask Lyko plans dry runs for a sample address and says so.
- Endpoints that are still being built show "coming soon". Missing credentials show "needs a key".
- The server never signs. Every value-moving step is signed in the owner's wallet.
