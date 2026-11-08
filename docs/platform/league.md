# The League API

The League lists Lykia's products and approved community apps as **cities**.
Every city is a real [project](projects.md): its listing lives on
`project.league` (`lykia.league/v1`, spec in `packages/core/src/league.ts`).
The official cities (Lykia Pay, Lykia Agents, later Lykia Perps) are being
launched; until they are listed, `GET /v1/league` returns none.

| Field | Values |
|---|---|
| `status` | `official` (set by the Lykia team only) or `community` (asked for by the project's owner) |
| `state` | `live`, `coming` or `paused` |
| `review` | `requested`, `approved`, `rejected` or `delisted` |
| `listed`, `featured` | booleans, set by admins |
| `slug` | the project's slug: `/league/:slug` and `<slug>.<root domain>` |
| `emblem` | `lighthouse`, `temple`, `prow`, `lyre`, `triskeles` or `flame` |
| `tagline`, `category`, `codename`, `note`, `does`, `pages` | what the city page shows |

A project update (`PATCH /v1/projects/:id`) can never set `league`: the
schema refuses the field.

## Public

```
GET /v1/league                    every listed city, in League order
GET /v1/league/:slug              one listed city
GET /v1/league/by-slug/:slug      the same, as city subdomains and /c/:slug load it
GET /v1/league/by-host?host=      a listed city by a verified custom domain
```

Each city is `{ slug, league, project, usage }`: the public listing, the
project's public view (brand, modules, network, Fence caps, fee bps; never
the owner, prompt, webhook or origins) and live usage counts (requests and
plans made with the city's own keys, today and over 7 days).

## Developers

```
POST /v1/projects/:id/league/request   { tagline, category, emblem?, slug?, codename? }
```

A SIWE session with the developer role or a secret key with the `admin`
scope. The listing starts as `requested` and stays unlisted until an admin
approves it. Official cities cannot be requested; a taken or reserved slug
answers 409 or 400.

## Admins (Letoon)

Every admin route checks, on the server, that the caller's SIWE session
address is in `LYKIA_ADMIN_ADDRESSES`. API keys never reach them.

```
PUT  /v1/league/:id          { action, note? }   approve | reject | feature | unfeature | delist | relist | pause | resume | launch
GET  /v1/admin/league        every League entry (requests first) and the seed status
POST /v1/admin/league/seed   create the official cities that are missing
```

Each decision is appended to the platform audit chain (`kind: "league"`). A
**paused** city answers reads only: its keys get `423 CITY_PAUSED` on any
write.

## The seed

The official cities (Lykia Pay, Lykia Agents, and Lykia Perps as `coming`)
are created by an idempotent seed, owned by the first address in
`LYKIA_ADMIN_ADDRESSES`. Each city has a fixed project id, so running it
twice, or on two instances at once, never makes a copy, and a city that
exists is never overwritten (the council's pauses and delistings stand).

Run it from Letoon (League council, "Seed official cities"), or:

```
npm run seed:league -w @lykia/api     # uses the API's .env and database
```
