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
| **Outcomes, not transactions** | A sentence (or a form, or one API call) becomes a route across every capable Arc protocol and Circle rail. The route is scored on the net result, simulated on Arc, and sent as one transaction with an Arc Memo. Orders and automations re-plan under the same rules while the owner is away. | Ask Lyko, Flock, Herding |
| **Rules that hold** | The Fence is a typed policy (caps, recipients, protocols, tokens, slippage, health factor, FX band, an emergency stop). It is checked off chain before signing, compiled into a Circle Agent Wallet policy, and enforced on chain by the Lykia smart account. Sub-agents get a Fence inside their parent's. A Tag (ERC-8004 identity) pins the hash of the Fence an agent obeys. | Fence |
| **One engine for every builder** | The planner, router and Fence behind the app are a public REST and SSE API, an MCP server, TypeScript and Python SDKs, a CLI and drop-in components. A protocol becomes routable with one typed adapter. Every app built on it is a city of the League. | The Mint, the League |

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

Three primary areas. If the agent can do something, there is no separate
manual page for it: people come to Lykia so they do not have to do it by
hand. Each label is a metaphor with a plain subtitle; the top menu draws the
three areas as Mosaic tiles with a pixel icon and the name, and keeps the
subtitle in the tooltip and the accessible name. Everything lives in
`apps/web/src/shell/nav.ts` and is tested in
`apps/web/src/shell/__tests__/nav.test.ts`: exactly three areas, every route
placed exactly once, no manual page for agent work in any menu, and every old
address redirecting.

```
ASK LYKO · your agent        /app                 every action: send, convert, earn, borrow, bridge,
                                                  orders, automations, the goal compiler (a plan: /app/outrun/:id)
THE FOLD · everything you own and everything in motion
                             /app/fold/:tab       Flock · holdings, Trails · activity, Herding · instructions,
                                                  Pack · agents, Fence · rules, and Lyko on watch docked beside them
THE MINT · build             /mint/:section       The Mint · The League · Harbour · Circle · Ledger

Avatar menu   Your Lyko (preferences, voice and look, memory) │ More: Perps markets · New pools · Notice and risks │ Team: Letoon (admins only)
Inside areas  an agent (/app/pack/:id), a Tag, a token check, the watch and the yields, reached from the Fold
Redirected    /app/move/:tab → /app?intent=… │ /app/flock → Fold · Flock │ /app/orders, /alerts, /automations → Fold · Herding
              /app/activity → Fold · Trails │ /app/whatif → Fold · Flock (what-if open) │ /app/fence → Fold · Fence │ /app/memory → Your Lyko
              A ?draft= or ?edit= link still opens the old form: it is the "edit the details" step of something Lyko drafted.
Unlisted      /pay/:id (payment links), /kit, /lykaion, 404
Aliases       /build and /developers → /mint, /owner → /letoon
City mode     <slug>.<root domain>, /c/<slug>, ?city=<slug> or a verified custom domain: the city's own shell
```

Ask Lyko's quick-action tiles ("Pay someone", "Put idle USDC to work", "Hedge
into EUR", "Set a rule", "New agent") drop an intent into the composer; they
never open a form and never send on their own.

### The Fold

A two-column workspace: the Fold bar and five tabs on the left (keys 1 to
5), **Lyko on watch** docked on the right.

- **Fold bar.** Net worth with rolling digits (only changed digits roll), the
  allocation as a strip of tesserae by venue type, today's Fence headroom
  (spent against the Fence's daily cap and the beta cap), one line of counts
  ("3 rules running · 1 order waiting · 2 agents working") and two buttons:
  Ask Lyko (`/`) and the Whistle.
- **Flock · holdings.** The pasture (holdings as tiles sized by value, grouped
  by venue), a what-if slider on the same shock model the assistant answers
  with (`applyFoldShocks` in `@lykia/core`), and the holdings table, where each
  row offers one assistant action that drafts through the proposal system.
- **Trails · activity.** Settled steps with their Arc Memo, Fence verdict and
  digest and the fee, plans, failed and refused attempts, orders, alerts and
  proposal transitions, with filters, beside a yield and fees explanation the
  server writes as a structured artifact.
- **Herding · instructions.** One list of every standing instruction
  (automations, standing orders and recurring payments, alerts, agent
  automations, LykiaOrders orders) with status, next run, last result and the
  expected Fence verdict, pause and resume, and edit via Lyko. Above it, the
  drafts waiting for a signature: what automations and insights produce lands
  here instead of vanishing.
- **Pack · agents.** Budget meters, Tags, what each agent may do and a Whistle
  per agent. New agents are made by asking Lyko.
- **Fence · rules.** The Fence in plain words, the headroom, the recent
  refusals with their reasons, and Fence edits Lyko proposes. Tightening
  applies at once; loosening needs the owner's wallet signature.
- **Lyko on watch.** Its first message comes from server-side, deterministic
  insights (`GET /v1/fold/insights/:address`, also the Lyko tool
  `get_insights`): each has a title, a plain explanation, the figures behind a
  "Why?", a severity and an optional one-tap draft. Drafts go through the
  proposal store (`/v1/fold/proposals`, lifecycle proposed → approved → done or
  stopped, a 30-day feed, an audit entry for each move), and an insight acted
  on is marked handled until its condition changes. The chat is the same server
  thread as Ask Lyko; follow-up chips are answered from live reads and written
  to that thread; "Open in Ask Lyko" carries the insight as context. A short
  "new since" brief appears when something changed since the last visit.

**Your Lyko** (`/app/you`) is the preferences page the memory never had: risk
profile, liquidity floor, target mix with a band, gas floor, which insights to
show and how to be told, the reply language and the Fold's own layout (tabs
and bar cards, shown, hidden and ordered). Each setting says what it changes.
They live on the server (`GET/PUT /v1/me/preferences`); the risk profile is
written through to the profile, so the default Fence follows it everywhere.

