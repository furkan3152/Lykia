# Lykia brand notes

## Name

**Lykia** comes from Lycia, the ancient league of cities on the south-west
coast of Anatolia. The Lycian Way, a long-distance trail between its ruined
cities, runs through it. Historically the Lycian League was a federation
of those cities that struck one shared coinage, and that is how Lykia's own
products are shown: as the cities of a league (see "The League" below).

Lykia focuses on agents and stablecoins on Arc Network, and it uses
everything Arc and Circle offer.

## Mascot

**Lyko** is a big Anatolian shepherd dog: a cream or fawn coat, a black
mask, a curled tail and a spiked collar with a small metal Tag. The name comes from the Greek *lykos*, "wolf". He is a wolf-looking
dog whose job is to keep the wolves away.

The flock is the agents and the owner's assets. The wolves are scam tokens,
rug pulls and exploits. Lyko keeps the flock inside the Fence and the wolves
outside it. That one sentence covers both Scent and the Fence.

## Vocabulary

The interface speaks English, Turkish, Spanish, Brazilian Portuguese,
Simplified Chinese and French (the picker in the top bar; each language has one
glossary in `apps/web/src/i18n/glossary/`). Brand names stay as they are in
every language: Lykia, Lyko, Ask Lyko, The Fold, The Forge, the Fence, Leash,
Whistle, Stile, Autopilot, Herding, Flock, Trails, Pack and the League; their
subtitles are translated. The interface leads with metaphors from the
shepherd's valley and pairs each with a short plain word, so a newcomer reads
the product and a returning user reads the story ("Flock · holdings"). Page
titles, tabs and menus show the pair. The three top-level tiles (Ask Lyko,
The Fold, The Forge) show only the name and a small hand-drawn pixel icon (Lyko's
head, a sheepfold, an anvil); their plain word rides in the tooltip and the
accessible name. The navigation lives in `apps/web/src/shell/nav.ts` (see
[product.md](product.md#information-architecture)).

Lyko's voice in chat: the verdict first, in one short, confident line; then at
most three facts with numbers; then one next step. No greeting, no filler.

One noun per idea, and two places with one rule: **Ask Lyko** starts things,
**The Fold** shows and manages them, **The Forge** is for developers. Anything
started in Ask is one row in the Fold's Running list (Herding), and can be
paused, stopped or cancelled there; changing it goes back to Ask.

| Word | Meaning | In the UI |
|---|---|---|
| Ask Lyko | Your agent: say the outcome, get a checked plan. Everything starts here: plans, automations, orders, watches, leashes, agents and Autopilot. | Ask Lyko · your agent |
| The Fold | Everything the owner holds and everything in motion, with Lyko on watch beside it. | The Fold · everything you own and everything in motion |
| Lyko on watch | The portfolio assistant docked in the Fold: it reads, explains and hands you to Ask. "Lyko on watch" is the assistant; "Watches" are the things it keeps an eye on. | Lyko on watch |
| Your Lyko | How Lyko decides, speaks and remembers for the owner. | Your Lyko · preferences and memory |
| Flock | Everything the owner holds on Arc (a tab of the Fold). | Flock · holdings |
| Fence | The owner's rules, kept on the server: one per owner. The word "rules" is reserved for it. Its preset (Careful, Balanced or Bold) is the same control as Your Lyko's risk profile. | Fence · your spending rules |
| Safety | Approvals, token checks and pauses, as a section of the Fence tab. | Safety |
| Pack | The owner's agents and the leashes they hold: one card per agent. | Pack · your agents and their leashes |
| Leash | A budget an agent cannot go past: per step, per day and in total, until a date. An agent is what holds a leash; a Pack agent and an outside bot's leash are the same idea. | Leash · a budget for a bot |
| Automation | Something that repeats or fires on a trigger, with who signs: "You sign each time" or "Autopilot signs". Standing orders, recurring payments, agent automations and Autopilot tasks are all automations. | Automation |
| Watch | Something Lykia keeps an eye on and tells you about, in-app, by webhook or on Telegram. Alerts and watch tasks are both watches. | Watch |
| Autopilot | Lyko signs your own automations inside a leash on your own LykiaAccount. | Autopilot · Lyko signs for you |
| Tag | An agent's on-chain identity: its ERC-8004 identity plus the hash of the Fence it follows. | Tag · agent identity |
| Scent | What can be proven about a token before anyone touches it. | Scent · token check |
| Whistle | The emergency stop: stops every new risk. Moves that bring value home still pass. | Whistle (the kill switch) |
| Herding | Everything in motion, one row each (the Running list), and the drafts waiting for a signature (a tab of the Fold). Its rows are "instructions". | Herding · everything running |
| Trails | The timeline of everything that happened (a tab of the Fold). | Trails · activity |
| Outrun | The path of a plan, drawn as an arc. | Outrun · plan |
| The Forge | The developer portal, where builders strike projects. | The Forge · build |
| League | Lykia's products and approved community apps, shown together. | The League · Lykia's cities |
| City | One product of the League: a real project with its own brand, modules and Fence caps. | "city" |
| Coin | A city's card: the League's shared face (Lyko) and the city's emblem on the reverse. Gold is live, silver is coming, bronze is paused. | the coin |
| Letoon | The Lykia team's console (admins only). Named after the sanctuary of Leto, where the league met. | Letoon · team console |
| Harbour, Ledger | The ecosystem of Arc protocols, and Lykia in numbers. | Harbour · ecosystem, Ledger · stats |

API paths, SDK names and core types (`scent`, `pack`, `whistle`, `outrun`,
`alerts`, `automations`, `standing`) are part of the public API and do not
change with the labels.

Words that are gone from the interface: Rounds and Barks (they are
automations and watches), Pastures (yields are an answer in Ask Lyko),
"Watch · security" (Safety is a section of the Fence tab), Shepherd as a
Fence name (the presets are Careful, Balanced and Bold; the developer
template key `shepherd` stays in the API as the Balanced default).

Languages are never mixed. The interface, every sentence code writes (desk
answers, questions and options, preflight findings, Fence reasons, step
summaries, insights, errors) and Lyko's own answers all follow the language
the owner picked, whatever language the owner writes in. The model reads any
language and is told which one to answer in; the deterministic reader reads
plain requests in all six languages. Numbers, money and dates are written the
way the language writes them.

## The League

Each city of the League is a real project built in The Forge, with a Lycian
city as a small codename on its coin, never in place of the product name.

| City | Codename | Emblem | Why |
|---|---|---|---|
| Lykia Pay | Patara | Lighthouse | Patara's lighthouse guided every ship into the harbour: Pay guides every payment to its recipient. |
| Lykia Agents | Xanthos | Temple | Xanthos was the capital where the League's work was done: Agents is where your agents do theirs. |
| Lykia Perps (coming) | Phaselis | Prow | Phaselis traded through three harbours with ports beyond the coast, while its goods were counted at home: orders would match off Arc, the collateral stays on Arc. |

Community cities choose an emblem from the same set (lighthouse, temple,
prow, lyre, triskeles, flame); the triskeles was the Lycian League's own mark.

## Easter eggs

They never appear in navigation or on the way to a core task; you find them
by typing them.

- **Sheepdog commands.** These are real commands: "come bye", "away to me",
  "walk up", "lie down", "that'll do" and "look back".
- **Hidden words.** *lykaion* and *arcadia* open the Arcadia night scene
  (Mount Lykaion is the sacred mountain of Arcadia). *chimaera* shows the
  eternal flames of the Chimaera on Mount Olympos, *guardian* shows Lyko's
  pose and *patara* shows the lighthouse.
- **Waypoints.** Outrun waypoints are named after the ancient cities of
  Lycia, in order: Telmessos, Pinara, Sidyma, Xanthos and so on.

## Visual grammar

Every element shows its role at a glance. Six kinds, the same everywhere
(Ask Lyko, the review modal, the Fold's rows and the landing):

| Kind | What it looks like | Where |
| --- | --- | --- |
| **Primary action** | One per screen. Terra fill, 52px tall (full width on phones), a hard pixel shadow that presses down on tap, a key or seal pixel icon, and one short line under it when money is involved ("Opens your wallet to sign · nothing moves before"). Class `m-btn m-btn--hero`. | "Review and sign" on a plan, "Sign" in the review modal, "Ask Lyko" on the landing. |
| **Secondary** | Outline: cream with a navy inset border (`m-btn--ghost`, `m-mini`). Never terra-filled next to a primary. | Back, Stop here, Watch this position, a preflight fix, the Fold's row actions. |
| **Choice / answer tiles** | Lyko's question waits for the owner: Lyko's face beside a speech tessera with a terra border and a tail, the label "LYKO ASKS", and the options as big tiles (48px, a navy border, an arrow, hover turns navy, press moves down). "Or type your own answer below" points at the composer, whose placeholder becomes "Answer Lyko…". The bubble glows once on arrival (not under reduced motion). | Clarify questions in Ask and in Lyko on watch. |
| **Links** | Underlined sea-ink text (`m-linkbtn`), no box. | Open the route, Learn more, Why?. |
| **Informational cards** | Quieter: cream, a thin border, no arrows, no buttons of their own unless they act. At most one small label above the title, and only when the title does not already say it. Sources are a small stamp, not a kicker. | Facts, sources, balances, positions, notes. |
| **Warnings** | One line with an ochre edge (a block is terra), the plain reason and at most the fixes as secondary tiles. One warning per card. | Preflight on a plan, the review modal, a Fold row at risk. |

The Fence verdict on a plan is a small badge beside the title, not a rotated
stamp. Text stays only if a newcomer needs it to act or to stay safe; the
rest moves behind one "How this works" per area.

## Arc Network brand rules

Arc's brand guidelines do not allow "Arc" in a product name, logo, app icon or
brand system. Lykia follows these rules:

- Lykia's name and logo never contain "Arc".
- Use "Built on Arc Network" or "available on Arc". Write "Arc Network" the
  first time and "Arc" after that.
- Use the Arc logo only from the latest Circle Brand Kit files, and only where
  the guidelines allow it.
