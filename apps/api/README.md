# @lykia/api

The Lykia API: one Express 5 service for Arc Network. It reads the chain (pulse, the Flock, Scent), plans intents with live quotes and evaluates them against the owner's Fence, hands out unsigned transactions carrying Arc Memos, verifies submitted hashes against Arc receipts, drafts Künye (ERC-8004) identities, and serves Lyko, an MCP endpoint and x402 paid routes.

The server never signs. Every value-moving transaction is signed in the owner's (or the agent's) own wallet.

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
| `PORT`, `HOST` | `3002`, `0.0.0.0` | listen address |
| `LYKIA_MODE` | `testnet` | default Arc environment when a request does not name one |
| `LYKIA_WEB_ORIGIN` | (none) | extra CORS origins; localhost dev origins are allowed outside production |
| `LYKIA_DATABASE_URL` | (none) | Postgres for intents, hash claims, Künye cards, spend counters and x402 nonces; in-memory without it |
| `ARC_MAINNET_RPC_URL`, `ARC_TESTNET_RPC_URL` | (none) | extra RPC endpoints, tried before `rpc.mainnet.arc.io` / `rpc.testnet.arc.io` |
| `ANTHROPIC_API_KEY`, `LYKIA_AGENT_MODEL` | (none), `claude-sonnet-5-5` | Lyko and the specialists run on Claude with Lykia's tools; without a key the deterministic path answers |
| `LYKIA_AGENT_MAX_STEPS`, `LYKIA_AGENT_MAX_TOKENS` | `6`, `4096` | model rounds per agent per turn, output tokens per call |
| `LYKIA_SESSION_SECRET` | (none) | 32+ characters; signs sessions and derives the keys that hash API keys and seal webhook secrets. Development uses a per-process secret when it is unset; production refuses sign-in without it |
| `LYKIA_SIWE_DOMAINS`, `LYKIA_ADMIN_ADDRESSES` | (none) | extra sign-in domains (host[:port]); addresses with the admin role |
| `CIRCLE_API_KEY` | (none) | Circle platform key: Compliance Engine screening, developer-controlled wallets, StableFX (when the key has access) |
| `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID` | (none) | entity secret (32 bytes hex, registered with Circle) for developer-controlled wallets; an existing wallet set to reuse |
| `STABLEFX_API_KEY` | (none) | a separate StableFX key, if StableFX access sits on its own key |
| `TELEGRAM_BOT_TOKEN` | (none) | lets profiles name a Telegram chat for notifications |
| `LYKIA_X402_PAY_TO`, `LYKIA_X402_PRICE_USDC`, `LYKIA_X402_FACILITATOR_URL` | (none), `0.01`, (none) | x402 paid routes; off unless `PAY_TO` is set; settlement only with a facilitator |
| `LYKIA_RATE_LIMIT_DEFAULT`, `_HEAVY`, `_AUTH` | `600`, `60`, `20` | requests per minute per IP |

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
| `POST /v1/language/parse` | `{ text }` -> plan actions, standing orders (conditions and schedules), sheepdog command, hidden word, clarifying questions with suggested answers, reply. English and Turkish, several clauses per sentence. |
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

Arc's public RPC does not offer `eth_simulateV1` or `debug_traceCall`, so Scent simulates with `eth_call` state overrides. The best verdict for a token outside the registry is `no-red-flags`; Scent never says "safe".

### Künye (ERC-8004)

| route | answer |
|---|---|
| `POST /v1/kunye/draft` | `{ owner, name, description, fence, endpoints?, agentWallet? }` -> registration card, card digest, Fence hash, agent URI and the unsigned `register(agentURI, [{ "lykia.fence": fenceHash }])` call |
| `GET /v1/kunye/cards/:digest` | the stored card, so the agent URI can point at this API |
| `GET /v1/kunye/:agentId?environment=` | owner, agent wallet, agent URI and card (data URIs, Lykia cards, or public https URLs behind the SSRF guard), the Fence hash on-chain and in the card, Lykia-tagged validations, reputation summary |
| `POST /v1/kunye/attest` | `{ agentId, intentId, owner, validator, verdict? }` -> the validation record and the unsigned `ValidationRegistry.validationRequest` call |

### Lyko and the Pack

| route | answer |
|---|---|
| `POST /v1/agent/chat` | `{ message, owner?, threadId?, environment?, fence? }`. The reply is Server-Sent Events: `thread`, `reading`, `task`, `tool`, `thinking-summary`, `proposal`, `clarify`, `text`, `error`, `done`. Send `Accept: application/json` (or use the original `messages` array) to get the same events collected in one JSON document instead. |
| `GET /v1/agent/threads?owner=` / `GET /v1/agent/threads/:id?owner=` / `POST /v1/agent/threads` | thread memory per owner: the last 40 messages, kept for 30 days |
| `GET /v1/agent/insights?owner=&environment=` | insights on the Flock: idle cash, FX exposure, concentration, health factor, unpriced holdings, look-alike tokens, low gas. Each one comes with a sentence the deck can plan with one tap. |
| `GET/POST /v1/agent/automations`, `POST /v1/agent/automations/:id/(enable\|disable)`, `POST /v1/agent/automations/run` | bounded automations, fired by an insight or a timer. They produce proposals only. |
| `POST /v1/agent/check` | `{ fence?, facts }` -> a verdict, for agents that check a move before making it |
| `GET /v1/pack?owner=&environment=` | the owner's agent tree. Each agent comes with its Fence hash and budget: caps, the amount allocated to children, what is free and what was spent. |
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

