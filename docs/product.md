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
| **Outcomes, not transactions** | A sentence (or a form, or one API call) becomes a route across the protocols Lykia can route through on Arc and Circle's CCTP and Gateway. The route is scored on the net result, simulated on Arc, and sent as one transaction with an Arc Memo. Orders and automations re-plan under the same rules while the owner is away. | Ask Lyko, Flock, Herding |
| **Rules that hold** | The Fence is a typed policy (caps, recipients, protocols, tokens, slippage, health factor, FX band, an emergency stop). It is checked off chain before signing and enforced on chain by the Lykia smart account; it can also be exported as a Circle Agent Wallet spending policy that the owner applies with the Circle CLI. Sub-agents get a Fence inside their parent's. A Tag (ERC-8004 identity) pins the hash of the Fence an agent obeys. | Fence |
| **One engine for every builder** | The planner, router and Fence behind the app are a public REST and SSE API, an MCP server, TypeScript and Python SDKs, a CLI and drop-in components. A protocol becomes routable with one typed adapter. An app built on it can be listed as a city of the League. | The Forge, the League |

The server never holds user keys, and plans come back unsigned. Two optional
server roles sign, each off unless the operator configures it: a gas-only
keeper for due conditional orders, and opt-in Circle developer-controlled
wallets bound to the address that created them (see
[docs/legal/software-notice.md](legal/software-notice.md)).

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
ASK LYKO · your agent        /app                 everything starts here: send, convert, earn, borrow, bridge,
                                                  orders, automations, watches, leashes, agents, Autopilot, the goal
                                                  compiler (a plan: /app/outrun/:id), and the answers that were pages
                                                  (yields, new pools, perps markets)
THE FOLD · everything you own and everything in motion
                             /app/fold/:tab       Flock · holdings, Trails · history, Herding · everything running,
                                                  Pack · your agents and their leashes, Fence · your spending rules (with
                                                  Safety), and Lyko on watch docked beside them
THE FORGE · build             /forge/:section       The Forge · The League · Harbour · Circle · Ledger

Avatar menu   Your Lyko (preferences, voice and look, memory) │ More: Notice and risks │ Team: Letoon (admins only)
Inside areas  a Tag and a token check, reached from the Fold
Redirected    /app/move/:tab → /app?intent=… │ /app/flock → Fold · Flock │ /app/orders, /alerts, /automations → Fold · Herding
              /app/activity → Fold · Trails │ /app/whatif → Fold · Flock (what-if open) │ /app/fence → Fold · Fence
              /app/security → Fold · Fence, at Safety │ /app/pack, /app/pack/:id → Fold · Pack │ /app/memory → Your Lyko
              /app/pastures → Ask "Where can I earn on USDC?" │ /app/discover → Ask "What are the new pools on Arc?"
              /app/markets → Ask "Show me the perps markets"
              A ?draft= link opens Ask Lyko with what the draft said; an ?edit= link asks Lyko to change the item. No form page is left.
