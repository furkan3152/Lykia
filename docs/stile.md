# Stile: a leash that spends from a Gateway balance

Stile is not a separate product. It is an option inside [Leash](leash.md):
when you create a leash, **Spend from** is either **Arc wallet** (your
LykiaAccount, as before) or **Gateway balance** (your Circle Gateway USDC).
Same limits, same Revoke, same trail, same endpoints.

> **Unaudited.** `LykiaStile` is new and has not been audited. While it is
> unaudited a Gateway leash allows **at most $100 per transfer and $300 per
> rolling day**. Every Stile carries these ceilings as immutables, so no
> session can be issued above them on chain either. The feature is off
> (`LYKIA_STILE=off`) until the owner has run the steps at the end of this
> page.

## Why

Circle Gateway lets a depositor add a delegate
(`addDelegate(token, delegate)` on Gateway Wallet). A delegate gets a **full
allowance** over the deposit: it can sign burn intents for any amount, to
any recipient, on any chain, until it is removed. Teams either hand an ops
agent that full power or sign every transfer by hand.

Gateway also accepts **ERC-1271 contract signers**: a burn intent can be
signed by a contract, and Gateway checks it by asking the contract
(`isValidSignature`). Stile uses that. The delegate is not the agent's key
but your own `LykiaStile` contract, and the contract only says yes to
transfers the agent reserved inside the leash's limits.

## How it works

```
owner wallet ── creates ─────▶ LykiaStile (yours, on Arc)
owner wallet ── addDelegate(USDC, stile) ─▶ Gateway Wallet (Arc)
owner wallet ── createSession(agent key, limits) ─▶ LykiaStile

agent ── POST /v1/leashes/:id/plan ──▶ Lykia: Fence, beta cap, Stile spendable(), payees,
                                        chains, Gateway balance on Arc, Gateway's fee estimate
       ◀── burn intents [payment, Lykia fee] + reserve(...) transaction
agent key ── reserve(sessionId, intents, memo) ─▶ LykiaStile: checks, charges the caps,
                                                   records the EIP-712 digest, emits Reserved + StileMemo
agent ── POST /v1/leashes/:id/submit {hash} ──▶ Lykia: proves Reserved from the receipt, then
         Gateway POST /v1/transfer [{ burnIntentSet, signature: abi.encode(sessionId), contractSigner: true }]
Gateway ── simulates isValidSignature(digest, signature) on the Stile ──▶ magic value ─▶ attestation
anyone ── gatewayMint(attestation, signature) on the destination ──▶ payee and Lykia's fee minted together
```

1. **Create** (`POST /v1/leashes` with `"spendFrom": "gateway"` and
   `"destinations": ["arc", "base", ...]`). The response has up to three
   unsigned transactions from your wallet, to send in order with nothing in
   between: the Stile's creation (first time only; its address is
   predicted from your wallet's nonce, so another transaction in between
   would move it), `addDelegate(USDC, stile)` on Gateway Wallet (when the
   Stile is not a delegate yet), and `createSession` on the Stile with the
   agent's key, per-transfer, daily and lifetime caps, Gateway's fee per
   intent, the destination domains, the payees and the Fence hash.
2. **Plan** (`POST /v1/leashes/:id/plan`, e.g. `"pay 25 USDC to 0x… on
   base"`). Lykia checks the Fence with the leash's own spend and the beta
   cap, the Stile's `spendable()`, the payee and chain lists, and your
   Gateway balance on Arc. It builds two burn intents, the payment and
   Lykia's fee leg (same destination, minted to Lykia's fee address), takes
   `maxFee` and `maxBlockHeight` from Gateway's `/v1/estimate`, and returns
   the `reserve` transaction for the agent's key, simulated on Arc.
3. **Reserve.** The agent's key sends it. The Stile checks the intents,
   charges its caps (payment plus fee) and records the digest for one hour.