Memory resolves "again / tekrar yap", "same as last week / geçen haftaki gibi", "undo the last swap / son swap'ı geri al" (a fresh plan of the inverse), "more than last time" (asks how much), "pay Ahmet 200 EURC / Ahmet'e 200 EURC gönder" and "my usual vault / her zamanki kasam" in `/v1/language/parse`, `/v1/intents` and the agent. A learned contact without a confirmed send makes the plan ask for confirmation. Profiles shape the default Fence (risk, slippage, confirmation style, blocked venues), the routing ceiling and favourites (they win near-ties), Lyko's persona, display currency and the default network.

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
| `POST /v1/circle/agent-wallets` (alias `/v1/circle/wallets/agent`), `GET /v1/circle/wallets/:id/balances` | an SCA agent wallet on Arc for a Pack agent (`CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET`) |
| `GET /v1/oracles` | Chainlink against Pyth (read on chain on Arc), and display rates |
| `GET /v1/jobs/:id`, `POST /v1/jobs/draft`, `/:id/fund`, `/:id/complete`, `/:id/reject`, `/:id/refund` | ERC-8183 agent jobs on Arc testnet: unsigned escrow calls |

### x402

Paid routes answer `402` with `{ x402Version: 2, accepts: [requirements] }` (also base64 in `PAYMENT-REQUIRED`): scheme `exact`, network `eip155:5042` or `eip155:5042002`, asset USDC, EIP-712 domain `USDC` version `2`. The client retries with the signed EIP-3009 authorization in `X-PAYMENT` (or `PAYMENT-SIGNATURE`). The server verifies the signer, recipient, amount, validity window and nonce locally. It settles through `LYKIA_X402_FACILITATOR_URL` (for example Circle's facilitator) when set; otherwise it runs verify-only and says so in `PAYMENT-RESPONSE`.

## What is live

Executable venues:

| venue | mainnet | testnet |
|---|---|---|
| `arc-transfer` (ERC-20 transfer with an Arc Memo) | yes | yes |
| `cctp` (CCTP V2 burn to EVM chains; inbound mints via `/v1/cctp/inbound`) | yes | yes |
| `gateway` (Circle Gateway deposit) | yes | yes |
| `morpho-vaults` (Morpho Vault V2, ERC-4626 deposit and withdraw, ranked by live APY) | yes | no deployment |
| `aave-v4` (Main and Forex Spokes: supply, withdraw, borrow with cirBTC collateral, repay) | yes | no deployment |
| `morpho-blue` (cirBTC/USDC and cirBTC/EURC 86% LLTV: post collateral and borrow, repay by shares) | yes | no deployment |
| `uniswap-v3` (every fee tier and two-hop paths through USDC) | yes | no deployment |
| `uniswap-v4` (hookless pools through UniversalRouter and Permit2) | yes | no deployment |
| `lykia-practice` (Lykia's own vault, USDC/EURC swap and cirBTC lending) | testnet only | once deployed from the contracts package |

Listed for discovery but not executed:

- Synthra and SushiSwap V3. Their pools are quoted exactly (see below), but neither has a verified router on Arc, so Lykia lists them without executing. Synthra pools show no swaps in the last ~300k blocks; the contract that swaps in the SushiSwap pool (0x09AD…4Afa) has no verified source.
- Other venues: Synthra, Archery, SushiSwap V3, PancakeSwap Infinity, Kaleido, Uniswap v2, and Curve (deployed, no pools yet).
- Launchpads: ArgusPad, FAZE, LIFT V2, Tolly.
- Oracles: Chainlink, Pyth, Stork.
- Circle services: the x402 facilitator, Gateway nanopayments, and the USYC Teller (its source is unverified).

Needs credentials or more work:

- StableFX RFQ needs Circle credentials and a taker signature flow that this build does not implement. FX routes through the best on-chain pool instead (Uniswap v3 or v4), and the Fence checks the quote against Chainlink EURC/USD.
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

Every adapter's prepared batch was also simulated with `eth_call` from funded addresses on mainnet: Aave supply and borrow, a Morpho Galaxy deposit, a Morpho Blue borrow, a Uniswap v4 FX through Permit2, and a Uniswap v3 two-hop swap.

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
  language/   English and Turkish reader
  engine/     ABIs, call shaping (Memo, Multicall3From), adapters, planner, intent service
  kunye/      ERC-8004 cards, register and validation calls, agent views
  x402/       payment requirements and verification middleware
  agents/     the Pack service, Lyko's orchestrator and specialists, tools, thread memory, perception, insights, automations, LykiaAccount session calls
  platform/   SIWE sessions, API keys and the developer gate, webhooks, developer settings and usage, admin registry and flags
  modules/    route modules (developers, auth, system, arc, flock, fence, language, intents, scent, kunye, agent, admin, mcp)
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

- **Pinned outbound fetches.** Künye card fetches, webhook deliveries and
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
