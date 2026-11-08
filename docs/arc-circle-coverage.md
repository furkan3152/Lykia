# Arc and Circle coverage

What Arc Network and Circle offer, whether Lykia uses it, whether it uses it
the way the documentation says, and what is still missing. Every row cites
the page it was checked against. Read from docs.arc.io and
developers.circle.com (and agents.circle.com) on 2026-11-04; contract
addresses were checked with `eth_getCode` on `rpc.mainnet.arc.io` and
`rpc.testnet.arc.io` the same day.

Status words: **used** (Lykia calls it, matching the docs), **fixed** (used,
and corrected in this pass), **added** (integrated in this pass), **listed**
(recognised and documented, not called), **gap** (useful, not done yet),
**n/a** (not relevant to Lykia or not available on Arc).

## Arc Network

| Capability | Status | Where in Lykia | Notes | Doc |
|---|---|---|---|---|
| Chain ids 5042 / 5042002, RPC, explorer, faucet | used | `packages/core/src/networks.ts` | `eth_chainId` 0x13b2 / 0x4cef52 re-checked. | https://docs.arc.io/arc/references/connect-to-arc |
| Partner RPC endpoints (dRPC, QuickNode, Blockdaemon) | added | `networks.ts` `fallbackRpcUrls`, `apps/api/src/chains/arc.ts` | The primary is load-balanced and can answer `-32014` near the head; the documented keyless providers are tried next. All six answered `eth_chainId`. | https://docs.arc.io/arc/references/rpc-endpoints |
| `eth_getLogs` 10,000-block window (`-32012`) | used | `engine/userop.ts` (`LOG_WINDOW` 9,999), `networks.ts` | Windows are inclusive 10,000 blocks, within the limit. | https://docs.arc.io/arc/references/rpc-endpoints |
| USDC as gas, native 18 decimals vs ERC-20 6 decimals, one balance | used | `assets.ts`, `contracts.ts`, prove state overrides (`units * 1e12`) | Lykia moves USDC through the ERC-20 face (6 decimals), as the docs recommend, and never shows two balances. | https://docs.arc.io/arc/concepts/stablecoin-native-model |
| EIP-7708 native `Transfer` logs from `0xffff…fffe` | fixed | `alerts/service.ts`, `networks.ts` `ARC_NATIVE_TRANSFER_EMITTER`, `track/service.ts` | USDC transfer alerts read the ERC-20 emitter only, which misses plain native sends; they now read the system emitter (18 decimals). Invoice reconciliation keeps the ERC-20 log on purpose: an invoice payment carries an Arc Memo, which only wraps ERC-20 calls. | https://docs.arc.io/arc/references/usdc-system-events |
| 20 gwei `maxFeePerGas` floor, EWMA base fee, fee in USDC | used | Unsigned transactions leave fees to the signer; keepers use viem's fee estimation (`eth_feeHistory`), which stays above the floor. | Gas is shown in USDC in quotes. | https://docs.arc.io/arc/references/gas-and-fees |
| Deterministic sub-second finality | used | `engine/service.ts` (a receipt settles a step; no confirmation counting) | Matches the two-state model (pending or final). | https://docs.arc.io/arc/concepts/deterministic-finality |
| Value-transfer rules: no `address(0)`, runtime blocklist (reverts still pay gas) | used | `security/recipients.ts` (`isBlacklisted` read before planning) | Blocklisted recipients are caught before a reverting, gas-paying transaction. | https://docs.arc.io/arc/references/evm-differences |
| `PREVRANDAO` = 0, no blobs, EIP-4788 empty | n/a | Lykia contracts use none of them. | | https://docs.arc.io/arc/references/evm-differences |
| EIP-7702 set-code transactions | gap | | Supported on Arc. Would let an owner EOA keep its address and gain session keys without a separate smart account; Memo and Multicall3From need an EOA caller, so this needs testing before use. | https://docs.arc.io/arc/references/evm-differences |
| Transaction memos (`Memo`, CallFrom) | used | `engine/calls.ts` `withMemo` | EOA only, as the docs require; smart accounts get plain calls. The verdict digest and intent id ride in every memo. | https://docs.arc.io/arc/concepts/transaction-memos |
| Batched transactions (`Multicall3From.aggregate3`) | used | `engine/calls.ts` `batched`, `engine/simulate.ts` | `allowFailure: false` for execution, no value forwarding, EOA caller. | https://docs.arc.io/arc/concepts/batched-transactions |
| Blocklist monitoring through Memo / Multicall3From | used | `security/decode.ts` unwraps both before screening leaf calls | | https://docs.arc.io/integrate/infrastructure/compliance |
| Account abstraction: EntryPoint v0.6 / v0.7 / v0.8 | used | `engine/userop.ts` | All three have code on both networks (checked). | https://docs.arc.io/arc/tools/account-abstraction |
| ERC-4337 paymaster funded in native USDC | n/a | | Lykia runs no paymaster; Circle Gas Station covers Circle SCA wallets. | https://docs.arc.io/integrate/relayers-and-paymasters/deploy-a-paymaster |
| EIP-3009 relayer (gasless USDC transfers) | used | `circle/x402buyer.ts` (`transferWithAuthorization` typed data for x402) | Lykia signs nothing; the facilitator relays. | https://docs.arc.io/integrate/relayers-and-paymasters/eip-3009-relayer |
| Opt-in privacy (Arc Privacy Sector) | n/a | | "On the roadmap and not yet available on Arc." | https://docs.arc.io/arc/concepts/opt-in-privacy |
| Post-quantum roadmap | n/a | | Roadmap only. | https://docs.arc.io/arc/concepts/post-quantum-security |
| Arc Foundry (`arc-anvil` simulates Arc's EVM) | gap | `packages/contracts` tests run on a standard EVM | Lykia proves Arc behaviour against mainnet with `eth_call` instead (`npm run prove`); local tests cannot reproduce native-value rules. | https://docs.arc.io/arc/tutorials/install-arc-foundry |
| Arc MCP server, Arc Studio, Circle Skills | listed | `docs/circle/mcp-and-skills.md` | Developer tooling beside Lykia's own MCP. | https://docs.arc.io/ai/mcp |

## Arc contracts (all verified with `eth_getCode`, both networks)

| Contract | Status | Lykia key | Doc |
|---|---|---|---|
| USDC, EURC, USYC, cirBTC, WETH | used | `usdc`, `eurc`, `usyc`, `cirbtc`, `weth` | https://docs.arc.io/arc/references/contract-addresses |
| CCTP TokenMessengerV2, MessageTransmitterV2, TokenMinterV2 | used | `tokenMessengerV2`, `messageTransmitterV2`, `tokenMinterV2` | same |
| CCTP TokenMessengerWithFees, MessageV2, CrossChainTokenService | added (listed) | `tokenMessengerWithFees`, `messageV2`, `crossChainTokenService` | same |
| GatewayWallet, GatewayMinter | used | `gatewayWallet`, `gatewayMinter` | same |
| StableFX FxEscrow, Permit2 | used | `fxEscrow`, `permit2` | same |
| USYC Teller, Entitlements | added (called) | `usycTeller`, `usycEntitlements` | same |
| ERC-8004 Identity, Reputation, Validation registries | used | `identityRegistry`, `reputationRegistry`, `validationRegistry` | same |
| ERC-8183 AgenticCommerce (testnet only) | used | `agenticCommerce`; no code at that address on mainnet (checked) | same |
| Memo, Multicall3From, Multicall3 | used | `memo`, `multicall3From`, `multicall3` | same |
| CREATE2 factory (Arachnid) | n/a | Lykia deploys through its own scripts. | same |
| Circle Gas Station contract `0x7ceA…0a25` | listed | `circle/status.ts` evidence | https://developers.circle.com/wallets/gas-station/contract-addresses |
| Circle Paymaster v0.7 / v0.8 | n/a | No code on Arc at the published addresses (checked); gas is already USDC. | https://developers.circle.com/paymaster/addresses-and-events |

## Agents on Arc

| Capability | Status | Where in Lykia | Notes | Doc |
|---|---|---|---|---|
| ERC-8004 identity (a Tag is an identity) | used | `tag/tag.ts` | | https://docs.arc.io/arc/tutorials/register-your-first-ai-agent |
| ERC-8004 reputation into Tag standing | used | `tag/tag.ts` (`getClients`, `getSummary`) | Signatures match the tutorial ABI (`giveFeedback(uint256,int128,uint8,…)`). | same |
| ERC-8004 validation (Fence verdicts filed) | used | `tag/tag.ts`, `engine/abis.ts` | `validationRequest` / `validationResponse` match the tutorial. | same |
| ERC-8183 jobs | used (testnet) | `modules/jobs.ts` | Reference contract is testnet only, as documented. | https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job |

## Circle: crosschain

| Capability | Status | Where in Lykia | Notes | Doc |
|---|---|---|---|---|
| CCTP V2 domains (Arc = 26) | fixed | `networks.ts` `CCTP_DESTINATIONS` | Added Sonic (13), World Chain (14), Sei (16), HyperEVM (19), with chain ids and USDC addresses already used for Gateway. Codex, Monad, XDC, Ink, Plume, EDGE and others are CCTP domains too; they stay out until their chain ids and USDC addresses are taken from Circle's tables. | https://developers.circle.com/cctp/concepts/supported-chains-and-domains |
| Fast Transfer from Arc | fixed | `circle/cctp.ts`, `circle/providers.ts`, `circle/status.ts`, `protocolData.ts` | Circle lists Fast Transfer as **N/A** with Arc as the source (Arc attests after one block, ~0.5 s) and the Standard fee as 0 bps. Lykia labelled its Arc burns "Fast Transfer" and burned with threshold 1000; it now burns at 2000 and says why. Fast Transfer applies to inbound burns from slow chains. | https://developers.circle.com/cctp/concepts/fees |
| Fee API (`/v2/burn/USDC/fees`) | fixed | `circle/cctp.ts` `cctpFees` | The API reference names the middle level `medium`, the live API answers `med`; both are read now. | https://developers.circle.com/api-reference/cctp/all/get-burn-usdc-fees |
| Forwarding Service (Circle mints on the destination) | added | `engine/planner.ts` (bridge), `engine/adapters.ts`, `engine/service.ts`, `circle/cctp.ts` | The intent engine's bridge step burned with plain `depositForBurn`, leaving the user to mint on the destination with gas there. It now uses `depositForBurnWithHook` with the `cctp-forward` hook and `maxFee` = protocol fee + `med` forwarding fee, and settles when Iris reports `forwardState: COMPLETE`. If the fee cannot be read it falls back to the plain burn and says the mint is manual. Proven on mainnet (`npm run prove`). | https://developers.circle.com/cctp/concepts/forwarding-service |
| Transfer status (`/v2/messages`) | added | `circle/cctp.ts` `cctpTransferStatus`, `GET /v1/circle/cctp/status` | attestation status, `delayReason`, `forwardState`, destination mint hash. | https://developers.circle.com/api-reference/cctp/all/get-messages-v2 |
| Upfront fees (`TokenMessengerWithFees`) | gap | | Arc supports paying CCTP fees on the source so the recipient gets the exact amount. Lykia achieves the same by burning `amount + maxFee`; switching would need the upfront-fee quote API. | https://developers.circle.com/cctp/concepts/upfront-fees |
| CCTP inbound mint on Arc | used | `POST /v1/cctp/inbound` (`receiveMessage`) | | https://developers.circle.com/cctp |
| Gateway contracts, domains, gas fees | used | `circle/chains.ts` | Match Circle's tables (12 EVM chains, Arc gas fee $0.0035, 0.5 bps). | https://developers.circle.com/gateway/references/fees |
| Gateway deposit (unified balance) | used | `engine/adapters.ts` (`deposit`) | Uses `deposit` after approval; never a plain transfer to the wallet contract (which would lose funds). | https://developers.circle.com/gateway/references/technical-guide |
| Gateway balance | used | `GET /v1/circle/gateway/balance`, `flock/flock.ts` | | same |
| Gateway fee estimate (`/v1/estimate`) | added | `circle/gateway.ts` `estimateGatewayTransfer`, `draftGatewayTransferEstimated` | `maxFee` and expiry come from Circle's estimate; the published formula is the fallback for plain transfers. | https://developers.circle.com/api-reference/gateway/all/estimate-transfer |
| Gateway crosschain transfer (spend the balance elsewhere) | used | `circle/gateway.ts`, `/v1/circle/gateway/transfer*` | Source is Arc's balance; destinations are every Gateway EVM chain. Spending balances held on other chains (burn intent sets) is a gap. | https://developers.circle.com/gateway/howtos/transfer-unified-usdc-balance |
| Gateway Forwarding Service | added | `forward: true` on draft / transfer, `GET /v1/circle/gateway/transfers/:id` | `?enableForwarder=true`; the response may omit the attestation, so Lykia returns the transfer id. | https://developers.circle.com/gateway/references/forwarding-service |
| Gateway delegates | gap | | A delegate (an agent key) can spend an owner's Gateway balance while the owner keeps custody. A good fit for Fence-bound agents; needs `addDelegate` calls and a Fence rule for delegated spends. | https://developers.circle.com/gateway/howtos/manage-delegates |
| Gateway webhooks | gap | Lykia polls. | | https://developers.circle.com/gateway/webhooks |
| Gateway EURC / cirBTC | gap | USDC only. | | https://developers.circle.com/gateway/concepts/non-usdc-assets |

## Circle: FX and yield

| Capability | Status | Where in Lykia | Notes | Doc |
|---|---|---|---|---|
| StableFX quotes and trades | used | `circle/stablefx.ts` | Request and response shapes match the API reference. | https://developers.circle.com/api-reference/stablefx/all/create-quote |
| StableFX sandbox host | fixed | `STABLEFX_BASE` | Testnet calls went to `api.circle.com`; the sandbox is `api-sandbox.circle.com`. | https://developers.circle.com/stablefx/quickstarts/fx-trade-taker |
| StableFX taker funding | added | `/v1/circle/stablefx/funding/presign`, `/v1/circle/stablefx/fund` | Without funding a created trade never settles; the taker flow now ends with funding presign → signature → fund. | same |
| StableFX in the intent engine | gap | `engine/planner.ts` routes FX on chain and says so | The RFQ path needs a Fence check on the signed Permit2 amount; until then FX intents use on-chain venues checked against Chainlink. | https://developers.circle.com/stablefx |
| USYC subscribe / redeem | added | `circle/usyc.ts`, `/v1/circle/usyc/eligibility`, `/v1/circle/usyc/prepare` | Reads `Entitlements.canCall(wallet, Teller, selector)` first (fail-closed), previews with the Teller, judges with the Fence (USYC must be an allowed token), then approve + `deposit` or `redeem`. Proven on mainnet: a non-entitled wallet is refused, and the Teller reverts the same calldata. | https://developers.circle.com/tokenized/usyc/subscribe-and-redeem |
| Circle Mint, CPN, xReserve, Match | n/a | | Institutional fiat rails; Lykia does not touch fiat. | https://developers.circle.com/circle-mint |

## Circle: wallets, gas and compliance

| Capability | Status | Where in Lykia | Notes | Doc |
|---|---|---|---|---|
| Developer-controlled wallets (SCA on `ARC` / `ARC-TESTNET`) | used | `circle/wallets.ts` | Entity secret encrypted per request with Circle's public key. Lykia creates wallets and reads balances; it never submits transactions for them. | https://developers.circle.com/wallets/supported-blockchains |
| User-controlled and modular (passkey, MSCA) wallets | used (as signers) | `engine/userop.ts` resolves their user operations | Memo and Multicall3From do not work from smart accounts; Lykia sends them plain calls. | https://developers.circle.com/wallets/modular/transfer-tokens |
| Gas Station | used (Console) | SCA agent wallets, `circle/status.ts` | Sponsorship is set by Console policies; Circle publishes no policy API, so Lykia cannot create or check one. | https://developers.circle.com/wallets/gas-station/policy-management |
| Paymaster (gas in USDC) | n/a | | Not deployed on Arc; not needed. | https://developers.circle.com/paymaster |
| Compliance Engine address screening | fixed | `circle/compliance.ts`, `modules/intents.ts` | The Compliance chain enum does not list Arc. Lykia asks for `ARC` first and, on a 400, screens the same EVM address as `ETH` / `ETH-SEPOLIA` (`screenedAs`). A failed or unauthorised screening was silently ignored; it is now `UNKNOWN` with a reason, never cached, and plans say "not screened". | https://developers.circle.com/api-reference/wallets/compliance/screen-address |
| Compliance Engine embedded screening | n/a | Lykia does not submit Circle wallet transactions. | | https://developers.circle.com/wallets/compliance-engine/tx-screening |

## Circle Agent Stack

| Capability | Status | Where in Lykia | Notes | Doc |
|---|---|---|---|---|
| Agent Wallets spending policies | used | `circle/policy.ts`, `/v1/circle/policies/compile`, `/apply` | Setting or resetting a policy needs the owner's email OTP in Circle CLI; policies are per chain and mainnet-only. Lykia compiles the Fence into the exact `circle wallet limit set` commands and never claims to apply them. Verifying needs the owner to run `circle wallet limit --output json`; there is no HTTP API to read it. | https://agents.circle.com/skills/wallet-policy.md |
| Agent Marketplace Discovery API | used | `circle/discovery.ts` | Public, keyless, filtered to Arc networks. | https://developers.circle.com/agent-stack/agent-marketplace/discovery-api |
| Agent Marketplace MCP server | gap | | `https://agents.circle.com/api/mcp` (Streamable HTTP, keyless) could back Lyko's service search; the HTTP Discovery API already covers it. | https://agents.circle.com/llms.txt |
| Gateway Nanopayments (batched x402) | gap | `circle/discovery.ts` flags Gateway-scheme services; `x402buyer.ts` pays the `exact` scheme only | Paying the Gateway scheme needs a Gateway balance and batched-settlement signing. | https://developers.circle.com/gateway-nanopayments/howtos/x402-buyer |
| x402 Facilitator (Arc settlement) | used | `x402/`, `circle/sellerProof.ts` | | https://developers.circle.com/facilitator-service |
| Circle CLI | listed | Policy commands are emitted for it. | | https://developers.circle.com/agent-stack/circle-cli |
| App Kits (Bridge, Swap, Unified Balance, Earn, Borrow, Onramp) | listed | `circle/providers.ts` (`client-sdk`) | Client SDKs; Lykia's Fence is the preflight beside them. | https://docs.arc.io/app-kit |

## What the owner must do

- `CIRCLE_API_KEY` with **Compliance Engine** access (Circle grants it to
  eligible customers through its request form) for screening to run.
- A StableFX API key (`STABLEFX_API_KEY` or a Circle key with StableFX
  access) for RFQ quotes, trades and funding; testnet keys must be sandbox
  keys.
- USYC: complete Circle's USYC onboarding (non-US institutions, minimums);
  on testnet, a Circle Support ticket with the wallet address.
- Gas Station: create the sponsorship policy in the Circle Console.
- Agent Wallet policies: the owner runs the compiled `circle wallet limit
  set` commands and enters the OTP.
