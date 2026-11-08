# @lykia/contracts

Lykia's on-chain layer for Arc Network. **Not audited.** Testnet first.

| Contract | What it does |
|---|---|
| `LykiaAccount` | A smart account that carries the Fence on chain. The owner can do anything. Agents act through sessions with an expiry, a call budget, per-token caps (per call, per day, lifetime), a (target, selector) allowlist with receiver checks, a recipient allowlist and the hash of the off-chain Fence. Sessions can issue sub-sessions for sub-agents. The Whistle pauses every session at once. |
| `LykiaAccountFactory` | Deploys accounts as EIP-1167 clones at CREATE2 addresses derived from the owner, a salt, the guardian and the native-coin face. |
| `LykiaRouter` | Runs a multi-step intent atomically on allowlisted venues: exact allowances, a floor per step and for the final output, an optional integrator fee (at most 0.5%), and everything returned to the recipient in the same transaction. |
| `LykiaStile` | An ERC-1271 policy signer for a Circle Gateway deposit, one per owner, created from the owner's own wallet. The owner adds it as a Gateway delegate and issues sessions to agent keys; an agent reserves each burn intent (set) inside per-transfer, rolling daily and lifetime caps, payees, destination domains, Gateway's fee and Lykia's fee leg, and Gateway's read-only `isValidSignature` answers only for reserved digests of live sessions. Global pause. Beta ceilings ($100 / $300) as immutables. See [docs/stile.md](../../docs/stile.md). |
| `PracticeVault`, `PracticeSwap`, `PracticeLending` | Arc testnet practice venues: an ERC-4626 vault with an owner-funded yield drip, a USDC/EURC pool priced from an owner-set rate, and cirBTC-collateralized USDC borrowing with a health factor. Morpho, Uniswap and Aave V4 are not deployed on Arc testnet; these let every Lykia flow run end to end there. They are not products. |

## Sessions and sub-agents

A session is issued by the owner (`createSession`). Its limits:

- `validUntil`, `maxCalls`
- per token: `perCall`, `daily` (a rolling 24 h window: five 6 h buckets) and `budget` (lifetime), with `perCall <= daily <= budget`
- calls: `(target, selector)` pairs. `receiverWords` is a bitmask of ABI argument words that must equal the account, so outputs cannot be pointed at the agent (bit 1 for ERC-4626 `deposit(assets, receiver)`, bit 3 for Uniswap `exactInputSingle`'s recipient). Value-moving selectors (`approve`, `transfer`, `transferFrom`, `permit`, EIP-3009, Permit2 `approve` and similar) can never be allowlisted.
- recipients for `agentTransfer` (the owner is always a valid recipient)
- `fenceHash`: the canonical `sha256` of the off-chain Fence, emitted with the session

A session key can issue a **sub-session** (`createSubSession`) for a sub-agent, up to depth 3. The child must fit inside the parent:

- expiry no later than the parent's, calls no more than the parent has left
- per token: `perCall` and `daily` no higher than the parent's, `budget` no higher than what the parent has left
- every call rule present in the parent, with at least the parent's receiver checks; `homeward` only where the parent's rule is homeward
- every recipient on the parent's list

Every spend and every call is **charged to the whole chain**: the session and each ancestor. Siblings therefore share their parent's caps, and a pack can never spend more than the session that created it. A session is valid only while it and all its ancestors are alive, so revoking a parent (`revokeSession`, by the owner or any ancestor's key) revokes every descendant. `revokeAll` kills every session at once.

## Agent execution

- `agentExecute` (sent by the session key) and `agentExecuteWithSig` (EIP-712 signature of the session key, submitted by anyone, with a per-session sequential nonce and a deadline).
- The account approves exactly `spendAmount` of `spendToken` to the target, makes the call and resets the allowance to zero. It then measures what actually left the account across every token the session has limits for, plus the native coin, and charges it up the chain.
- `agentTransfer` / `agentTransferWithSig` pay an allowlisted recipient or the owner.
- Every call emits `AgentCall(sessionId, target, selector, value, memoHash)`, and memos are emitted as `AgentMemo`. Arc's Memo contract only accepts EOA callers, so the account emits its own memo event instead.

**USDC on Arc.** Arc's native coin is USDC with 18 decimals, and its ERC-20 face (0x3600…0000) has 6 decimals; both read one balance. Accounts created with `nativeUsdc` set to the ERC-20 face charge native spends to that token's caps, rounded up to 6 decimals. When both readings move, they are charged once, using the larger of the two.

## The Whistle and the homeward lane

The owner or the guardian can blow the Whistle (`blowWhistle`). Only the owner can release it. While it is blown:

- `agentTransfer` works only to the owner.
- `agentExecute` works only for call rules the owner marked `homeward` when issuing the root session (for example a lending venue's `repay`, or a vault's `redeem` with receiver checks). Sub-sessions can keep that flag but never add it.
- Caps, expiry and call budgets still apply. This is deliberately more conservative than the off-chain Fence, which waives caps for homeward moves. The owner can always act directly.

## Conditional orders (LykiaOrders)

`LykiaOrders` executes EIP-712 orders the maker signed once: limit, stop-loss, take-profit, DCA and TWAP. Funds stay in the maker's wallet behind an ERC-20 allowance. A keeper calls `execute(order, signature, steps, tip)`; the contract checks the signature (EOA or ERC-1271), the deadline, start time, interval and execution count, the nonce floor and cancellation, and for triggered orders a Chainlink price no older than `maxOracleAge`. It then pulls one slice, takes the protocol fee (`feeBps`, 1% at deployment, at most the maker's signed `maxFeeBps`) and the keeper tip (at most `maxTip` and 1% of the slice), and swaps the rest through `LykiaRouter`. The output goes straight to the maker and must reach `minAmountOut`. Makers cancel one order or raise their nonce floor to cancel everything older. The owner can change the fee only within `MAX_FEE_BPS` and the fee recipient, and can pause. It has no way to move a maker's funds.

## LykiaStile (Gateway leashes)

Not part of the deploy plan: each owner creates their own. `OWNER=0x… ENV=testnet npm run stile:plan` prints the unsigned creation and `addDelegate(USDC, stile)` for Gateway Wallet, with the address the wallet's nonce gives; `OWNER=0x… STILE=0x… ENV=testnet npm run stile:check` verifies a deployed one read-only (code against the artifact with immutables ignored, the immutables, the Gateway delegation, the balance on Arc, an unknown digest refused). `test/stile.test.cjs` pins Gateway's hashing (type hashes, EIP-712 digests of intents and sets, the byte-encoded `transferSpecHash`, against a real Arc testnet transfer), every `reserve` check, the owner functions and the pause, and runs a stateful fuzz of reservations, time jumps, cancellations, pauses and revocations against a model (`LYKIA_FUZZ_RUNS` for longer runs). `isValidSignature` is checked under STATICCALL through OpenZeppelin's `SignatureChecker`, as Gateway Wallet's on-chain path does.

## Deploying

`npm run export` writes the ABIs, creation and runtime bytecode and the immutable ranges into `packages/core/src/contracts/`. `lykiaContracts.deployPlan(environment, owner, { nonce })` in `@lykia/core` returns the ordered deployment. Every step is a plain contract-creation transaction (no `to`, data = bytecode and constructor arguments) sent from the owner's own wallet, so block explorers show that wallet as the creator of each core contract. With the wallet's current nonce the plan predicts each address (`keccak256(rlp(sender, nonce))`); without it the owner console reads the addresses from the receipts, and `resolveStep` / `resolveCall` fill in references to earlier steps. The last step is `LykiaOrders(owner, LykiaRouter, 100, feeRecipient)`; its router argument is a reference, filled from the router's receipt. After the steps come the admin calls (testnet: allowlist the practice venues on the router; mainnet: allowlist Uniswap v3 SwapRouter02 and the Aerodrome Metarouter so orders can swap) and post-deploy checks. `codeMatchesArtifact` compares deployed runtime code with the artifact while ignoring immutables; the API refuses to record a deployment that is not a creation sent by an admin address or whose code does not match. User accounts are the one exception, by design: `LykiaAccountFactory` creates each `LykiaAccount` as a clone, so the factory is their creator. The repository holds no keys, and nothing broadcasts on its own. Record deployed addresses in `packages/core/src/contracts/deployments.ts`.

## Scripts

```sh
npm run build -w @lykia/contracts      # hardhat compile
npm test -w @lykia/contracts           # unit tests, plus the deploy plan executed as direct CREATE transactions from the owner's wallet
npm run test:fork -w @lykia/contracts  # optional: forks Arc testnet
npm run export -w @lykia/contracts     # artifacts -> @lykia/core
```

Arc's public RPC returns zeros for `eth_getStorageAt`. A forked chain therefore sees contract code but not contract state, so the fork test only checks code presence and a fresh deployment.

## Gas (in-process chain, optimizer 200 runs)

| Operation | Gas |
|---|---|
| `createAccount` | ~124k |
| `createSession` (2 tokens, 1 rule, 1 recipient) | ~337k |
| `agentExecute`, root session | ~220k |
| `agentExecute`, depth 1 / depth 2 | ~187k / ~213k |
| `agentTransfer` | ~100k |
| `LykiaStile` creation (Arc testnet estimate) | ~3.05M |
| `LykiaStile.reserve`, payment and fee leg (Arc testnet estimate) | ~168k |
| `LykiaStile.isValidSignature` (Arc testnet estimate) | ~32.5k |
| `createSubSession` | ~275k |
