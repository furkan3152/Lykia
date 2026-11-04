# Projects (`lykia.project/v1`)

A project is how a third-party app runs Lykia under its own brand. It is
created with a SIWE session (developer role) or a secret key; browser keys
can never manage projects.

## Fields

| Field | Meaning |
|---|---|
| `name` | Up to 64 characters. |
| `brand` | `logoUrl`, `colors` (`primary`, `accent`, `background`, `foreground` as `#rrggbb`), `font`, `scheme` (`light`, `dark`, `auto`), `mosaic` (the tile background), `mascot` (`lyko`, `none`, `custom`), `assistant` (`name`, `avatarUrl`), `radius` (0 to 24). |
| `origins` | Up to 10 exact origins. Each must be proven before browser keys work there. `http://localhost` origins are verified automatically for development. |
| `modules` | `chat`, `send`, `swap`, `earn`, `borrow`, `bridge`, `pack`, `fence`, `scent`, `flock`, `orders`, `ecosystem`. |
| `fence` | `template` (`lamb`, `shepherd`, `treasury`, `caravan`) and `caps` (`perStepUsd`, `perIntentUsd`, `dailyUsd`, `maxSlippageBps`). |
| `network` | `mainnet` or `testnet`: the default for plans made through the project. |
| `fee` | The app fee: `bps` (0 to 50) and `recipient` (the project's address). |
| `webhookUrl` | An https endpoint; register it with `POST /v1/projects/:id/webhook`. |
| `prompt` | Assistant context, up to 1,200 characters after sanitising. |
| `vocabulary` | Up to 40 custom strings (`assistant.greeting`, `swap.cta`, ...). |
| `locale` | For example `en` or `en-GB`. |

## Routes

| Route | |
|---|---|
| `GET /v1/projects` · `POST /v1/projects` | List, create. |
| `GET` · `PATCH` · `DELETE /v1/projects/:id` | Read, partial update, delete (its keys stop working). |
| `GET /v1/projects/:id/public` | What embeds and widgets read: brand, modules, network, Fence caps, the disclosed app fee, custom strings, the assistant name and the verified origins. No owner, webhook or prompt. Cached 60 s. |
| `GET /v1/projects/:id/fence` | The project's default Fence and its hash. |
| `POST /v1/projects/:id/origins/challenge` | The proof for an origin. |
| `POST /v1/projects/:id/origins/verify` | `{ origin, method: "dns" \| "well-known" }`. |
| `GET` · `POST /v1/projects/:id/keys` | Browser keys bound to the project. |
| `GET /v1/projects/:id/usage` | Requests and plans per day, 7 days. |
| `POST /v1/projects/:id/webhook` | Registers `webhookUrl`; the signing secret is shown once. |

## Proving an origin

`POST /v1/projects/:id/origins/challenge` returns one value,
`lykia-verify=<token>`. Publish it either way:

- a DNS TXT record at `_lykia.<hostname>`, or
- a line in `https://<origin>/.well-known/lykia-verify.txt`.

Then call `verify` with the method you used. The token is an HMAC of the
project id and the origin, so it never changes for that pair.

## Browser keys

`POST /v1/projects/:id/keys` issues a publishable key (`lk_pk_…`) with the
`read` and `plan` scopes. At every request the gate checks the request's
`Origin` against the project's verified origins (read live, so a newly
verified origin works at once and a removed one stops at once). CORS
admits verified origins too. Requests through a project key are counted
per project.

Lykia's own `/embed` pages run on Lykia's origin inside your site. They
send `Lykia-Embed-Parent: <your origin>`, and the gate accepts that only
from Lykia's web origin and only for a verified origin of the key's
project.

## What a project changes in a plan

- **Fence.** Without a Fence in the request, the project's template is the
  default. Then the project's caps take the lower value of each cap, and
  the allowed step kinds are cut to the project's modules (approvals always
  pass). `loosenedRules(fence, tightened)` is always empty.
- **Network.** The project's network is the default.
- **App fee.** Each value-moving step pays `feeOf(base, bps)` to the
  project's recipient, on the same basis as Lykia's fee (from the input, on
  top of an exact send, or from a borrowed amount), as a second ERC-20
  transfer in the same batch. Fees above 50 bps or without a recipient are
  ignored. The step's `fee.integrator` records it, and fee lines read
  `Lykia fee 1% · 1 USDC + app fee 0.25% · 0.25 USDC`.
- **Assistant.** The sanitised prompt goes after Lyko's rules inside an
  `app-context` block that says it cannot change rules, the Fence,
  confirmations, Scent checks or the Whistle.
- **Webhook.** Each user who plans through the project is added to the
  project's webhook endpoint, so it receives that user's events.

## Slug and the League

Every project has a unique `slug` (3 to 24 lowercase letters, digits and dashes; `www`, `api`, `app`, `admin`, `letoon`, `mint` and other reserved words are refused). It is set on create (or derived from the name: `acme-pay`, then `acme-pay-2`) and can be changed with `PATCH /v1/projects/:id`. The slug is the project's address as a League city: `/league/:slug` and `<slug>.<root domain>` ([city-domains.md](city-domains.md)). A project can ask for a League listing; see [league.md](league.md).
