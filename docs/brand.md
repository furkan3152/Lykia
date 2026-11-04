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
shepherd's valley and always puts a short plain subtitle beside them, so a
newcomer reads the product and a returning user reads the story ("Flock ·
portfolio"). The navigation lives in `apps/web/src/shell/nav.ts` (see
[product.md](product.md#information-architecture)).

| Word | Meaning | In the UI |
|---|---|---|
| Ask Lyko | The assistant: say the outcome, get a checked plan. | Ask Lyko · assistant |
| Flock | Everything the owner holds on Arc. | Flock · portfolio |
| Pastures | Where stablecoins earn: lending markets and vaults. | Pastures · yields |
| Fence | The rules around an agent or an owner. | Fence · rules |
| Pack | The owner's agents and sub-agents (pups). | Pack · agents |
| Tag | An agent's on-chain identity: its ERC-8004 identity plus the hash of the Fence it follows. | Tag · agent identity |
| Scent | What can be proven about a token before anyone touches it. | Scent · token check |
| Watch | The six security layers between a plan and the wallet. | Watch · security |
| Whistle | The emergency stop: stops every new risk. Moves that bring value home still pass. | Whistle (the kill switch) |
| Herding | Standing instructions: orders, automations, alerts and the activity trail. | Herding · orders and automations |
| Rounds, Barks, Tracks | Automations, alerts and the activity trail. | Rounds · automations, Barks · alerts, Tracks · activity |
| Outrun | The path of a plan, drawn as an arc. | Outrun · plan |
| Fold | Where the money ends up when the plan is done. | "where the money ends up" |
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
