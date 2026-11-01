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

The interface is English only; people may still type to Lyko in Turkish.

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
- Wolves outside the fence are Scent threats.
- The Patara lighthouse blinks on every Arc block the pulse stream reports.
- Pups are sub-agents.
- Market stalls are Circle products.
- Carved tablets are memories.

## Pages

| Route | Page |
|---|---|
| `/` | The bay, with the Ask Lyko composer and the story. Asking a question morphs the composer into the conversation. |
| `/app`, `/app/ask/:threadId` | Ask Lyko: a thread rail and an SSE conversation (reading, tool, task, proposal, clarify and text events). The route artifact holds the outrun scene, the Fence seal, "why this route" and signing each step in the wallet. Memory chips and `@contact` completion. |
| `/app/flock/:address?` | The pasture across mainnet and testnet, holdings, the Gateway card, Circle and insights with one-tap proposals. |
| `/app/pastures` | Live yields as pens, with risk tier and source. |
| `/app/pack/:id?` | The kennel, the agent tree, spawn-a-pup with per-field Fence violations, bones for budgets, cascading revoke, the on-chain session and a Circle agent wallet. |
| `/app/fence` | The fence editor: posts are caps and gates are allowed venues. It shows loosening warnings, and the Whistle turns the scene to night. |
| `/app/scent/:token?`, `/app/tag/:id?`, `/app/outrun/:id` | Scent (with Circle compliance), Tag, and a full outrun. |
| `/app/you` | Personalization, including Lyko's look with a live preview that repaints the whole app. |
| `/app/memory` | Lyko remembers: timeline, learned preferences, contacts, patterns, export and forget. |
| `/app/circle` | The harbor market of Circle products and the Gateway transfer flow. |
| `/build`, `/owner` | The developer portal (SIWE, keys, webhooks, fee, playground, MCP, SDK, Circle) and the owner console (each contract created straight from your wallet, so explorers show it as the creator; checked and recorded). |
| `/kit`, `/lykaion`, 404 | Every component and scene, the hidden Arcadia night, and Lyko sniffing for a trail. |

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
