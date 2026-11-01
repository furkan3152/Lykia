# Feature parity with Elyia v2

Elyia v2 is the sister product on Hyperliquid (HyperCore and HyperEVM). This table maps each Elyia feature, read from its `origin/main` (API reference, modules and pages), to Lykia on Arc. "Before" is Lykia at the start of this round; "now" is after it.

Legend: **have** = shipped and tested · **partial** = shipped with a stated limit · **missing** · **n/a** = has no Arc counterpart (explained).

## Trading and markets

| Elyia feature | Before | Now | Lykia on Arc |
|---|---|---|---|
| Perps trading terminal (HyperCore order ticket, leverage, positions) | missing | partial | No perps venue settles on Arc. Extended and edgeX hold USDC collateral on Arc but match orders on their own engines (Starknet, edgeX L2) and need a Stark key. Lykia shows Extended's markets read-only: `/app/markets` and `GET /v1/perps/markets[/:market]` (mark, 24h, funding, OI, max leverage, 7-day hourly candles, top-10 book, tape). It does not place perps orders. |
| Market catalog, book, trades, candles, funding | missing | have | Same terminal, 341 Extended markets, cached 5–60 s. |
| Conditional orders (ElyOrders: limit, stop, take-profit, TWAP) | missing | have | `LykiaOrders` contract: limit, stop-loss, take-profit, DCA and TWAP, EIP-712 signed once, Chainlink-triggered, executed by keepers through `LykiaRouter`, 1% fee. API `/v1/orders/*`, keeper loop plus `/cron/orders`, page `/app/orders`. Not deployed yet (see Deploy). |
| Keeper with a scoped agent key | partial | have | Pack sessions (on-chain `LykiaAccount` sessions) plus the orders keeper (`LYKIA_KEEPER_PRIVATE_KEY`, optional; anyone can execute and earn the tip). |
| Swap page | have | have | Ask Lyko plans swaps across Uniswap v3/v4, Aerodrome, Synthra and others under the Fence. |
| Bridge page | have | have | CCTP V2, Gateway and Gateway transfers on `/app/circle`. |
| Whales, HIP-3 dexes, HyperCore vaults | missing | n/a | HyperCore-specific; Arc has no order book to read whales from. Morpho vault curators are listed instead. |
| View-as / watch anyone | partial | have | Flock reads any address; the new watchlist (`/v1/watch`, Activity page) keeps up to 50. |

## Automation

| Elyia feature | Before | Now | Lykia on Arc |
|---|---|---|---|
| Automations (auto-protect, idle sweep, rebalance, gas top-up, dust sweep) | have | have | `agent/automations` and standing orders (time and price triggers). |
| Insights (idle cash, what-if, explain PnL) | partial | have | Insights existed; now there is a what-if page (cirBTC and EURC shocks, estimated health factors) with PnL explained per holding. |
| Alerts: price, funding, liquidation distance, intent step | missing | partial | `price-above/below` (Chainlink), `health-below`, `transfer-in/out`, `scent-warning`, `order-filled`. Funding alerts are not built (perps are off-Arc). |
| Alert delivery: feed, webhook, Telegram | partial | have | In-app inbox, developer webhooks (`alert.fired`, `order.executed`), Telegram bot with a one-time `/start` code. |
| Telegram mini app and Telegram sign-in | missing | missing | Not built: the bot links and notifies, but there is no mini app and no initData sign-in yet. |
| Kill switch | have | have | The Whistle (Pack) pauses agents; LykiaOrders has a nonce floor to cancel every older order at once. |
| Transaction tracker | partial | have | Intents have Outrun and SSE. Now any Arc tx hash too: `GET /v1/track/:hash` labels each log's emitter from the registry, including Arc's native-USDC system emitter. |
| Activity feed | partial | have | `/app/activity`: intents, orders and alerts in one trail. |
| Portfolio history (30–90 days) | missing | missing | Not built: the Flock is live only and nothing stores daily snapshots yet. |