Unlisted      /pay/:id (payment links), /kit, /lykaion, 404
Aliases       /build, /developers and /mint/* → /forge/*, /owner → /letoon
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
  ("3 instructions running · 1 order waiting · 2 agents working", counted from Herding) and two buttons:
  Ask Lyko (`/`) and the Whistle.
- **Flock · holdings.** The pasture (holdings as tiles sized by value, grouped
  by venue), a what-if slider on the same shock model the assistant answers
  with (`applyFoldShocks` in `@lykia/core`), and the holdings table, where each
  row offers one assistant action that drafts through the proposal system.
- **Trails · activity.** Settled steps with their Arc Memo, Fence verdict and
  digest and the fee, plans, failed and refused attempts, orders, alerts and
  proposal transitions, with filters, beside a yield and fees explanation the
  server writes as a structured artifact.
- **Herding · everything running.** The Running list: one row for everything
  in motion, whatever engine holds it (automations with who signs, LykiaOrders
  orders, watches with their channels, leashes and Stile, Autopilot and its
  tasks, Pack agents, chat plans in progress, payment links and invoices from
  Pay). Every row shows what it is in one line, its state, what happens next
  and when, and one control (Pause, Resume, Stop, Revoke or Cancel); "Change
  in Ask Lyko" sends anything else to Ask. Above it, the drafts waiting for a
  signature. The Fold bar's counts are computed from this list.
- **Pack · your agents and their leashes.** One card per agent: an outside
  bot's leash (budget meters read from the chain, time left, Revoke) or an
  agent whose leash is its budget on Lykia's side (pause, Revoke), and
  Autopilot (pause, resume, Stop). Nothing is created here: one "Ask Lyko"
  tile starts a new agent or leash, and Ask opens the leash and Autopilot
  sheets as its review step.
- **Fence · your spending rules.** The Fence, kept on the server per owner,
  in plain words; the headroom; one control (the preset Careful, Balanced or
  Bold, which is also Your Lyko's risk profile); the recent refusals with
  their reasons; and Safety: approvals with Revoke, token checks, pauses.
  Tightening applies at once; loosening needs the owner's wallet signature.
  A Fence an older version kept in the browser is proposed once.
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
  The two agents hand each other work on that thread: "Send to Ask Lyko" on
  an actionable insight becomes a staged plan in Ask Lyko marked "From Lyko
  on watch" (the insight then reads "Sent to Ask Lyko · planned", then
  "· signed"), and a watch request in Ask Lyko ("tell me if health drops
  below 1.5") becomes a watch task here, marked "From Ask Lyko", that can be
  paused or removed and raises an insight when it is met.

**Your Lyko** (`/app/you`) is the preferences page the memory never had: risk
profile, liquidity floor, target mix with a band, gas floor, which insights to
show and how to be told, and the Fold's own layout (tabs
and bar cards, shown, hidden and ordered). Each setting says what it changes.
They live on the server (`GET/PUT /v1/me/preferences`); the risk profile is
written through to the profile, so the default Fence follows it everywhere.

The phone shows the three areas as a bottom bar (Ask · Fold · Forge, with
Lyko's badge on the Fold). In the Fold the bar condenses into one card, the
tabs become a chip row, Lyko becomes a tab of its own, drafts open as bottom
sheets and an "Ask Lyko" bar stays within thumb reach. Targets are 44 px or more.

### The League, The Forge and Letoon

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
- **The Forge** (`/forge/:section`). The developer portal as a journey of seven
  stones: Strike (create a city in five steps; the hammer strikes its coin
  on the anvil), Workshop (playground), Your cities (projects, League listing, origins,
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

1. **Hero.** What Lykia is in one line and the three ways in, one click
   each: Ask Lyko, The Fold and The Forge. Below them, the live composer in
   the bay scene.
2. **Where USDC and Circle sit in Lykia.** One USDC through a Lykia step,
   each stone tagged with the Circle, Arc or Lykia primitive it uses, then
   the Circle and Arc integrations beside the router, with links to the live
   status page and the code map (`docs/circle/README.md`).
3. **The problem.** Too many paths, wallets sign anything, no record of the rules.
4. **How it works.** Three steps: say the outcome, Lykia compiles a route, the
   Fence decides and you sign once.
5. **The League.** The cities as coins, with a way in to The Forge.
6. **Proof, not promises.** The flow matrix count (`docs/flows.md`), the
   number of Circle products used, live Arc block time and transfer cost,
   Lykia's three mainnet contracts with explorer links, and the ecosystem
   totals.
7. **For builders.** A quote-and-build call, five entry points (API
   reference, MCP, SDKs, widget and embed, protocol adapters) and the fee.
8. **Beta note.** No paid audit yet, caps for everyone, one developer, MIT,
   not affiliated with Circle or Arc.

## What was merged, demoted or renamed, and why

| Change | Why |
|---|---|
| Move, Orders, Alerts, Automations → **Ask Lyko** (forms survive only as the "edit the details" step of a draft) | If the agent can do something, there is no separate manual page for it. |
| Flock, Activity, What-if, Fence and the standing instructions → tabs of **The Fold** (Flock, Trails, Herding, Pack, Fence; the what-if slider sits in Flock) | One place for what the owner holds, what happened and what is in motion. |
| **Perps markets**, **New pools** and **Pastures** → answers in **Ask Lyko** ("Show me the perps markets", "What are the new pools on Arc?", "Where can I earn on EURC?"); their old addresses open Ask with the question filled in | Read-only data is an answer, not a page. Perps trade on Extended, not on Arc. |
| The form pages (Orders, Alerts, Automations, Fence, Pack) → retired; `?draft=` and `?edit=` links open Ask Lyko | Ask starts things; the leash and Autopilot sheets are kept as the review step Ask opens. |
| **Security** → the **Safety** section of the Fence tab | Approvals, token checks and pauses belong with the rules they guard. |
| Pack agents and leashes → one **Leash** concept; the Pack is "your agents and their leashes" | An agent is what holds a leash. One card per agent, with its leash, budget and Revoke. |
| Autopilot tasks, standing orders, recurring payments and agent automations → **automations**, with who signs | One noun for "something that repeats", whatever engine holds it. |
| Alerts and watch tasks → **Watch**, with channels (in-app, webhook, Telegram) | One noun for "tell me when". |
| The Fence → kept on the server per owner; the preset is the risk profile | One control, in one place; chat no longer takes a Fence from the client. |
| You + Memory → **Your Lyko**, in the avatar menu | One account page instead of two unrelated ones. |
| Build, Circle, Ecosystem and Stats → **The Forge** area, beside the League | This is where a builder or a reviewer looks for integrations and numbers. |
| Owner console → **Letoon**, in the avatar menu for admins only | Only the team uses it; the server checks the role on every call. |
| `DeskTabs` removed; the shell renders the area tabs | One tab component for every area. Pages no longer repeat the navigation. |
| Page headers | The kicker names the area and section. The titles say what the page does ("Check a token before you touch it", not "Let Lyko sniff it"). The medallion is smaller and hidden on phones. |
| ⌘K | It leads with "Jump to" pages. Sheepdog commands sit in a closed "Sheepdog commands" section. The hidden-word counter is gone. The words still work. |
| Empty states | Each says what to do next ("Connect a wallet, or paste any Arc address to read its holdings"), not just a mood. |
| Landing | Rewritten as above. The duplicate ecosystem and Circle sections and the lore card grids were removed. |

## One path per job

Several engines can do the same job. New creations go through one path per
job; the others keep working for records that already exist (readable in the
Running list, and paused, resumed, stopped or cancelled there) and for API
integrators, and are marked deprecated in the API docs.

| Job | Canonical path for new creations | Still readable and controllable |
|---|---|---|
| Limit, stop-loss, take-profit, TWAP and DCA orders | LykiaOrders (`draft_order` in Ask; `POST /v1/orders`) | Autopilot `dca` tasks made before (Autopilot no longer takes new DCA tasks) |
| Something that repeats, you sign each run (scheduled pay, sweep, any sentence on a schedule, price, balance or event) | Unified automations (`draft_automation` in Ask; `POST /v1/automations`) | Standing orders and recurring payments (`/v1/standing`), agent automations (`/v1/agent/automations`) |
| Something that repeats, Autopilot signs (repay, sweep, pay) | Autopilot tasks (`add_autopilot_task` in Ask; `POST /v1/autopilot/tasks`) | |
| A budget for an outside bot | A leash (`create_leash` in Ask, with the Stile option; `POST /v1/leashes`) | |
| An agent on Lykia's side | A Pack agent (`create_agent` in Ask; `POST /v1/pack`): it holds a leash, its own Fence and daily budget | |
| Tell me when | A watch: position conditions (health, LP range, idle cash, APY) go to Lyko on watch (`watch_position`); prices, transfers, token checks and fills, and anything for a webhook or Telegram, go to the alerts engine (`create_alert`; `POST /v1/alerts`) | |

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
2. **New pools (`/app/discover`).** Recommendation: fold it into the token
   check as a "Recently launched" list, then retire the page.
3. **The Arcadia night scene (`/lykaion`) and the design kit (`/kit`).**
   Both are harmless and unlisted. Consider removing `/kit` from production
   builds.
4. **Value routed reads $0** on `/stats`, because there is no real usage yet.
   This is honest, but a first real mainnet flow, signed and linked from the
   landing, would be stronger proof than simulations.
