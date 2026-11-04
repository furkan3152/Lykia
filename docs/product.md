# Product: the story, the structure and what was cut

This page explains what Lykia is for and how the app is laid out. Every
visible surface should serve the story below. If a page does not serve it,
it moves to a secondary place or comes out.

## The story in one sentence

> **Lykia is the policy layer for money that agents and apps move on Arc:**
> say the outcome, Lykia compiles it into a route across Arc protocols and
> Circle rails, the Fence checks that every step stays inside your rules,
> and the same engine is an API for every builder.

The problem it solves: Arc gives agents and apps programmable dollars.
There are already many places to send those dollars: exchanges, lending
markets, vaults, CCTP, Gateway and StableFX. A wallet or an agent key signs
whatever it is handed. Spending caps alone cannot judge a health factor, a
slippage limit or a look-alike token. And after the fact, nobody can show
which rules an agent was held to.

## Three pillars

| Pillar | What it means | Where it lives |
|---|---|---|
| **Outcomes, not transactions** | A sentence (or a form, or one API call) becomes a route across every capable Arc protocol and Circle rail. The route is scored on the net result, simulated on Arc, and sent as one transaction with an Arc Memo. Orders and automations re-plan under the same rules while the owner is away. | Ask, Portfolio, Automate |
| **Rules that hold** | The Fence is a typed policy (caps, recipients, protocols, tokens, slippage, health factor, FX band, an emergency stop). It is checked off chain before signing, compiled into a Circle Agent Wallet policy, and enforced on chain by the Lykia smart account. Sub-agents get a Fence inside their parent's. A Tag (ERC-8004 identity) pins the hash of the Fence an agent obeys. | Rules |
| **One engine for every builder** | The planner, router and Fence behind the app are a public REST and SSE API, an MCP server, TypeScript and Python SDKs, a CLI and drop-in components. A protocol becomes routable with one typed adapter. | Build |

Non-custodial throughout: the server never holds keys and never signs.

## Information architecture

### Before

The header had seven top-level items, which wrapped onto two rows on a phone:

```
ASK LYKO · MOVE · FLOCK · DESK · PACK · FENCE · BUILD      + avatar menu
  DESK  = Orders · Markets · Discover · Alerts · Automations · Activity · What-if
  FLOCK = Flock (+ Pastures in the avatar menu)
  FENCE = Fence (+ Scent, Security reachable only by link)
  avatar menu = You · Memory · Circle · Pastures · Owner
  footer = Ecosystem · Pastures · Scent · Tag · Stats · Owner · legal
```

Other problems:

- **Lore names in the main labels.** Flock, Pack, Desk, Scent, Pastures and
  Outrun. A reviewer had to learn the metaphor before the product.
- **No place for some pages.** Security, Stats, Ecosystem, Circle and Move's
  sibling pages were reached in different ways from different places.
- **A seven-tab "Desk".** Trading data (perps markets, new pools) sat next
  to the user's own orders and alerts.
- **Easter eggs in the ⌘K box.** The box led with sheepdog commands and "N
  hidden words live in the valley" instead of pages.
- **A landing page that repeated itself.** The ecosystem appeared twice and
  the Circle products appeared twice. Two card grids restated the same
  features in lore terms. There was no problem statement and no link to the
  mainnet proof.

### After

Five primary areas, each with a short tab row under the header. Everything
lives in `apps/web/src/shell/nav.ts` and is tested in
`apps/web/src/shell/__tests__/nav.test.ts`. The test checks: at most five
areas, every route placed exactly once, plain labels, and every link resolving
to its page.

```
ASK        Ask                                     /app  (a plan: /app/outrun/:id)
PORTFOLIO  Holdings · Move · Yields · What-if      /app/flock, /app/move, /app/pastures, /app/whatif
RULES      Fence · Agents · Tags · Token check · Security
                                                   /app/fence, /app/pack, /app/tag, /app/scent, /app/security
AUTOMATE   Orders · Automations · Alerts · Activity
                                                   /app/orders, /app/automations, /app/alerts, /app/activity
BUILD      Developers · Ecosystem · Circle · Stats /build, /ecosystem, /app/circle, /stats

Avatar menu   Settings · Memory (their own tab row) │ More: Perps markets · New pools · Owner console · Notice and risks
Footer        Product (the five areas) │ Proof (stats, ecosystem, mainnet flows, self-review, source) │ More
Unlisted      /pay/:id (payment links), /kit, /lykaion, 404
```

No URL changed, so existing links, SDK docs and bookmarks keep working.

### The landing, top to bottom

1. **Hero.** The sentence above, three calls to action (open the app, build
   with the API, see the proof) and the live composer in the bay scene.
2. **The problem.** Too many paths, wallets sign anything, no record of the rules.
3. **How it works.** Three steps: say the outcome, Lykia compiles a route, the
   Fence decides and you sign once.
4. **The three pillars.** Each one links to the area that carries it.
5. **Proof, not promises.** The flow matrix count (`docs/flows.md`), the
   number of Circle products used, live Arc block time and transfer cost,
   Lykia's three mainnet contracts with explorer links, and the ecosystem
   totals.
