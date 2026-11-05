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

The product language is English. The interface leads with metaphors from the
shepherd's valley and pairs each with a short plain word, so a newcomer reads
the product and a returning user reads the story ("Flock · portfolio"). Page
titles, tabs and menus show the pair. The three top-level tiles (Ask Lyko,
The Fold, The Mint) show only the name and a small hand-drawn pixel icon (Lyko's
head, a sheepfold, a struck coin); their plain word rides in the tooltip and the
accessible name. The navigation lives in `apps/web/src/shell/nav.ts` (see
[product.md](product.md#information-architecture)).

Lyko's voice in chat: the verdict first, in one short, confident line; then at
most three facts with numbers; then one next step. No greeting, no filler.

| Word | Meaning | In the UI |
|---|---|---|
| Ask Lyko | Your agent: say the outcome, get a checked plan. Every action happens here. | Ask Lyko · your agent |
| The Fold | Everything the owner holds and everything in motion, with Lyko on watch beside it. | The Fold · everything you own and everything in motion |
| Lyko on watch | The portfolio assistant docked in the Fold: it proposes, you sign. | Lyko on watch · proposes, you sign |
| Your Lyko | How Lyko decides, speaks and remembers for the owner. | Your Lyko · preferences and memory |
| Flock | Everything the owner holds on Arc (a tab of the Fold). | Flock · holdings |
| Pastures | Where stablecoins earn: lending markets and vaults. | Pastures · yields |
| Fence | The rules around an agent or an owner. | Fence · rules |
| Pack | The owner's agents and sub-agents (pups). | Pack · agents |
| Tag | An agent's on-chain identity: its ERC-8004 identity plus the hash of the Fence it follows. | Tag · agent identity |
| Scent | What can be proven about a token before anyone touches it. | Scent · token check |
| Watch | The six security layers between a plan and the wallet. | Watch · security |
| Whistle | The emergency stop: stops every new risk. Moves that bring value home still pass. | Whistle (the kill switch) |
| Herding | Every standing instruction, and the drafts waiting for a signature (a tab of the Fold). | Herding · instructions |
| Trails | The timeline of everything that happened (a tab of the Fold). | Trails · activity |
| Rounds, Barks | Automations and alerts, as Herding labels them. | Rounds · automations, Barks · alerts |
| Outrun | The path of a plan, drawn as an arc. | Outrun · plan |
| The Mint | The developer portal, where builders strike projects. | The Mint · build |
| League | Lykia's products and approved community apps, shown together. | The League · Lykia's cities |
| City | One product of the League: a real project with its own brand, modules and Fence caps. | "city" |
| Coin | A city's card: the League's shared face (Lyko) and the city's emblem on the reverse. Gold is live, silver is coming, bronze is paused. | the coin |
| Letoon | The Lykia team's console (admins only). Named after the sanctuary of Leto, where the league met. | Letoon · team console |
| Harbour, Ledger | The ecosystem of Arc protocols, and Lykia in numbers. | Harbour · ecosystem, Ledger · stats |

API paths, SDK names and core types (`scent`, `pack`, `whistle`, `outrun`)
are part of the public API and do not change with the labels.

The interface is English only. The deterministic reader understands English
sentences; with the model on, Lyko replies in the language the user writes in.

## The League

Each city of the League is a real project built in The Mint, with a Lycian
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

## Arc Network brand rules

Arc's brand guidelines do not allow "Arc" in a product name, logo, app icon or
brand system. Lykia follows these rules:

- Lykia's name and logo never contain "Arc".
- Use "Built on Arc Network" or "available on Arc". Write "Arc Network" the
  first time and "Arc" after that.
- Use the Arc logo only from the latest Circle Brand Kit files, and only where
  the guidelines allow it.