4. **Submit** (`POST /v1/leashes/:id/submit` with the hash). Lykia checks the
   transaction is the prepared one and that its receipt carries `Reserved`
   with the digest and `StileMemo` with the intent, step and verdict, then
   posts the set to Gateway with `contractSigner: true`. The attestation and
   the unsigned `gatewayMint` for the destination come back
   (`destinationCaller` is open, so anyone may send it), or with
   `"forward": true` at plan time Circle's Forwarding Service mints.
   If Gateway cannot see the reservation yet (see the staleness window),
   submit says `pending`; send the same hash again a minute later.
5. **Trail** (`GET /v1/leashes/:id/trail`) joins three sources: `Reserved`
   and `StileMemo` on Arc (with the verdict digest's tag), Gateway's own
   transfer record (`GET /v1/transfer/{id}`, polled), and `AttestationUsed`
   with the payment's `transferSpecHash` on the destination's mint receipt.
   For Arc as destination the mint is read from Arc; for other chains it is
   read when `LYKIA_GATEWAY_RPC_<CHAIN>` names an RPC for that chain, and
   otherwise reported as unknown (`attestationUsed: null`).

## What Gateway validates (from Circle's documentation)

Read on 2026-11-08 from Circle's primary sources:

- [ERC-1271 programmable authorization](https://developers.circle.com/gateway/references/erc-1271.md):
  a request opts in with `contractSigner: true` next to the burn intent and
  the signature; the burn intent's `sourceSigner` is the contract. Gateway
  routes it to a validation service in an AWS Nitro Enclave that
  **simulates `isValidSignature`** against a recent block through **several
  independent RPC providers; at least 2 of 3 must agree**. The enclave then
  signs the burn, and Gateway Wallet accepts that enclave signature on
  chain. Stated limits: EVM only; **read-only validation** (logic that
  changes state during validation is not supported); blocks **up to 5
  minutes old** may be used, so key rotation or revocation may take up to 5
  minutes to apply; RPC trust assumptions; you remain responsible for your
  signing contract. Gateway Nanopayments do not use this path.
- [How-to: Transfer USDC from a smart contract account](https://developers.circle.com/gateway/howtos/transfer-with-erc-1271.md):
  the signature is opaque bytes that make `isValidSignature` return
  `0x1626ba7e`; post `{ burnIntent, signature, contractSigner: true }`; do
  not split the signature into v, r, s.
- [How-to: Manage delegates](https://developers.circle.com/gateway/howtos/manage-delegates.md)
  and the [technical guide](https://developers.circle.com/gateway/references/technical-guide.md):
  a delegate has a full allowance; it can be an EOA or an ERC-1271 contract;
  delegation is per Gateway Wallet (per chain); after `removeDelegate`,
  burn intents the delegate already signed stay valid for burning, and the
  API reflects the removal once it is final on chain. Burn intents may be
  packed into a burn intent set (EVM only, at most 16 per request).
  Attestations expire after 10 minutes. A burn intent's `maxBlockHeight`
  must be at least the wallet's `withdrawalDelay` ahead.
- [Contract addresses](https://developers.circle.com/gateway/references/contract-addresses.md):
  Arc is domain 26; Gateway Wallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
  (testnet) and `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` (mainnet);
  Gateway Minter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` (testnet) and
  `0x2222222d7164433c4C09B0b0D809a9b52C04C205` (mainnet).
- [Circle's Gateway contracts](https://github.com/circlefin/evm-gateway-contracts)
  (`src/modules/wallet/Burns.sol`, `src/lib/BurnIntentLib.sol`,
  `src/lib/TransferSpecLib.sol`, `src/lib/EIP712Domain.sol`): the digest
  passed to `isValidSignature` is the EIP-712 hash of the burn intent (or of
  `BurnIntentSet(BurnIntent[] intents)`) in the domain `{name:
  "GatewayWallet", version: "1"}` with no chain id or verifying contract.
  On chain, a burn is accepted from the depositor's own signature, from the
  enclave's signature vouching for a contract signer, or, for contracts
  Circle allowlisted, from an on-chain ERC-1271 check. The signer must have
  been authorised for the balance at some point (revoked delegates still
  count, so revocations cannot block burns already attested).
- Circle's docs state **no gas or size limit** for `isValidSignature`.
  Stile keeps it to a handful of storage reads (about 32,500 gas in an
  `eth_call` on Arc testnet).
- The [OpenAPI](https://developers.circle.com/openapi/gateway.yaml) for
  `/v1/transfer` does not list `contractSigner` in its `SignedBurnIntent`
  schemas, while the two pages above document it; Gateway's testnet API
  accepted it (see the evidence below).

## What Stile enforces

`packages/contracts/contracts/stile/LykiaStile.sol`. The owner is the
depositor and the only admin; there is no ownership transfer.

| Check | Where |
|---|---|
| Only the session's key can reserve | `reserve` |
| Session alive: not revoked, before `validUntil`, Stile not paused | `reserve`, `isValidSignature`, `spendable` |
| Per-transfer, rolling 24 h (five 6 h buckets) and lifetime caps, charged with payment **plus Lykia's fee** | `reserve` |
| No session above the immutable ceilings ($100 / $300 while unaudited) | `createSession`, `updateSession` |
| Destination domain on the session's list | `reserve` |
| Payee on the session's list (or `anyRecipient`; Lykia's API never sets it) | `reserve` |
| Source: Arc's domain, Gateway Wallet, USDC, the owner's deposit, signed by this Stile, Gateway Minter as destination contract, empty hook data, value above zero | `reserve`, for every intent |
| Gateway's `maxFee` per intent at most the session's `maxGatewayFee` | `reserve` |
| With a Lykia fee: exactly two intents `[payment, fee]`, the fee on the same destination, to the fee recipient, at least `feeBps` of the payment, rounded up | `reserve` |
| A digest is reserved once; it validates for one hour (or until the session ends) | `reserve`, `isValidSignature` |
| `isValidSignature` returns `0x1626ba7e` only for a reserved, unexpired, uncancelled digest whose signature is exactly `abi.encode(sessionId)`, while the session is alive and the Stile not paused; otherwise `0xffffffff`. It never writes and never reverts. | `isValidSignature` |
| Owner switches: `createSession`, `updateSession`, `setDestinations`, `setRecipients`, `revokeSession`, `setPaused` (global), `cancelReservation` | owner (the session key may also revoke its own session and cancel its own reservations) |

**Hash binding, not signature decoding.** `reserve` takes the full burn
intents and recomputes Gateway's EIP-712 digest from the fields it checked.
`isValidSignature` then only needs the digest: a digest that hashes to the
same value as the checked fields cannot describe a different transfer. The
signature bytes carry nothing but the session id; nothing is decoded from
them. The test suite pins the hashing against independent encoders and
Circle's published type hashes, and against a real Arc testnet transfer:
Stile's `transferSpecHash` of the spec Gateway returns for
`0xa604e143…0eee` equals the hash GatewayMinter emitted in
`AttestationUsed` (tx `0x7d622753…2381`, block 71305366).

**Lykia's fee.** A Gateway transfer never passes through a Lykia
transaction, so the fee cannot be a transfer inside the same Arc batch as
for other steps. Instead every reservation is a burn intent **set** of two:
the payment and a fee leg of at least 1% (Lykia's fee for transfers, set
when the Stile is created) minted to Lykia's fee address on the same
destination. Only the set's digest is reserved, so Gateway attests both or
neither, and `gatewayMint` mints both in one transaction. The agent cannot
submit the payment alone: its single digest is not reserved. The leash's
caps count payment plus fee; Circle's own fee comes on top of both (Arc's
source gas fee is about $0.0035 per intent, plus 0.005% of the value for a
crosschain transfer).

## What the API enforces

The same Fence as for any step (kinds `transfer`, venue `gateway`, USDC
only, the payee allowlist, per-step, per-day and lifetime USD caps), the
mainnet beta cap, Scent, the schedule, plus: the leash's chain list, the
Gateway balance on Arc, Gateway's fee estimate against the session's
`maxGatewayFee`, and a simulation of `reserve` from the agent's key before
anything is returned. The key stops at once on revoke or expiry.

## Threat model

| Threat | What holds |
|---|---|
| The agent's key leaks | It can reserve only inside the session: capped amounts, listed payees and chains, until expiry. Revoke at the API (instant) and on the Stile; pause the Stile; remove it as a delegate. |
| The agent skips Lykia and talks to Gateway directly | Gateway still asks the Stile; only reserved digests validate, and reserving charges the on-chain caps. Skipping Lykia only loses the Fence's off-chain checks (Scent, schedule), never the on-chain caps. |
| The agent submits the payment without the fee | Only the set digest `[payment, fee]` is reserved. |
| The agent reserves and never submits | The reservation stays charged (no refunds; the Stile cannot know whether Gateway attested it) and stops validating after one hour. |
| A burn intent that changes source, depositor, token, hook data or signer | Refused by `reserve`; Gateway would also refuse a mismatched source. |
| Lykia's API is compromised | It cannot sign for you: the agent's key reserves and only within the Stile's session, which only your wallet can create or widen. |
| Gateway's validation is stale | See the window below. Revocation is not instant at Gateway. |
| RPC providers lie to Gateway's enclave | Circle's quorum (at least 2 of 3 independent providers) mitigates it; it is Circle's stated trust assumption. |
| Circle allowlists the Stile for on-chain ERC-1271 checks | Then a burn would re-check `isValidSignature` on chain at burn time, possibly after the one-hour reservation expired. Stile is built for the enclave path Circle documents for contract signers; Lykia has not asked for the allowlist. |
| A bug in LykiaStile | Unaudited: hence the $100 / $300 ceilings, the global pause and removeDelegate as the hard stop. |

## The staleness window

Gateway may validate `isValidSignature` against a block **up to about 5
minutes old**. Two consequences:

- **Revocation.** `revokeSession`, `setPaused(true)` or `removeDelegate`
  take effect on Arc at once, but Gateway may still see the older state for
  up to about 5 minutes. A reservation made before the revocation can
  therefore still be attested in that window, and a transfer Gateway already
  attested cannot be called back (its burn is guaranteed by design). The
  leash key stops at the API immediately, so no new reservation is
  prepared by Lykia.
- **Fresh reservations.** A reservation mined a moment ago may not be visible
  to Gateway yet. Submit reports `pending` with Gateway's reason; send the
  same hash again. The reservation stays usable for an hour.

## Limits

- **Source: Arc only.** The Stile lives on Arc, so it can spend the part of
  your Gateway balance deposited **on Arc** (domain 26). Deposits on other
  chains need a delegate on those chains; Stile does not cover them. The
  leash sheet shows the balance per chain and says which part is reachable.
  Destinations are any EVM chain Gateway reaches from Arc.
- One transfer per plan; Pay invoices template only (named payees).
- USDC only; EVM destinations only.
- At most $100 per transfer and $300 per rolling day while unaudited, in
  addition to the mainnet beta cap.
- The owner must be an EOA wallet (the Stile is created from it and it is
  the Gateway depositor). Passkey smart accounts cannot send the creation.
- Gateway Nanopayments do not use ERC-1271 and are not covered.

## Evidence gathered without keys (2026-11-08)

`/v1` endpoints and Arc testnet, nothing signed or broadcast:

- `GatewayWallet.withdrawalDelay()` is 1,209,600 blocks and `domain()` is 26
  on both Arc testnet and mainnet (`eth_call`).
- The Stile's creation runs on Arc testnet as an `eth_call` (13,724 bytes of
  runtime, about 3.05 M gas).
- Gateway's testnet `/v1/estimate` accepted a two-intent request whose
  `sourceSigner` is a Stile address (maxFee 3,850 base units per intent,
  maxBlockHeight about 1.38 M blocks ahead).
- With the Stile's code and storage placed by `eth_call` state overrides on
  Arc testnet: `reserve` from the session key succeeds and returns the
  digest that viem's EIP-712 encoder computes for the set; from any other
  address it reverts with `NotSessionKey`; `isValidSignature` returns
  `0x1626ba7e` for the reserved digest and `0xffffffff` when the digest is
  not reserved, the session is revoked, the Stile is paused or the
  reservation expired (about 32,500 gas).
- Gateway's testnet `/v1/transfer` accepted the shape `[{ burnIntentSet,
  signature, contractSigner: true }]` and answered `400 Invalid signature:
  contract signature verification request failed` for a Stile that does not
  exist on chain: the request reached the contract-signer check.

What this cannot show without signing: Gateway attesting a real Stile
transfer and the mint landing. That is the owner's step 2 below.

## Owner steps (from a phone)

Everything below is done from your own wallet; nobody else holds a key.
Use a browser wallet (not a passkey account) on Arc.

**1. Deploy on Arc testnet**

1. Get testnet USDC from the Circle faucet and deposit some into Gateway on
   Arc testnet (the Circle card in the app, or a Gateway deposit in Ask
   Lyko). Wait for the deposit to finalize.
2. Find the address your Stile will get: `OWNER=0xYou ENV=testnet npm run
   stile:plan -w @lykia/contracts` prints `predictedAddress` (from your
   wallet's next nonce; send nothing else from that wallet until step 4).
3. In Render, set `LYKIA_STILE=testnet` and `LYKIA_STILE_REFERENCE_TESTNET`
   to that address, and redeploy the API. The Gateway option now shows on
   testnet only.
4. In the app (network toggle on testnet): Fold, Pack tab, **+ New leash**.
   Who: a name, Pay invoices, "Make one in this browser". Spend from:
   **Gateway balance**, pick Arc and Base. Limits: $5 a day, $5 a step, 1
   day, your own second address as payee. Create, store the keys, then
   **Sign once**: your wallet creates your LykiaStile, adds it as a Gateway
   delegate and creates the session (three prompts, in that order). The
   sheet's first prompt shows the same address as step 2.
5. Check it (read-only): `OWNER=0xYou STILE=0xStile ENV=testnet npm run
   stile:check -w @lykia/contracts`. Every line must say `pass: true`. If
   the address differs from step 2, put the real one in
   `LYKIA_STILE_REFERENCE_TESTNET`.

**2. Run the end-to-end test on testnet**

1. With the leash key: `POST /v1/leashes/:id/plan` with `{"text": "pay 1
   USDC to 0xPayee on base"}` (or the agent through MCP, `leash_plan`).
2. Send `prepared.transaction` from the session key (the private key the
   sheet showed once; any wallet that can import a key, with a little
   testnet USDC for gas on Arc).
3. `POST /v1/leashes/:id/submit` with `{intentId, stepId, hash}`. If it says
   `pending`, wait a minute and repeat. It returns the attestation and the
   `gatewayMint` call.
4. Send `gatewayMint` on Base Sepolia from any wallet (or plan with
   `"forward": true` and let Circle mint).
5. Open the trail: the item must be chain-proven (Reserved and StileMemo),
   Gateway's status `confirmed` or `finalized`, and the payee must hold the
   USDC on Base Sepolia, with 1% minted to Lykia's fee address.
6. Try to break it: plan above the cap, to another payee, to a chain not on
   the list, after revoking (wait 5 minutes and confirm Gateway refuses).

**3. Deploy on Arc mainnet from your wallet**

Repeat step 1 on mainnet, at small amounts. `LYKIA_STILE` stays
`testnet` for now, so nobody else sees the option on mainnet: send the
creation and `addDelegate` that `OWNER=0xYou ENV=mainnet npm run
stile:plan -w @lykia/contracts` prints from your wallet (any wallet that
can send a transaction with raw data and no recipient), then run
`stile:check` with `ENV=mainnet`. To try one $1 transfer through the API
before the switch, point a local or staging API at mainnet with
`LYKIA_STILE=mainnet` and your Stile as `LYKIA_STILE_REFERENCE_MAINNET`,
and run step 2 there.

**4. Switch the flag on**

Only after steps 1 to 3 passed: set `LYKIA_STILE=mainnet` (or `on`) and
`LYKIA_STILE_REFERENCE_MAINNET` to your mainnet Stile, redeploy the API.
The Gateway option in the leash sheet stops saying "coming soon". Turning
the flag off again hides it for new leashes; existing Stiles keep working
for their owners until revoked, paused or removed as delegates.
