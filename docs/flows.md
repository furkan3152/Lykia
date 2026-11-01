# Flows on Arc mainnet: prove it

Every money flow Lykia offers, with its exact prepared calldata simulated on
Arc mainnet by `eth_call`. Nothing was signed or broadcast.

Run it yourself:

```
npm run prove -w @lykia/api          # PROVE_OWNER=0x… changes the sender
```

## How each flow is checked

1. **Plan.** The real planner plans the flow as a dry run: live quotes and
   rates, Lykia's 1% fee, the Fence verdict and the mainnet beta cap.
2. **Build.** The same adapters `prepare` uses build every step's calls:
   allowances re-read, quotes re-checked against the planned minimum, the
   fee transfer in the batch, and the value-moving call wrapped in its Arc
   Memo.
3. **Simulate.** All steps run as one `Multicall3From.aggregate3` eth_call
   from the owner, so later steps see what earlier steps did and msg.sender
   stays the owner (CallFrom).
4. **Fund (only when needed).** Inputs the sender does not hold are funded
   with state overrides:
   - native USDC through the balance (USDC's ERC-20 face reads it);
   - other tokens through their balance mapping slot, found by probing
     (Solidity, Vyper and OpenZeppelin ERC-7201 layouts).
5. **Agent operations.** These run against the deployed LykiaAccountFactory
   (`0x810e…f7f9`), all inside one batch:
   - the account is created, funded and given a session with Fence caps for
     a fresh agent key;
   - the agent's EIP-712 signed `agentTransferWithSig` follows in the same
     batch.

   The refusals are on-chain errors from the account itself.

Wallet types:

- **EOA** (`eth_sendTransaction`): one transaction per step, as simulated
  here.
- **Passkey smart account** (user operation): the same calls run as plain
  calls from the account. The same batch simulation with a contract as the
  sender passes, checked with a deployed Safe singleton and with the
  predicted LykiaAccount address.

## Matrix (2026-11-01, sender 0xada5…f7cb)

Result key:

- **PASS:** every call succeeded.
- **REFUSED (expected):** the Fence or the account refused, as designed.
- **GATED:** the contract is not deployed.

| Flow | Result | Detail |
|---|---|---|
| Send 25 USDC with a memo to an allowlisted payee | PASS | 2 calls ok at block 29041422. Send 25 USDC to 0x2222…2222 (invoice 7) [fee 250000 USDC units]. Fence confirm. Funded: USDC (native balance override). |
| Send 20 EURC | PASS | 2 calls ok at block 29041422. Send 20 EURC to 0x2222…2222 [fee 200000 EURC units]. Fence confirm. Funded: EURC (storage override). |
| Send 15 MXNB (partner stablecoin, priced at its peg) | PASS | 2 calls ok at block 29041422. Send 15 MXNB to 0x2222…2222 [fee 150000 MXNB units]. Fence confirm. Funded: MXNB (storage override). |
| Send 15 GBPA (no GBP price on Arc) | REFUSED (expected) | Fence deny: This step has no USD price; caps cannot be checked.; This step has no USD price; the beta cap cannot be checked. |
| Send 0.01 WETH | PASS | 2 calls ok at block 29041422. Send 0.01 WETH to 0x2222…2222 [fee 100000000000000 WETH units]. Fence confirm. Funded: WETH (storage override). |
| FX 100 USDC → EURC | PASS | 3 calls ok at block 29041432. Convert 99 USDC -> 88.736515 EURC on Aerodrome Slipstream USDC/EURC (min 88.292832) [fee 1000000 USDC units]. Fence allow. Funded: USDC (native balance override). |
| FX 100 EURC → USDC | PASS | 3 calls ok at block 29041432. Convert 99 EURC -> 110.398993 USDC on Aerodrome Slipstream USDC/EURC (min 109.846998) [fee 1000000 EURC units]. Fence allow. Funded: EURC (storage override). |
| Swap 100 USDC → cirBTC | PASS | 3 calls ok at block 29041432. Swap 99 USDC -> 0.00127392 cirBTC on Uniswap v3 0.01% pool (min 0.00126755) [fee 1000000 USDC units]. Fence allow. Funded: USDC (native balance override). |
| Swap 50 USDC → WETH | PASS | 3 calls ok at block 29041440. Swap 49.5 USDC -> 0.021694205870074762 WETH on Uniswap v3 0.3% pool (min 0.021585734840724388) [fee 500000 USDC units]. Fence allow. Funded: USDC (native balance override). |
| Earn: deposit 200 USDC (best vault or Aave) | PASS | 3 calls ok at block 29041440. Deposit 198 USDC into Aave V4 Main Spoke [fee 2000000 USDC units]. Fence allow. Funded: USDC (native balance override). |
| Earn: deposit 100 EURC | PASS | 3 calls ok at block 29041440. Deposit 99 EURC into Morpho Galaxy EURC [fee 1000000 EURC units]. Fence allow. Funded: EURC (storage override). |
| Earn: deposit 100 USDC into Morpho Galaxy, then withdraw 50 (one batch) | PASS | Approve 100 USDC to Morpho Galaxy USDC → Deposit 100 USDC into Morpho Galaxy USDC (with Arc memo) → Withdraw 50 USDC from Morpho Galaxy USDC (with Arc memo) (block 29041440) |
| Aave V4: supply 100 USDC, then withdraw all | PASS | Approve 100 USDC to Aave V4 Main Spoke → Supply 100 USDC to Aave V4 Main Spoke (with Arc memo) → Withdraw all USDC from Aave V4 Main Spoke (with Arc memo) (block 29041440) |
| Borrow 300 USDC against cirBTC (health ≥ 1.8, best venue) | PASS | 4 calls ok at block 29041440. On Morpho cirBTC/USDC 86%: post 0.00824675 cirBTC and borrow 300 USDC (health factor 1.8360 after, floor 1.8) [fee 3000000 USDC units]. Fence allow. Funded: cirBTC (storage override). |
| Aave V4: post 0.01 cirBTC, borrow 200 USDC, repay 200 USDC (one batch) | PASS | Approve 0.01 cirBTC to Aave V4 Main Spoke → Supply 0.01 cirBTC as collateral → Use cirBTC as collateral → Borrow 200 USDC from Aave V4 Main Spoke (with Arc memo) → Approve 200 USDC to Aave V4 Main Spoke → Repay 200 USDC on Aave V4 Main Spoke (with Arc memo) (block 29041440) |
| Morpho Blue: post 0.01 cirBTC, borrow 200 USDC, repay 200 USDC (one batch) | PASS | Approve 0.01 cirBTC to Morpho Blue → Post 0.01 cirBTC on Morpho cirBTC/USDC 86% → Borrow 200 USDC on Morpho cirBTC/USDC 86% (with Arc memo) → Approve 200 USDC to Morpho Blue → Repay 200 USDC on Morpho cirBTC/USDC 86% (with Arc memo) (block 29041449) |
| Borrow 1000 USDC on cirBTC and put it to work (health ≥ 1.8) | PASS | 7 calls ok at block 29041449. On Morpho cirBTC/USDC 86%: post 0.02748912 cirBTC and borrow 1000 USDC (health factor 1.8360 after, floor 1.8) [fee 10000000 USDC units] → Deposit 980.1 USDC into Aave V4 Main Spoke [fee 9900000 USDC units]. Fence confirm. Funded: cirBTC (storage override). |
| CCTP V2 out: bridge 50 USDC to Base (standard) | PASS | 3 calls ok at block 29041449. Bridge 49.5 USDC to Base over CCTP [fee 500000 USDC units]. Fence confirm. Funded: USDC (native balance override). |
| Gateway: deposit 40 USDC into the unified balance | PASS | 3 calls ok at block 29041449. Deposit 39.6 USDC into Circle Gateway (one balance on every Gateway chain) [fee 400000 USDC units]. Fence confirm. Funded: USDC (native balance override). |
| Complex intent: 40% best vault, 20% to EURC, bridge the rest to Base (of 500 USDC kept as base) | PASS | 9 calls ok at block 29041449. Deposit 198 USDC into Aave V4 Main Spoke [fee 2000000 USDC units] → Convert 99 USDC -> 88.736515 EURC on Aerodrome Slipstream USDC/EURC (min 88.292832) [fee 1000000 USDC units] → Bridge 193.05 USDC to Base over CCTP [fee 1950000 USDC units]. Fence confirm. Funded: USDC (native balance override). |
| Convert 500 USDC to EURC, then pay 200 EURC for invoice 7 | PASS | 5 calls ok at block 29041457. Convert 495 USDC -> 443.681617 EURC on Aerodrome Slipstream USDC/EURC (min 441.463208) [fee 5000000 USDC units] → Send 200 EURC to 0x2222…2222 (invoice 7) [fee 2000000 EURC units]. Fence confirm. Funded: USDC (native balance override). |
| Beta cap: send 1500 USDC under a loose Fence | REFUSED (expected) | Fence deny: Beta: $1515 is above the $1000 per-step cap that applies to everyone while Lykia's contracts are unaudited. |
| Fence: Shepherd refuses a stranger | REFUSED (expected) | Fence deny: 0x2222…2222 is not the owner. |
| Tag register (ERC-8004 IdentityRegistry.register) | PASS | eth_call from the owner to 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 |
| Agent: create LykiaAccount → fund → session with Fence limits → agent transfer within caps | PASS | account 0x437E6d21573D33dEeFDFF13653EcA9E516156b06, session key 0x31Adc4…: 20 USDC to the allowlisted payee passed |
| Agent: transfer above the per-call cap | REFUSED (expected) | agent pays 30 USDC to 0x2222…: PerCallCapExceeded(0x3600000000000000000000000000000000000000, 30000000, 25000000) |
| Agent: transfer to a recipient outside the session | REFUSED (expected) | agent pays 5 USDC to 0x3333…: RecipientNotAllowed(0x3333333333333333333333333333333333333333) |
| Agent: revoke, then the agent tries again | REFUSED (expected) | agent pays 5 USDC to 0x2222…: SessionInvalid(0x195d7d95cc8e44b6a35e24c10c199aa23bda5ff5fdb58918404e0fdf96501f4b) |
| Agent: Whistle blown, then a payment to a stranger | REFUSED (expected) | agent pays 5 USDC to 0x2222…: WhistleBlownOnlyHomeward() |
| LykiaOrders (limit, stop-loss, DCA, TWAP) | GATED | Not deployed on mainnet: the Orders page shows “deploy from the owner console”. |

## Flows that are not an eth_call

| Flow | Status |
|---|---|
| CCTP V2 inbound mint | `POST /v1/cctp/inbound` returns the unsigned `MessageTransmitterV2.receiveMessage` once Iris attests the burn. Simulating it needs a real attested burn from another chain. |
| CCTP fast transfer and forwarding | Not built yet. Outbound burns use the standard finality threshold (2000), which Arc reaches on inclusion. |
| x402 purchases | Paid with an EIP-3009 authorization the buyer signs off chain; the facilitator settles it. There is no transaction from the buyer to simulate. |
| Request and receive | The Move page's Receive tab shows a payment link and an EIP-681 QR code. Paying it is the send flow above. |
| Standing orders | They plan through the same planner when they fire, so they are covered by the rows above. |
| LykiaOrders | Waits for the owner to deploy it from the owner console. |
| Router split swaps | Both legs run atomically through LykiaRouter only when the owner has allowlisted the venues (`setVenue`). Until then the legs run as separate steps, as in the FX rows. |

## Partner stablecoins without a price

GBPA, CHFAU, SEKAU, TRYB and ZARU have no USD price on Arc. Chainlink has no
GBP, CHF, SEK, TRY or ZAR feed there, and Pyth's are not pushed to Arc. The
Fence therefore cannot check caps for them and refuses moves of these tokens
("no USD price"), as the GBPA row shows. AUDD, AUDF, BRLA, CADD, EURAU,
JPYC, KRW1, MXNB and QCAD are priced at their peg and work like USDC (see
the MXNB row).

## UI checks

The Playwright dry-run checks are in `apps/web/e2e/move.e2e.mjs` (`npm run e2e:move -w @lykia/web`; 12/12 passed). They run
at desktop and mobile widths with a mock wallet that answers
`eth_requestAccounts` and `eth_chainId`, records every
`eth_sendTransaction` and returns a fake hash. The API is mocked at the
network layer. The checks cover:

- Send: the token picker, the contact book, planning and the transaction
  the wallet receives;
- Receive: the link and the QR code;
- the network switch banner;
- the clear errors (beta cap, insufficient balance).
