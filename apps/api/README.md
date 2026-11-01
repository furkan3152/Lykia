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
| `ANTHROPIC_API_KEY`, `LYKIA_AGENT_MODEL` | (none), `claude-sonnet-5-5` | Lyko answers with Claude and Lykia's tools; without a key the deterministic reader answers |
| `STABLEFX_API_KEY` | (none) | Circle StableFX credentials (see "What is live") |
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
| `GET /v1/venues?environment=` | registry rows plus `executable` (this engine has an adapter) and `live` |
| `GET /v1/arc/pulse?environment=` | block, block time, base fee in gwei of USDC, tps, cost of a USDC transfer in USD |
| `GET /v1/arc/pulse/stream` | SSE, event `pulse` |

### The Flock

| route | answer |
|---|---|
| `GET /v1/flock/:address?environment=` | wallet tokens and native USDC (one Multicall3 round trip), Morpho vault positions (`convertToAssets`), the Circle Gateway unified balance, USD values and their sources |
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
| `POST /v1/language/parse` | `{ text }` -> plan actions, sheepdog command, hidden word, clarifying questions, reply (English and Turkish) |
| `POST /v1/intents` | `{ text | actions, owner, environment?, fence?, signer?, agent?, account?, dryRun? }` -> intent graph, Outrun, verdict |
| `GET /v1/intents/:id`, `GET /v1/intents/:id/outrun` | the graph and where the money is |
| `POST /v1/intents/:id/steps/:sid/prepare` | `{ confirm? }` -> unsigned transactions, binding digest, memo |
| `POST /v1/intents/:id/steps/:sid/submit` | `{ hashes }` -> verified against Arc; a matching successful receipt settles a same-chain step |
| `GET /v1/intents/:id/steps/:sid/attestation` | the CCTP attestation once Circle's Iris API reports it complete |
| `POST /v1/intents/:id/stop` | stops every unstarted step |
| `GET /v1/intents/:id/stream` | SSE: `intent`, `outrun` |

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

### Agents

| route | answer |
|---|---|
| `POST /v1/agent/chat` | `{ messages, owner?, environment?, fence? }` -> Lyko's reply and any proposed (stored, unsigned) intents |
| `POST /v1/agent/check` | `{ fence?, facts }` -> verdict (for agents checking a move before they make it) |
| `POST /v1/mcp` | streamable HTTP MCP: `lykia_venues`, `lykia_flock`, `lykia_scent`, `lykia_plan`, `lykia_outrun`, `lykia_fence_evaluate` |

Lyko only proposes. With an Anthropic key it uses tools over the same services; plans it proposes are marked as agent proposals, so the Shepherd Fence asks the owner to confirm them.

### x402

Paid routes answer `402` with `{ x402Version: 2, accepts: [requirements] }` (also base64 in `PAYMENT-REQUIRED`): scheme `exact`, network `eip155:5042` or `eip155:5042002`, asset USDC, EIP-712 domain `USDC` version `2`. The client retries with the signed EIP-3009 authorization in `X-PAYMENT` (or `PAYMENT-SIGNATURE`). The server verifies the signer, recipient, amount, validity window and nonce locally. It settles through `LYKIA_X402_FACILITATOR_URL` (for example Circle's facilitator) when set; otherwise it runs verify-only and says so in `PAYMENT-RESPONSE`.

## What is live

Executable venues:

| venue | mainnet | testnet |
|---|---|---|
| `arc-transfer` (ERC-20 transfer with an Arc Memo) | yes | yes |
| `cctp` (CCTP V2 `depositForBurn` to EVM chains) | yes | yes |
| `gateway` (Circle Gateway deposit) | yes | yes |
| `morpho-vaults` (Morpho Vault V2, ERC-4626 deposit and withdraw) | yes | no deployment |
| `uniswap-v3` (QuoterV2 + SwapRouter02; also USDC to EURC FX) | yes | no deployment |

Registered for discovery but not executed: Aave V4 (Hub and Spoke), Morpho Blue borrowing, Uniswap v4, Curve (deployed, no pools yet), Archery, Synthra, Aerodrome Slipstream, launchpads, oracles, USYC Teller.

Needs credentials or more work:

- StableFX RFQ needs Circle credentials and a taker signature flow that this build does not implement. FX intents route through the Uniswap v3 USDC/EURC pool instead, and the Fence checks the quote against Chainlink EURC/USD.
- Borrow and repay answer `NO_ROUTE` until the Morpho Blue and Aave V4 adapters exist.
- CCTP to Solana needs a token account as the mint recipient and is refused for now. A CCTP step settles when Circle's attestation is complete; the mint on the destination is a `receiveMessage` call that any relayer can make with the stored attestation.
- Earn ranks Morpho vaults by total assets, not by yield, because no APY is read on-chain.

Checked against the live network by `npm run smoke` (read-only): chain ids; USDC accepting an EIP-3009 authorization signed for domain `USDC` v2 (simulated with a state override); Memo nested inside Multicall3From composing on both networks; Chainlink prices; a Flock read; Scent on USDC and on a launchpad token. Prepared Morpho deposits, Uniswap swaps, USDC to EURC conversions and CCTP burns were also simulated with `eth_call` from funded addresses on mainnet.

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
  modules/    route modules (system, arc, flock, fence, language, intents, scent, kunye, agent, mcp)
  scripts/    smoke.ts (live, read-only)
```
