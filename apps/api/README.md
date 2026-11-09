# @lykia/api

The Lykia API: one Express 5 service for Arc Network. It reads the chain (pulse, the Flock, Scent), plans intents with live quotes and evaluates them against the owner's Fence, hands out unsigned transactions carrying Arc Memos, verifies submitted hashes against Arc receipts, drafts Tag (ERC-8004) identities, and serves Lyko, an MCP endpoint and x402 paid routes.

The server never holds user keys. Every value-moving transaction is signed in the owner's (or the agent's) own wallet. Two optional server roles do sign, each off unless the operator configures it: the gas-only keeper (`LYKIA_KEEPER_PRIVATE_KEY`), which executes due conditional orders already signed by their owners, and Circle developer-controlled wallets (`LYKIA_CIRCLE_SERVER_WALLETS=true`), which the server signs for with the operator's entity secret.

## Run

```sh
npm run build -w @lykia/core          # the API imports @lykia/core from its dist
cp apps/api/.env.example apps/api/.env  # optional: every variable has a default
npm run dev -w @lykia/api               # tsx watch on http://localhost:3002
```

| script | what it does |
|---|---|
| `npm run typecheck -w @lykia/api` | `tsc --noEmit` |
| `npm test -w @lykia/api` | `node --test` over `src/**/__tests__/*.test.ts` (fake chain, no network) |
| `npm run smoke -w @lykia/api` | read-only live checks against Arc mainnet and testnet and Circle's public APIs |
| `npm run build -w @lykia/api` then `npm start -w @lykia/api` | compiled `dist/` |

Postgres store tests run only when `LYKIA_TEST_DATABASE_URL` points at a throwaway database.

## Environment

All variables are optional; see [`.env.example`](./.env.example).