## Discovery and safety

| Elyia feature | Before | Now | Lykia on Arc |
|---|---|---|---|
| Launch radar | missing | have | `/app/discover`, `GET /v1/discover/launches`: PoolCreated/PairCreated from 7 factories (Uniswap v3/v2, Aerodrome Slipstream and lite, Synthra, SushiSwap V3, Archery). The first run backfills about 300k blocks, later runs scan only new blocks, and results are stored. Live check: 3 new Uniswap v3 pools (MOKI, AOG, BANKARC against USDC). |
| Shield (token safety) | have | have | Scent; the radar links each unverified token to it. |
| Protocol registry | partial (30) | have (82) | 30 verified rows (addresses plus eth_getCode evidence) and 52 DefiLlama-listed Arc protocols marked `announced` with their Arc TVL as evidence. None of the 52 is executable until verified. |
| Launchpads | have | have | Argus, FAZE, LIFT, Tolly (verified) plus 18 listed. |

## Platform

| Elyia feature | Before | Now | Lykia on Arc |
|---|---|---|---|
| SIWE sessions, roles | have | have | |
| Developer keys, usage, webhooks, fees | have | have | |
| Embeddable widget config | missing | missing | Not built. |
| MCP server | have | have | Adds `lykia_launches`, `lykia_perps_markets`, `lykia_orders`, `lykia_dev_tools` (plus Circle status and Agent Marketplace services). |
| SDK | have | have | |
| Admin: deploy plan, recorded deployments, router settings, flags | have | have | The owner console now includes LykiaOrders and the mainnet router allowlist calls. |

## Circle and Arc developer tools

| Tool | Where Lykia uses or surfaces it |
|---|---|
| App Kits (Bridge, Swap, Unified Balance, Onramp, Earn, Borrow) | Build → Arc tools, as the alternative execution path; `DEV_TOOLS` in core |
| Circle Skills (`use-arc`, `use-usdc`, `use-gateway`, wallets) | Build → Arc tools, with the install command |
| Arc docs MCP server | Build → Arc tools, next to Lykia's own MCP |
| Arc Foundry, EVM differences, contract addresses, ERC-8004 tutorial, agentic economy, Arc Studio CLI | Build → Arc tools |
| Gateway, CCTP, StableFX, Compliance, Nanopayments, Agent Marketplace, x402 | already wired (`/app/circle`, `lykia_circle_services`, `/v1/circle/*`) |

Sources: Arc's documentation index (docs.arc.io/llms.txt, read 2026-11-01) and DefiLlama (api.llama.fi/protocols, read 2026-11-01).

## Deploy: LykiaOrders

1. Owner console (`/owner`) on mainnet: earlier steps already recorded (factory `0x810e…f7f9`, router `0xc9c0…5d18`) show as done. The next step is `LykiaOrders(owner, LykiaRouter, 100, 0x8c52…ca1e)`, a direct CREATE from the owner wallet. The router argument resolves from the recorded router.
2. Run the init calls: `LykiaRouter.setVenue(SwapRouter02 0x53bf…6f77, true)` and `setVenue(Aerodrome Slipstream Metarouter 0x0fef…ee98, true)`. The on-chain allowlist is empty today, so orders cannot swap until these are sent.
3. Record the deployment (the API checks creator, receipt and runtime code), then add the address to `packages/core/src/contracts/deployments.ts`.
4. Optional: set `LYKIA_KEEPER_PRIVATE_KEY` (gas only) and `CRON_SECRET`, and schedule `/cron/orders` and `/cron/alerts` every minute on serverless hosts.
5. Telegram: create a bot, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`, then call `POST /v1/telegram/setup { publicApiUrl }` as admin.

Until step 1 runs, `/app/orders` explains that the contract is not deployed and keeps the Prepare button off. Every other new feature is live without a deployment.
