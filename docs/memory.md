# Intent memory and the owner profile

Lykia remembers what an owner did, what they prefer and who they pay, so a
short sentence can carry a lot of meaning. It also lets the owner shape
how Lykia decides and speaks. Both are personal: every route acts for the
signed-in owner (SIWE), and nothing is shared between owners.

## What is remembered

- **Intents.** Each stored plan is kept with its sentence, its actions,
  the venues it used, its USD value and, once known, what every step
  actually moved. The outcome follows the plan: planned, settled, failed,
  stopped or denied.
- **Contacts.** These are names for addresses. Manual contacts are the
  owner's own entries. Learned contacts come from settled sends the owner
  signed, and only when the profile allows learning. Changing a contact's
  address resets its trust.
- **Preferences.** These are derived from settled plans: the usual venue
  per step kind, typical amounts, the slippage habit and bridge
  destinations. Each one is a row the owner can delete.
- **Patterns.** Three or more settled sends to the same address on the
  same weekday are offered as a standing order. The offer never arms
  itself.

## What memory understands

| Sentence | What happens |
|---|---|
| "again", "do it again", "repeat that" | The last plan again, with the amounts that actually moved |
| "same as last week", "same as last time" | The plan from about a week ago |
| "undo the last swap", "reverse the deposit" | A fresh plan of the inverse at today's prices. Sends and bridges cannot be undone, and Lykia says so. |
| "more than last time" | Asks how much more (+10%, +25%, +50%), then scales the plan |
| "pay Ahmet 200 EURC", "send Ahmet's wallet 5 USDC" | Fills in the contact's address. A possessive ("Ahmet's") works too. |
| "my usual vault", "as usual" | Uses the venue the owner usually picks |

The Fence still judges every plan. A learned contact without a confirmed
send makes the plan ask the owner to confirm it. Lyko's model receives a
short summary of the memory, labelled as data about the owner's past and
not as instructions.

## Privacy

- `GET /v1/memory/export` returns everything remembered as JSON.
- `DELETE /v1/memory/:id` forgets one intent, contact or preference.
- `POST /v1/memory/forget` forgets intents, contacts or everything.
- The profile sets how long memory is kept: `retentionDays` (1 to 730).
  Turning memory off stops anything new from being remembered.

## The profile (`lykia.profile/v1`)

| Field | Effect |
|---|---|
| `language`, `persona.tone`, `persona.verbosity` | How Lyko speaks (Turkish, English or auto; friendly, concise, formal or playful). |
| `displayCurrency` | USD, EUR or TRY for display. Plans still settle in tokens. TRY uses a fresh Pyth USD/TRY price when Arc carries one, otherwise ECB reference rates (display only, not tradable). |
| `defaultNetwork`, `theme` | Starting network and day or night mode. |
| `risk` | Low, medium or high. Sets the default Fence shape (slippage ceiling; low also requires verified tokens) and the routing risk ceiling. |
| `defaultSlippageBps` | The slippage habit. It can only lower the Fence's ceiling. |
| `venues.favorites`, `venues.blocked` | Favourites win near-ties (within 5 bps on swaps, within 0.5 APY points on yield). Blocked venues are never chosen and join the Fence's deny list. |
| `confirmation` | `always` asks for every plan; `above` asks above an amount; `fence` leaves it to the Fence. It never loosens a Fence. |
| `quietHours`, `notifications`, `widgets` | No non-urgent notices in the window; webhook and Telegram; the order of dashboard widgets. |
| `look` | Lyko's collar colour, coat and name tag in the web app. |
| `gas.sponsorship` | Whether to prefer Gas Station sponsorship on Circle agent wallets. |
| `explainLikeNew` | Plan reasons in plain words. |
| `memory` | Turns memory on or off, sets retention, and controls whether contacts are learned. |

The web app keeps a flat version of the same profile on the device.
`PUT /v1/profile` accepts that flat shape as well, and `GET /v1/profile`
returns it next to the core document.