| variable | default | purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` turns on the production checks: exact https CORS origins only, and sign-in refuses to run without `LYKIA_SESSION_SECRET` |
| `PORT`, `HOST` | `3002`, `0.0.0.0` | listen address |
| `LYKIA_MODE` | `testnet` | default Arc environment when a request does not name one |
| `LYKIA_WEB_ORIGIN` | (none) | extra CORS origins; localhost dev origins are allowed outside production |
| `LYKIA_ROOT_DOMAIN` | (none) | the domain League cities run under as subdomains (`<slug>.lykiaai.com` in production); see [docs/platform/city-domains.md](../../docs/platform/city-domains.md) |
| `LYKIA_DATABASE_URL` | (none) | Postgres for intents, hash claims, Tag cards, spend counters and x402 nonces; in-memory without it. `DATABASE_URL` and `POSTGRES_URL` are read as fallbacks |
| `ARC_MAINNET_RPC_URL`, `ARC_TESTNET_RPC_URL` | (none) | extra RPC endpoints, tried before `rpc.mainnet.arc.io` / `rpc.testnet.arc.io` |
| `ANTHROPIC_API_KEY`, `LYKIA_AGENT_MODEL` | (none), (none) | the model path for Lyko and the specialists, with Lykia's tools. Both are required for it: there is no default model id. Without them the deterministic reader answers |
| `LYKIA_AGENT_MAX_STEPS`, `LYKIA_AGENT_MAX_TOKENS` | `6`, `4096` | model rounds per agent per turn, output tokens per call |
| `LYKIA_MODEL_DAILY_CALLS` | `2000` | global cap on model calls per UTC day, counted in the shared store; past it every caller falls back to the deterministic reader until the day turns (`0` keeps the model off) |
| `LYKIA_RATE_LIMIT_SHARED` | `20` | per-IP requests per minute on `/v1/agent/chat` and `/v1/ai/*`, counted in the shared store so the limit holds across serverless instances |
| `LYKIA_SESSION_SECRET` | (none) | 32+ characters; signs sessions and derives the keys that hash API keys and seal webhook secrets. Development uses a per-process secret when it is unset; production refuses sign-in without it |
| `LYKIA_SIWE_DOMAINS`, `LYKIA_ADMIN_ADDRESSES` | (none) | extra sign-in domains (host[:port]); addresses with the admin role |
| `CIRCLE_API_KEY` | (none) | Circle platform key: Compliance Engine screening, developer-controlled wallets, StableFX (when the key has access) |
| `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID` | (none) | entity secret (32 bytes hex, registered with Circle) for developer-controlled wallets; an existing wallet set to reuse |
| `LYKIA_CIRCLE_SERVER_WALLETS` | (off) | `true` opts this server in to creating Circle developer-controlled wallets for signed-in users and executing payouts from them with the entity secret above. Each wallet is bound to the address that created it. Off: those routes answer 403 |
| `STABLEFX_API_KEY` | (none) | a separate StableFX key, if StableFX access sits on its own key |
| `ZEROX_API_KEY` | (none) | 0x Swap API key. Set: 0x (AllowanceHolder) joins swap routing and counts as routable. Unset: 0x stays read-only |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | (none) | the Lyko bot: `/start <code>` links a chat to a signed-in address and alerts arrive there; the token is never logged. Point the bot at the API once with `POST /v1/telegram/setup` (admin) |
| `LYKIA_KEEPER_PRIVATE_KEY` | (none) | optional keeper wallet that executes due conditional orders (it earns the tip and holds only gas). Without it anyone can run orders via `/v1/orders/:hash/execute-tx` |
| `CRON_SECRET` | (none) | Bearer secret for `/cron/standing`, `/cron/orders` and `/cron/alerts` (Vercel Cron, daily each) and for `POST /v1/reconcile/tick` (one full background pass, for an external pinger when schedules must hold more often than daily), the keeper and the alert-check routes; compared in constant time |
| `LYKIA_GUARD_ADDRESS` | (none) | ERC-8354 guard that answers validation requests for Fence verdicts (own key; see docs/tag.md) |
| `LYKIA_X402_PAY_TO`, `LYKIA_X402_PRICE_USDC`, `LYKIA_X402_FACILITATOR_URL` | the fee recipient, `0.01`, Circle's facilitator | x402 paid routes; `PAY_TO=off` disables them. Circle's facilitator settles with `CIRCLE_API_KEY`; without the key the routes keep answering 402. `FACILITATOR_URL=off` runs verify-only |
| `CIRCLE_X402_SELLER_WALLET_ID` | (none) | the Circle developer-controlled EOA wallet that is the x402 `payTo`; it signs the seller proof Circle's facilitator asks for |
| `LYKIA_BETA_CAP_USD` | `1000/5000` | Mainnet beta cap per step / per day per owner, above every Fence while the contracts are unaudited; `off` removes it |
| `LYKIA_RATE_LIMIT_DEFAULT`, `_HEAVY`, `_AUTH` | `600`, `60`, `20` | requests per minute per IP |
| `LYKIA_LOG_LEVEL` | `debug` (development), `info` (production), `warn` (test) | `debug`, `info`, `warn`, `error` or `silent` |
| `LYKIA_TRUST_PROXY` | `1` in production, else `0` | proxy hops in front of the API (0 to 3), for client IPs and rate limits |
| `LYKIA_BUILD_COMMIT`, `RENDER_GIT_COMMIT` | (none) | the build commit, kept in the runtime config (no route reports it); Render sets the second on its own and it wins |
| `LYKIA_FEE_BPS`, `LYKIA_FEE_RECIPIENT` | `100`, `0x8c52…ca1e` | Lykia protocol fee per value-moving step (100 = 1%, at most 300) and the address that receives it; see Protocol fee below |
| `LYKIA_FEE_SCHEDULE`, `LYKIA_FEE_SCHEDULE_PLANS` | (none) | per-kind fees in basis points, and per-plan overrides for API customers; see [docs/fees.md](../../docs/fees.md) |

## Routes

Every failure uses the error envelope `{ "error": { "code", "message", "details"?, "requestId" } }`. Contract types live in `@lykia/core/api/*`.

### System and Arc

| route | answer |
|---|---|
| `GET /health` | static liveness |
| `GET /v1/health` | version, environment, RPC probes per network, store, enabled features |
| `GET /v1/networks` | Arc mainnet (5042) and testnet (5042002) with live probe results |
| `GET /v1/tokens?environment=` | USDC, EURC, USYC, cirBTC with addresses |
| `GET /v1/contracts` | Circle and Arc system contracts (CCTP, Gateway, StableFX, ERC-8004, Memo, Multicall3From) |
| `GET /v1/protocols?environment=` | the venue registry |
| `GET /v1/venues?environment=` | registry rows plus `executable` (this engine has an adapter) and `live`; on testnet also the Lykia practice venues (listed as not deployed until they are) |
| `GET /v1/arc/pulse?environment=` | block, block time, base fee in gwei of USDC, tps, cost of a USDC transfer in USD |
| `GET /v1/arc/pulse/stream` | SSE, event `pulse` |

### The Flock

| route | answer |
|---|---|
| `GET /v1/flock/:address?environment=mainnet\|testnet\|both` | wallet tokens and native USDC (one Multicall3 round trip), Morpho vault positions (`convertToAssets`), Aave V4 supplies and debts, Morpho Blue collateral and debt, Lykia practice positions, health factors per venue, the Circle Gateway unified balance, USD values and their sources; `both` returns mainnet and testnet side by side |
| `GET /v1/flock/:address/stream` | SSE: `snapshot` when anything changed, `unchanged`, `error` |

USD prices: USDC is the unit of account (it is Arc's gas token). EURC and cirBTC are priced from Chainlink EURC/USD and BTC/USD on Arc mainnet, with a staleness limit; a stale or missing feed leaves the holding unpriced (`null`) and the total `null`. USYC is never priced.

### The Fence

| route | answer |
|---|---|
| `GET /v1/fence/templates` | Lamb, Shepherd, Treasury, Caravan with hashes |
| `GET /v1/fence/default` | the Shepherd Fence |
| `POST /v1/fence/validate` | `{ fence, previous? }` -> `{ ok, issues?, hash?, loosened? }` |
| `POST /v1/fence/evaluate` | `{ fence?, facts }` -> `lykia.verdict/v1` |

### Language and intents

| route | answer |
|---|---|
| `POST /v1/language/parse` | `{ text }` -> plan actions, standing orders (conditions and schedules), sheepdog command, hidden word, clarifying questions with suggested answers, reply. English, several clauses per sentence. |
| `POST /v1/intents` | `{ text | actions, owner, environment?, fence?, signer?, agent?, account?, dryRun? }` -> intent graph, Outrun, verdict |
| `GET /v1/intents/:id`, `GET /v1/intents/:id/outrun` | the graph and where the money is |
| `POST /v1/intents/:id/steps/:sid/prepare` | `{ confirm? }` -> unsigned transactions, binding digest, memo |
| `POST /v1/intents/:id/steps/:sid/submit` | `{ hashes }` -> verified against Arc; a matching successful receipt settles a same-chain step |
| `GET /v1/intents/:id/steps/:sid/attestation` | the CCTP attestation once Circle's Iris API reports it complete |
| `POST /v1/intents/:id/stop` | stops every unstarted step |
| `GET /v1/intents/:id/stream` | SSE: `intent`, `outrun` |

Every routed step carries `route`: the chosen venue option, the alternatives it beat and one sentence of reasoning. The routing rules, the amount semantics across clauses and the engine calls other layers use (`compileGoals`, `planActions`, `quoteVenues`) are documented in [src/engine/README.md](src/engine/README.md).

### Routes and Circle rails

| route | answer |
|---|---|
| `POST /v1/quote` | `{ kind: "swap" \| "earn" \| "borrow", … }` -> every live venue's option, priced the same way (output after gas, live APY with its source, borrow rate and projected health factor), and the engine's pick with its reason |
| `GET /v1/rates?environment=` | live vault APYs and market rates (Morpho API) and Aave V4 reserve rates (Aave API), labelled; empty on testnet |
| `POST /v1/cctp/inbound` | `{ source, txHash, from? }` -> Iris attestation status for a burn on another chain and, once complete, the unsigned `receiveMessage` call that mints the USDC on Arc |

### Standing orders

| route | answer |
|---|---|
| `POST /v1/standing` | `{ text \| draft, owner, environment?, signer?, agent?, fence?, timezone? }` -> armed orders. Triggers: a Chainlink price above or below a value, a daily/weekly/monthly schedule, or a lending health factor falling below a value. |
| `GET /v1/standing?owner=`, `GET /v1/standing/:id` | orders with their last observation, fire count and the last intent they planned |
| `POST /v1/standing/:id/check` | checks now and fires when due (`force: true` plans it regardless of the trigger) |
| `POST /v1/standing/:id/pause`, `/resume`, `DELETE /v1/standing/:id` | |

A firing order plans an intent with the owner's Fence and emits `standing.fired`; it never signs. Stale prices or unreadable health factors never fire an order. Three failed plans in a row pause it.

Rules the engine keeps:

- `prepare` refuses unless the verdict is signable, and asks for `confirm: true` when the Fence says `confirm`.
- Each value-moving call is wrapped in Arc's Memo contract with `lykia:1:<intent>:<step>:<verdict tag>[|note]`. When an approval is needed, approve and the memo-wrapped call are batched through Multicall3From into one transaction. Both keep the signer as `msg.sender` through Arc's CallFrom precompile, so they need an EOA; send `account: "smart"` for smart accounts to get plain calls instead.
- `submit` checks that each on-chain transaction matches the prepared one exactly (from, to, calldata, value, chain id) and claims each hash once globally.
- Settled spend feeds the Fence's daily and weekly caps.
- A background poll every 15 s picks up late receipts and CCTP attestations.

### Scent

| route | answer |
|---|---|
| `GET /v1/scent/:token?environment=` | registry and look-alike check, bytecode, EIP-1167 / EIP-1967 proxies, privileged selectors, owner, and a holder transfer simulated with `eth_call` plus a balance-slot state override |
| `GET /v1/x402/scent/:token` | the same report with a wider balance-slot search, paid per call over x402 |
| `POST /v1/x402/fence/evaluate` | the Fence check, paid per call over x402 (validated before payment) |
| `POST /v1/x402/quote` | the route quote across every executable Arc venue, paid per call over x402 |
| `GET /v1/ecosystem` | the protocols mapped on Arc, Circle's products, TVL on Arc (DefiLlama, cached) and the value Lykia routed; public, CORS-open, cached 60 s |
| `GET /v1/openapi.json`, `GET /.well-known/x402` | OpenAPI 3.1 and the x402 service manifest for marketplaces and agents |

Arc's public RPC does not offer `eth_simulateV1` or `debug_traceCall`, so Scent simulates with `eth_call` state overrides. The best verdict for a token outside the registry is `no-red-flags`; Scent never says "safe".

### Tag (ERC-8004)

Agent Tag routes live under `/v1/tags`.

| route | answer |
|---|---|
| `POST /v1/tags/draft` | `{ owner, name, description, fence, endpoints?, agentWallet? }` -> registration card, card digest, Fence hash, agent URI and the unsigned `register(agentURI, [{ "lykia.fence": fenceHash }])` call |
| `GET /v1/tags/cards/:digest` | the stored card, so the agent URI can point at this API |
| `GET /v1/tags/:agentId?environment=` | owner, agent wallet, agent URI and card (data URIs, Lykia cards, or public https URLs behind the SSRF guard), the Fence hash on-chain and in the card, Lykia-tagged validations, reputation summary |
| `POST /v1/tags/attest` | `{ agentId, intentId, owner, validator, verdict? }` -> the validation record and the unsigned `ValidationRegistry.validationRequest` call |

### Lyko and the Pack

| route | answer |
|---|---|
| `POST /v1/agent/chat` | `{ message, owner?, threadId?, environment? }`. Deprecated: a `fence` field is still accepted and ignored; the chat plans under the proven owner's own Fence (`GET /v1/me/fence`), a project key's project Fence, or the Balanced preset. The reply is Server-Sent Events: `thread`, `notice`, `reading`, `task`, `tool`, `step`, `block`, `thinking-summary`, `proposal`, `clarify`, `draft`, `program`, `text`, `error`, `done`. A `step` is one piece of real work (reading the request, the wallet, searching routes, checking the Fence): it is sent with `state: "running"` when it starts and again, same `id`, with `ok`, `warn` or `fail`, a short `result` and the measured `ms` when it ends. A `block` is a typed card (`gas`, `fence`, `balance`, `rate`, `herded`, `settled`, `order`, `yields`, and the drafts Ask starts: `leash-draft`, `autopilot-draft`, `autopilot-task`, `agent-draft`; see `@lykia/core/api/answer`) whose numbers come from server data, never from model prose; the `text` stays the fallback. Alerts and automations Lyko sets up are saved only when the request proves control of `owner` (its Lykia-Session, or a secret key with the agents scope that may act for the owner: its own developer, or an owner who consented to the key's project via `POST /v1/consents`); otherwise `draft` carries a link to the prefilled form. Without that proof the chat also uses no profile, memory, contacts or Pack of the owner, and its thread is anonymous. Send `Accept: application/json` (or use the original `messages` array) to get the same events collected in one JSON document instead. |
| `GET /v1/agent/threads?owner=` / `GET /v1/agent/threads/:id?owner=` / `POST /v1/agent/threads` | thread memory per owner: the last 40 messages, kept for 30 days |
| `GET /v1/agent/insights?owner=&environment=` | insights on the Flock: idle cash, FX exposure, concentration, health factor, unpriced holdings, look-alike tokens, low gas. Each one comes with a sentence the deck can plan with one tap. |
| `GET/POST /v1/agent/automations`, `POST /v1/agent/automations/:id/(enable\|disable)`, `POST /v1/agent/automations/run` | bounded automations, fired by an insight or a timer. They produce proposals only. Deprecated for new creations: use `POST /v1/automations` (you sign each run) or an Autopilot task (Autopilot signs); existing ones keep running and show in the Fold's Running list. |
| `GET /v1/me/fence`, `PUT /v1/me/fence`, `POST /v1/me/fence/migrated` | the owner's Fence, kept on the server: its preset (Careful, Balanced or Bold, the same control as the risk profile), whether it was edited beyond the preset, and its hash. `PUT` takes `{ preset }` or `{ fence }`; a loosening answers 403 `FENCE_SIGNATURE_REQUIRED` with the message to sign, then succeeds with `signature`. |
| `POST /v1/agent/check` | `{ fence?, facts }` -> a verdict, for agents that check a move before making it |
| `GET /v1/pack?owner=&environment=` | the owner's agent tree. For the proven owner (session, or a key that may act for the owner) each agent comes with its name, mission, Fence and budget: caps, the amount allocated to children, what is free and what was spent. Anyone else gets the public view (role, capabilities, Fence hash, signer, session, status; `redacted: true`). `GET /v1/pack/:id/budget` needs the owner. |
| `POST /v1/pack` | creates a root agent: `{ owner, name, role, fence?, mission?, signer?, agentId? }` |
| `POST /v1/pack/:id/spawn` | creates a sub-agent. Its Fence must sit inside the parent's (`SUB_FENCE_VIOLATION`) and its caps must fit in the parent's free budget (`BUDGET_EXCEEDED`). Both errors list every field that broke the rule. |
| `POST /v1/pack/:id/revoke` | revokes the agent and its whole subtree, and frees its allocation |
| `POST /v1/pack/:id/(pause\|resume)`, `GET /v1/pack/:id/budget` | |
| `POST /v1/pack/:id/session-tx` | `{ account, key?, validDays?, maxCalls?, calls? }` -> an unsigned `createSession` call (root agent, signed by the owner) or `createSubSession` call (signed by the parent's session key) on the owner's LykiaAccount. The session mirrors the agent's Fence. |
| `POST /v1/pack/:id/session` | records the session id once the transaction has landed |
| `POST /v1/pack/whistle` | an unsigned `blowWhistle()` call for the owner's LykiaAccount, plus a `whistle.blown` webhook. A sentinel agent may request it. |
| `POST /v1/mcp` | streamable HTTP MCP: `lykia_venues`, `lykia_flock`, `lykia_scent`, `lykia_plan`, `lykia_outrun`, `lykia_fence_evaluate`, `lykia_pack`, `lykia_insights`, `lykia_pack_plan` |

Writes to the Pack need a `Lykia-Session` for the owner, or a secret API key with the `agents` scope.

How a turn works:

1. Lyko reads the situation: the network, the owner, the Fence, a Flock summary, the pulse and the Pack roster.
2. Lyko delegates each part of a goal to a specialist: treasurer, payroll, FX hedger, yield keeper, bill payer, sentinel or researcher. The specialist is the owner's Pack agent with that role. If the owner has none, Lyko uses a transient specialist whose Fence is the owner's Fence narrowed by the role template.
3. Each specialist runs its own bounded tool loop. It has only the tools its capabilities allow, and it plans under its own Fence.
4. When two or more specialists produce plans that pass their Fences, Lyko merges them into one intent under the owner's Fence. The owner signs one route, and every part of it is attributed to the specialist that planned it.

Bounds and safety:

- Turns are capped by `LYKIA_AGENT_MAX_STEPS` (model rounds per agent), four specialists per turn and `LYKIA_AGENT_MAX_TOKENS` per call.
- Tool output reaches the model wrapped as untrusted data.
- No tool signs, sends funds or edits a Fence.
- Without `ANTHROPIC_API_KEY`, the same events come from the deterministic path: the sentence reader assigns each action to its specialist and merges the resulting plans the same way.

### Sign-in, developers and admin

| route | answer |
|---|---|
| `GET /v1/consents`, `POST /v1/consents`, `DELETE /v1/consents/:projectId` | the signed-in owner's consents: which projects' secret keys may act for them (and whose webhooks carry their events). Session only |
| `POST /v1/auth/mcp-token`, `POST /v1/auth/mcp-token/revoke` | a read-only token for the MCP personal tools (memory, contacts, profile); never usable as a session |
| `POST /v1/auth/nonce`, `POST /v1/auth/verify`, `GET /v1/auth/session`, `POST /v1/auth/logout` | Sign-In with Ethereum (EIP-4361) on Arc (5042, 5042002) and common wallet chains. Nonces are single use. EOA and ERC-1271 signatures are both accepted. The session token travels in the `Lykia-Session` header. |
| `POST /v1/developers/register`, `GET /v1/developers/me` | developer profile |
| `GET/POST /v1/developers/keys`, `POST /v1/developers/keys/:id/(rotate\|revoke)` | API keys, sent in the `Lykia-Key` header. Secret keys look like `lk_sk_…`. Publishable keys look like `lk_pk_…`: they are limited to read and plan, and only work from their allowed origins. Each key has scopes and its own per-minute and per-day quota. Only an HMAC of a key is stored, and the full key is shown once. |
| `PUT /v1/developers/settings`, `GET /v1/developers/usage` | integrator fee (at most 50 bps) and usage per day and per key |
| `GET/POST /v1/developers/webhooks`, `POST /v1/developers/webhooks/:id/disable`, `GET /v1/developers/webhooks/deliveries`, `POST /v1/developers/webhooks/test` | signed webhooks for `intent.step.settled`, `intent.settled`, `pack.agent.spawned`, `pack.agent.revoked`, `whistle.blown` and `standing_order.fired` |
| `GET /v1/deployments` | Lykia contract deployments that were verified on Arc |
| `GET/POST /v1/admin/deployments`, `GET/PUT /v1/admin/flags`, `GET /v1/admin/overview` | admin role only (`LYKIA_ADMIN_ADDRESSES`). A deployment is recorded only after the server checks the receipt, the creating transaction and the runtime bytecode hash against the artifacts in `@lykia/core`. |

Webhook details:

- Each delivery carries `Lykia-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. Verify it with `verifyWebhook` from `@lykia/sdk`.
- Failed deliveries are retried after 30 s, 2 min, 10 min, 1 h and 6 h.
- Endpoints must resolve to public addresses.
- Endpoint secrets are encrypted at rest with a key derived from `LYKIA_SESSION_SECRET`.

### Profile, memory and contacts

All of these act for the signed-in owner (`Lykia-Session`); nothing here moves value. See [docs/memory.md](../../docs/memory.md).

| route | answer |
|---|---|
| `GET /v1/profile`, `PUT /v1/profile`, `DELETE /v1/profile` | the owner's profile (`lykia.profile/v1`) plus the web app's flat fields and plain-words effects; `PUT` takes a partial core profile or the web's flat document |
| `GET /v1/memory` | learned preferences (as deletable rows and structured), recurring patterns offered as standing orders, contacts, recent intents and the data-only summary Lyko's model sees |
| `GET /v1/memory/intents`, `GET /v1/memory/export` | remembered plans with what actually moved; everything as JSON |
| `DELETE /v1/memory/:id`, `POST /v1/memory/forget` | forget one intent, contact or preference; forget intents, contacts or everything |
| `GET/POST /v1/contacts`, `PUT/DELETE /v1/contacts/:id` | the address book; changing a contact's address resets its trust |

Memory resolves "again", "same as last week", "undo the last swap" (a fresh plan of the inverse), "more than last time" (asks how much), "pay Ahmet 200 EURC" and "my usual vault" in `/v1/language/parse`, `/v1/intents` and the agent. A learned contact without a confirmed send makes the plan ask for confirmation. Profiles shape the default Fence (risk, slippage, confirmation style, blocked venues), the routing ceiling and favourites (they win near-ties), Lyko's persona, display currency and the default network.

### Circle

See [docs/circle.md](../../docs/circle.md). `GET /v1/circle/status` lists every product as live, configured, needs a key or not on Arc.

| route | answer |
|---|---|
| `GET /v1/circle/services` | x402 services from Circle's Agent Marketplace that take USDC on Arc (public, keyless) |
| `GET /v1/circle/cctp/fees`, `POST /v1/circle/cctp/forward` | live CCTP fees; approve + `depositForBurnWithHook` with Circle's Forwarding Service |
| `POST /v1/circle/gateway/transfer` (+ `/attest`), `POST /v1/circle/gateway/transfer/draft`, `GET /v1/circle/gateway/balance` | Gateway transfers out of the unified balance: burn intent to sign, attestation, unsigned `gatewayMint` on the destination; the unified balance per chain |
| `POST /v1/circle/x402/prepare`, `POST /v1/circle/x402/pay` | pay an x402 service from Arc: the price and payee are judged by the Fence, the owner or agent signs EIP-3009, Lykia relays the paid request |
| `POST /v1/circle/screen`, `GET /v1/circle/compliance/:address` | Compliance Engine screening (`CIRCLE_API_KEY`); plans also screen external recipients and a DENIED one joins the Fence's deny list |
| `POST /v1/circle/stablefx/quote`, `/trade`, `GET /v1/circle/stablefx/trades/:id` | StableFX RFQ taker flow (Circle StableFX access) |
| `POST /v1/circle/agent-wallets` (alias `/v1/circle/wallets/agent`), `GET /v1/circle/wallets/:id/balances` | opt-in (`LYKIA_CIRCLE_SERVER_WALLETS=true` + `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET`, else 403): an SCA developer-controlled wallet on Arc, bound to the signed-in address that created it; only that address can read its balances or pay from it |
| `GET /v1/oracles` | Chainlink against Pyth (read on chain on Arc), and display rates |
| `GET /v1/jobs/:id`, `POST /v1/jobs/draft`, `/:id/fund`, `/:id/complete`, `/:id/reject`, `/:id/refund` | ERC-8183 agent jobs on Arc testnet: unsigned escrow calls |

### Orders, alerts, discover, markets and activity

| route | what |
|---|---|
| `GET /v1/orders/config` | LykiaOrders address, fee, EIP-712 domain and types, Chainlink feeds |
| `POST /v1/orders/draft` | typed data to sign, the allowance still needed, per-execution fee, tip and minimum |
| `POST /v1/orders` | stores a signed order (signature checked, nonce and state read on chain) |
| `GET /v1/orders?owner=` | orders with live status (`open`, `waiting`, `filled`, `cancelled`, `expired`, `invalid`); the full view (levels, amounts, summary) only for the proven owner, otherwise hash, kind and status with `redacted: true` |
| `GET /v1/orders/:hash/cancel-tx`, `/execute-tx?keeper=` | unsigned transactions for the maker / any keeper |
| `POST /v1/orders/keeper/tick` | one keeper pass (admin or `CRON_SECRET`); also every 30 s in-process and on `/cron/orders` |
| `GET/POST /v1/alerts`, `PATCH/DELETE /v1/alerts/:id` | rules: `price-above/below` (Chainlink), `health-below`, `transfer-in/out`, `scent-warning`, `order-filled` |
| `GET /v1/alerts/inbox`, `POST /v1/alerts/inbox/read` | the in-app inbox; firings also go to webhooks (`alert.fired`) and Telegram |
| `POST /v1/telegram/link-code`, `GET /v1/telegram/status`, `DELETE /v1/telegram/link`, `POST /v1/telegram/webhook` | Telegram linking |
| `GET /v1/discover/launches` | new pools from Uniswap v3/v2, Aerodrome Slipstream, Synthra, SushiSwap V3 and Archery factory events, with token trust; launchpads from the registry |
| `GET /v1/perps/markets`, `/v1/perps/markets/:market` | Extended perpetuals data (read-only; trading is on Extended's engine) |
| `GET /v1/activity` | the session owner's intents, orders and alerts in one feed |
| `GET /v1/track/:hash` | any Arc transaction with each log's emitter labelled from the registry |
| `GET/POST /v1/watch`, `DELETE /v1/watch/:address` | watched addresses (50 per owner) |

MCP adds `lykia_launches`, `lykia_perps_markets`, `lykia_orders` and `lykia_dev_tools`.

### x402

Paid routes answer `402` with `{ x402Version: 2, accepts: [requirements] }` (also base64 in `PAYMENT-REQUIRED`): scheme `exact`, network `eip155:5042` or `eip155:5042002`, asset USDC, EIP-712 domain `USDC` version `2`. The client retries with the signed EIP-3009 authorization in `X-PAYMENT` (or `PAYMENT-SIGNATURE`). The server verifies the signer, recipient, amount, validity window and nonce locally. It then settles through Circle's x402 facilitator (`LYKIA_X402_FACILITATOR_URL`, bearer `CIRCLE_API_KEY`) before answering; a failed settlement answers `402`, never a free response. With `LYKIA_X402_FACILITATOR_URL=off` it runs verify-only and says so in `PAYMENT-RESPONSE`.

## What is live

Executable venues (`EXECUTABLE_VENUES` in `src/engine/adapters.ts`): 13 protocols on mainnet, plus the vaults of 5 curators reached through Morpho. `GET /v1/ecosystem` computes the same counts from the registry.

| venue | mainnet | testnet |
|---|---|---|
| `arc-transfer` (ERC-20 transfer with an Arc Memo) | yes | yes |
| `cctp` (CCTP V2 burn to EVM chains; inbound mints via `/v1/cctp/inbound`) | yes | yes |
| `gateway` (Circle Gateway deposit) | yes | yes |
| `morpho-vaults` (Morpho Vault V2, ERC-4626 deposit and withdraw, ranked by live APY) | yes | no deployment |
| Curators' Morpho vaults: `galaxy-curation`, `keyrock`, `steakhouse-financial`, `gauntlet`, `bitwise` (through the Morpho vault adapters) | yes | no deployment |
| `morpho-blue` (cirBTC/USDC and cirBTC/EURC 86% LLTV: post collateral and borrow, repay by shares) | yes | no deployment |
| `aave-v4` (Main and Forex Spokes: supply, withdraw, borrow with cirBTC collateral, repay) | yes | no deployment |
| `uniswap-v3` (every fee tier and two-hop paths through USDC) | yes | no deployment |
| `uniswap-v4` (hookless pools through UniversalRouter and Permit2) | yes | no deployment |
| `aerodrome-slipstream` (through its Metarouter) | yes | no deployment |
| `archery` (Slipstream-style pools through its SwapRouter) | yes | no deployment |
| `unitflow-finance-v3` (Uniswap v3 fork router) | yes | no deployment |
| `sushiswap` (Sushi swap API, settled by RedSnwapper with Lykia's minimum) | yes | no deployment |
| `relay` (Relay depository deposit, filled on the destination chain) | yes | no deployment |
| `across` (Across SpokePool `depositV3`, filled on the destination chain by an Across relayer) | yes | no deployment |
| `zerox` (0x Swap API through AllowanceHolder) | only with `ZEROX_API_KEY` | no deployment |
| `lykia-practice` (Lykia's own vault, USDC/EURC swap and cirBTC lending) | testnet only | once deployed from the contracts package |

Listed for discovery but not executed:

- Synthra and direct SushiSwap V3 pools. Their pools are quoted exactly (see below), but neither has a verified router on Arc. Synthra pools show no swaps in the last ~300k blocks; the contract that swaps in the SushiSwap pool (0x09AD…4Afa) has no verified source. Sushi swaps go through the Sushi swap API instead.
- Other venues: PancakeSwap Infinity, Kaleido, Uniswap v2, and Curve (deployed, no pools yet).
- Launchpads: ArgusPad, FAZE, LIFT V2, Tolly.
- Oracles: Chainlink, Pyth, Stork.
- Circle services outside the route search: StableFX (RFQ taker endpoints), the USYC Teller (entitled wallets, `/v1/circle/usyc/*`; its source is unverified), the x402 facilitator and Gateway nanopayments.

Needs credentials or more work:

- StableFX is not a route in the intent engine: its RFQ settles a quote the taker signs off chain, so it runs only through the `/v1/circle/stablefx/*` taker endpoints (with Circle StableFX access). FX steps in a plan route through the best on-chain pool, and the Fence checks the quote against Chainlink EURC/USD.
- CCTP to Solana needs a token account as the mint recipient and is refused for now.
- Lykia practice venues route only after they are deployed and recorded in `@lykia/core` contracts deployments.

Checked against the live network by `npm run smoke` (read-only, 15 checks):

- chain ids on both networks
- USDC accepting an EIP-3009 authorization signed for domain `USDC` v2
- Memo nested inside Multicall3From
- Chainlink prices
- a Flock read
- Scent
- the Morpho and Aave rate APIs
- live swap, earn and borrow routes
- an Aave V4 approve + supply + withdraw batch

The prepared batches of the original adapters were also simulated with `eth_call` from funded addresses on mainnet: Aave supply and borrow, a Morpho Galaxy deposit, a Morpho Blue borrow, a Uniswap v4 FX through Permit2, a Uniswap v3 two-hop swap and an Aerodrome Slipstream swap ([docs/flows.md](../../docs/flows.md)). The Archery, Unitflow, Sushi, 0x and Relay adapters are covered by `src/__tests__/venues-added.test.ts`.

## Layout

```
src/
  index.ts  server.ts  app.ts  config.ts  context.ts  services.ts  log.ts  bus.ts  clock.ts
  http/       errors, request ids, router, validation, rate limits, SSE, CORS, SSRF guard
  store/      Store interface, memory and Postgres
  chains/     arc.ts: viem clients, Multicall3 balances, receipts, raw JSON-RPC
  health/     RPC and store probes
  arc/        pulse (block poller), prices (Chainlink)
  flock/      balance sheet, Morpho vault positions, Gateway balance
  scent/      token inspection
  language/   English sentence reader
  engine/     ABIs, call shaping (Memo, Multicall3From), adapters, planner, intent service
  tag/        ERC-8004 cards, register and validation calls, agent views
  x402/       payment requirements and verification middleware
  agents/     the Pack service, Lyko's orchestrator and specialists, tools, thread memory, perception, insights, automations, LykiaAccount session calls
  platform/   SIWE sessions, API keys and the developer gate, webhooks, developer settings and usage, admin registry and flags
  modules/    route modules (developers, auth, system, arc, flock, fence, language, intents, scent, tags, agent, admin, mcp)
  scripts/    smoke.ts (live, read-only)
```

## Exact CL quotes and Aerodrome

Concentrated-liquidity pools outside Uniswap are quoted with `LykiaClQuoter`
(packages/contracts/contracts/quoters). The contract is never deployed: the
API places its runtime code at a throwaway address through an `eth_call`
state override, asks the pool to swap, and reverts inside
`uniswapV3SwapCallback` with the deltas. The quote is the pool's own math at
the current block and nothing moves.

Aerodrome Slipstream is executable on mainnet (`swap-aerodrome`). The step is
`approve(Metarouter)` + `Memo(Metarouter.execute(0x00, [SwapExactInParams],
deadline))` through Multicall3From; the encoding comes from the Metarouter's
verified source (command `CL_SWAP_EXACT_IN`, `payerIsUser = true`, spend mode
`Amount`). It was simulated on mainnet: 1000 USDC into the USDC/EURC pool
passes with an 890 EURC minimum (quote 895.97) and reverts with 897.
`npm run smoke -w @lykia/api` repeats the simulation.

## Hardening

- **Pinned outbound fetches.** Tag card fetches, webhook deliveries and
  x402 relays use `ctx.publicFetch`: the hostname is resolved once at
  connect time by the guarded lookup, non-public addresses are refused and
  the socket connects to the checked address with the original Host and TLS
  server name. No redirect is followed. A DNS answer that changes between
  registration and delivery (rebinding) is refused.
- **Idempotency-Key.** `POST /v1/intents`, step `prepare` and `submit`, and
  Pack writes honour the header for 24 hours: the same key and body replay
  the stored answer (`Idempotent-Replayed: true`), a different body or a
  request still in flight answers 409 `IDEMPOTENCY_CONFLICT`, and 5xx answers
  are not stored.
- **Stale approvals.** Insights read every allowance from the owner to known
  venue contracts in one multicall. Lykia's own steps approve exact amounts
  that the same transaction spends, so a leftover allowance is reported with
  a ready-to-sign `approve(spender, 0)` in `insight.transactions`.

## Display currencies

`GET /v1/oracles` returns `display.TRY` from a fresh Pyth USD/TRY price when
Arc carries one, otherwise from ECB reference rates (api.frankfurter.dev,
cached six hours), labelled `ecb-reference` and not tradable. The ECB EUR rate
is also compared with Chainlink EURC/USD (`reference.eurcVsEcbBps`) for
display. The Fence's oracle-gap fact only compares fresh on-chain feeds; with
no fresh second feed it makes no claim.

## Protocol fee

Every value-moving step (send, swap, FX, deposit, supply, borrow, bridge,
Gateway deposit) pays `LYKIA_FEE_BPS` (default 100 = 1%) to
`LYKIA_FEE_RECIPIENT`. Repay, withdrawals home, approvals, revokes and Tag
steps are free. `GET /v1/fees` (and the MCP tool `lykia_fees`) reports the
live policy.

- **Where it is taken.** From the step's input before the action, so venue
  quotes and minimum outputs use what the venue actually receives. A send with
  an exact amount pays it on top, so the recipient gets exactly what was asked.
  A borrow pays it from the borrowed amount, after the borrow call. The fee is
  rounded up, at most one base unit above the exact share.
- **How it is enforced.** The fee is an ERC-20 `transfer` inside the step's own
  transaction: a call in the Multicall3From batch (the sender stays the owner)
  or a call in the same user operation for smart accounts. The prepared
  transaction's binding covers the fee call, so a submitted transaction
  without it fails with `BINDING_MISMATCH`. Pack session keys get the fee
  recipient in their allowed recipients.
- **What the owner sees.** Each step carries `fee` (amount, token, USD, basis);
  the Fence counts it in the day/week/per-step caps and lists a `fee` reason;
  the outrun has a fee line per stop and `fees` totals per token. Dry runs show
  the same numbers.
- **LykiaRouter.** The router's own integrator fee is capped at 0.5% on chain,
  so Lykia's fee is not taken there. Split swaps run as one `LykiaRouter.run`
  when both venues are allowlisted (`GET /v1/admin/router` lists the owner's
  unsigned `setVenue` calls otherwise); the fee transfer sits in the same batch.

## Hosting

See [docs/hosting.md](../../docs/hosting.md) for Vercel versus Render. The
Blueprint is [`render.yaml`](../../render.yaml): a persistent Node service that
starts the schedulers (standing orders every 30 s, the intent poller, alerts,
the order keeper) right after `listen`.

## Serverless

On Vercel Functions (`VERCEL=1`) `/v1/health` reports `runtime: "serverless"`
and `persistence: "memory" | "postgres"`. Event streams close after 280 s with
a reconnect comment so EventSource resumes with `Last-Event-ID` before the
300 s function limit. Background timers are unref'd. Without a database each
instance keeps its own memory store; attach Postgres (`DATABASE_URL` from the
Vercel Neon integration works) for state that survives cold starts.

## Smart accounts

- **Sign-in.** SIWE accepts EOA signatures, ERC-1271 signatures from deployed
  smart accounts and ERC-6492 wrapped signatures from counterfactual ones
  (for example a Circle Modular Wallet passkey account that is not deployed
  yet). The check runs through viem's public-client `verifyMessage` against
  Arc, which simulates the deployment in one `eth_call`; nothing is deployed.
- **Execution.** Intents created with `account: "smart"` get plain calls.
  When the account runs them inside one ERC-4337 UserOperation, submit with
  `{ "userOpHash": "0x…" }` instead of `hashes`. The API finds the
  EntryPoint's `UserOperationEvent` (v0.6, v0.7 and v0.8 are deployed on both
  Arc networks), decodes the bundle's `handleOps`, takes the operation with
  the same sender and nonce, and requires every prepared call (target, data
  and non-zero value) inside its callData. The bundle transaction hash
  becomes the step's reference. Limitations: matching is containment rather
  than a decode of the account's own execute ABI; bundles sent through a
  wrapper contract instead of a direct `handleOps` call are refused; only the
  last ~5 hours of logs (four 10,000-block windows) are searched; Circle's bundler receipt endpoint is not
  used because it needs credentials.