6. **Better together with Circle.** Which Circle product each feature uses,
   with a link to the live status page.
7. **For builders.** A quote-and-build call, five entry points (API
   reference, MCP, SDKs, widget and embed, protocol adapters) and the fee.
8. **Beta note.** No paid audit yet, caps for everyone, one developer, MIT,
   not affiliated with Circle or Arc.

## What was merged, demoted or renamed, and why

| Change | Why |
|---|---|
| Desk split: Orders, Automations, Alerts and Activity → **Automate**; What-if → **Portfolio** | These are the user's own standing instructions and their record. What-if is a question about holdings. |
| **Perps markets** and **New pools** → More | Read-only market data. Useful, but neither moves money under a Fence. Perps trade on Extended, not on Arc. |
| Flock + Move + Pastures → **Portfolio** (Holdings, Move, Yields) | One place for "what I have and moving it". |
| Fence + Pack + Tag + Scent + Security → **Rules** | All of these define or enforce what may happen. Security was only reachable by link before. |
| You + Memory → **Settings** with a Memory tab, in the avatar menu | One account area instead of two unrelated pages. |
| Circle, Ecosystem and Stats → **Build** | This is where a builder or a reviewer looks for integrations and numbers. |
| Owner console → More and the footer | Only the owner uses it. |
| `DeskTabs` removed; the shell renders the area tabs | One tab component for every area. Pages no longer repeat the navigation. |
| Page headers | The kicker names the area and section ("RULES · FENCE"). The titles say what the page does ("Check a token before you touch it", not "Let Lyko sniff it"). The medallion is smaller and hidden on phones. |
| ⌘K | It leads with "Jump to" pages. Sheepdog commands sit in a closed "Shepherd commands" section. The hidden-word counter is gone. The words still work. |
| Empty states | Each says what to do next ("Connect a wallet, or paste any Arc address to read its holdings"), not just a mood. |
| Landing | Rewritten as above. The duplicate ecosystem and Circle sections and the lore card grids were removed. |

### Vocabulary

| Term | Decision | In the UI |
|---|---|---|
| Fence | **Keep.** It is the product's core idea, and it is explained on first use ("your spending rules"). | Fence |
| Tag | **Keep.** Short, and it maps to ERC-8004 identity. | Tags |
| Lyko | **Keep** as the friendly assistant and mascot. | Ask, the medallion |
| Flock | Replaced by a plain word. | Portfolio, Holdings |
| Pastures | Replaced. | Yields (the picture keeps its pens) |
| Pack, pups | Replaced. "Pups" is mentioned once in the page intro. | Agents, sub-agents |
| Scent | Replaced. "Lyko calls it the Scent" is mentioned once. | Token check |
| Outrun | Replaced. | Plan |
| Desk | Removed. | Automate |
| Whistle | Kept in the Fence editor and explained: "the emergency stop". | Whistle (emergency stop) |
| Fold | Not shown in navigation. | "where the money ends up" |

API paths, SDK names and core types (`scent`, `pack`, `whistle`, `outrun`)
are unchanged. They are part of the public API.

## Gimmicks and lore

The sheepdog commands, hidden words (`lykaion`, `arcadia`, `chimaera`, ...),
the Konami code, the Arcadia night scene, Lycian Way waypoint names and
mascot moods all stay in the code. None of them appears in the navigation or
on the path to a core task. You find them only by typing them.

## Decisions for the owner

These need a call that is bigger than a navigation change:

1. **Perps markets (`/app/markets`).** This is read-only data from Extended,
   and trading happens off Arc. Recommendation: remove it from the app and
   keep the API route. It does not serve the story and invites "is this a
   trading app?" questions.
2. **New pools (`/app/discover`).** Recommendation: fold it into Token check
   as a "Recently launched" list, then retire the page.
3. **What-if (`/app/whatif`).** This is a client-side stress test. It is fine
   in Portfolio, but it could become a card on Holdings instead of a page.
4. **Rename URLs to match labels** (`/app/flock` → `/app/portfolio`,
   `/app/pack` → `/app/agents`, `/app/scent` → `/app/check`). This needs
   redirects and SDK and doc updates. The labels already changed, so this is
   cosmetic.
5. **Memory as its own page.** It could become a section of Settings and
   lose its route.
6. **The Arcadia night scene (`/lykaion`) and the design kit (`/kit`).**
   Both are harmless and unlisted. Consider removing `/kit` from production
   builds.
7. **`docs/circle.md` and `docs/circle/README.md` overlap.** Merge them into
   one page under `docs/circle/`. The Circle integration work owns that
   folder.
8. **Sister-product mentions** (Kletia, Elyia) in `docs/brand.md`. Remove
   them from public docs if the reviewer audience should see Lykia on its own.
9. **Value routed reads $0** on `/stats`, because there is no real usage yet.
   This is honest, but a first real mainnet flow, signed and linked from the
   landing, would be stronger proof than simulations.