The phone shows the three areas as a bottom bar (Ask · Fold · Mint, with
Lyko's badge on the Fold). In the Fold the bar condenses into one card, the
tabs become a chip row, Lyko becomes a tab of its own, drafts open as bottom
sheets and an "Ask Lyko" bar stays within thumb reach. Targets are 44 px or more.

### The League, The Mint and Letoon

- **The League** (`/league`, `/league/:city`). Lykia's products are the cities
  of a league, each a real project (`project.league`, `GET /v1/league`). A
  city is a mosaic coin: struck stone by stone, Lyko on the shared face, the
  city's emblem on the reverse (gold live, silver coming, bronze paused). The
  coast scene lights one harbour per live city. A city page says what it
  does, how it uses Lykia (modules, Fence caps, pages), its live status and
  usage, and renders the city itself from its project, with the embed code.
  Official cities: Lykia Pay (Patara), Lykia Agents (Xanthos), and Lykia
  Perps (Phaselis, coming: orders would match on Extended's engine off Arc,
  collateral on Arc, Lykia never holds funds or keys). Developers ask for a
  community listing; the team approves it in Letoon.
- **City shells.** On its own host each city runs a task-first app on the
  same engine and Mosaic stones, in its project's accent, with a small "a
  Lykia city" mark: Pay is a payments app (balance, request a payment with a
  link and QR share sheet, pay someone, recent invoices and payouts, Ask
  Lyko), Agents shows the owner's agents with budget meters, Tags, a New
  agent flow, decisions and the Whistle, and Perps is a coming landing. See
  [platform/city-domains.md](platform/city-domains.md).
- **The Mint** (`/mint/:section`). The developer portal as a journey of seven
  stones: Strike (create a city in five steps; the press strikes its coin),
  Workshop (playground), Your cities (projects, League listing, origins,
  keys, usage), Keys (and the fee), Usage & logs, Webhooks, Reference (API,
  SDK, MCP, parser, protocol integration, Circle, Arc tools).
- **Letoon** (`/letoon/:section`). The team console, for addresses in
  `LYKIA_ADMIN_ADDRESSES` only. The page asks the API (`GET /v1/admin/league`)
  and opens its temple door only on a yes; everyone else sees the closed door
  with Lyko on watch and no admin data. Sections: League council, Contracts
  (deploy plan, recorded, router venues), Flags and the Whistle (routing.halt
  through the audited path, per-city pause), Circle setup, Audit log, Usage.
  Every action is enforced again on the server.

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
7. **The League.** The cities as coins, with a way in to The Mint.
8. **For builders.** A quote-and-build call, five entry points (API
   reference, MCP, SDKs, widget and embed, protocol adapters) and the fee.
9. **Beta note.** No paid audit yet, caps for everyone, one developer, MIT,
   not affiliated with Circle or Arc.

## What was merged, demoted or renamed, and why

| Change | Why |
|---|---|
| Desk split: Orders, Automations, Alerts and Activity → **Automate**; What-if → **Portfolio** | These are the user's own standing instructions and their record. What-if is a question about holdings. |
| **Perps markets** and **New pools** → More | Read-only market data. Useful, but neither moves money under a Fence. Perps trade on Extended, not on Arc. |
| Flock + Move + Pastures → **Portfolio** (Holdings, Move, Yields) | One place for "what I have and moving it". |
| Fence + Pack + Tag + Scent + Security → **Rules** | All of these define or enforce what may happen. Security was only reachable by link before. |
| You + Memory → **Settings** with a Memory tab, in the avatar menu | One account area instead of two unrelated pages. |
| Circle, Ecosystem and Stats → **Build** (now The Mint, beside the League) | This is where a builder or a reviewer looks for integrations and numbers. |
| Owner console → **Letoon**, in the avatar menu for admins only | Only the team uses it; the server checks the role on every call. |
| `DeskTabs` removed; the shell renders the area tabs | One tab component for every area. Pages no longer repeat the navigation. |
| Page headers | The kicker names the area and section ("RULES · FENCE"). The titles say what the page does ("Check a token before you touch it", not "Let Lyko sniff it"). The medallion is smaller and hidden on phones. |
| ⌘K | It leads with "Jump to" pages. Sheepdog commands sit in a closed "Shepherd commands" section. The hidden-word counter is gone. The words still work. |
| Empty states | Each says what to do next ("Connect a wallet, or paste any Arc address to read its holdings"), not just a mood. |
| Landing | Rewritten as above. The duplicate ecosystem and Circle sections and the lore card grids were removed. |

### Vocabulary

An earlier pass replaced the lore names in navigation with plain labels.
They are back as the primary labels, because they fit the interface's
style, and each one now carries a plain subtitle so nobody has to learn the
metaphor first. The full table is in [brand.md](brand.md#vocabulary).

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
8. **Value routed reads $0** on `/stats`, because there is no real usage yet.
   This is honest, but a first real mainnet flow, signed and linked from the
   landing, would be stronger proof than simulations.
