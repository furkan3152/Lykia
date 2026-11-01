# Ownership hardening: Safe multisig + timelock

Owned contracts and their admin powers:

| Contract | Owner type | Admin powers |
|---|---|---|
| `LykiaRouter` | `Ownable2Step` | venue allowlist, pause, rescue stray tokens |
| `LykiaOrders` | `Ownable2Step` | fee (bounded) and fee recipient, pause |
| `LykiaAccountFactory` | none | none: immutable, nothing to transfer |
| `LykiaAccount` | each user | the user's own account; Lykia has no power over it |

Target setup: owner = a `LykiaTimelock` (OpenZeppelin `TimelockController`)
whose only proposer, canceller and executor is a Safe, with no timelock
admin. Every admin action is then queued publicly for the delay (48 hours
suggested) and the Safe can cancel it.

## A setup that works for one person

There is no team, so the Safe protects against losing or leaking one key,
not against a rogue co-signer:

- **Safe 1.4.1 on Arc mainnet** (in Lykia's registry, code-verified):
  singleton `0x41675C099F32341bf84BFc5382aF534df5C7461a`, proxy factory
  `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`. Create it with the Safe
  web app or the proxy factory.
- **2-of-3 threshold, three keys on three devices you control**, for
  example: a hardware wallet, a phone wallet, and a laptop wallet (or a
  second hardware wallet kept elsewhere). Any two sign; losing one device
  loses nothing.
- Keep the three seed phrases offline and in different places.
- Fund the Safe with a little USDC for gas (gas on Arc is USDC).
- Keep the **fee recipient separate** from the Safe's signer keys.

## Steps (nothing here is signed by Lykia)

1. Deploy the Safe (2-of-3) from your own wallet.
2. Deploy `LykiaTimelock(minDelay, [safe], [safe], 0x0)` from your own
   wallet (owner console or hardhat with your own key).
3. Print the plan:
   ```sh
   cd packages/contracts
   ROUTER=0x... ORDERS=0x... SAFE=0x... TIMELOCK=0x... DELAY=172800 node scripts/ownership-plan.cjs
   ```
   or `GET /v1/admin/ownership?safe=0x...&timelock=0x...` in the owner console session.
4. From the current owner wallet: `transferOwnership(timelock)` on each
   contract (two-step: nothing changes until accepted).
5. From the Safe: `schedule(... acceptOwnership ...)` on the timelock; after
   the delay, `execute(...)`. Check `owner()` equals the timelock.
6. Record the Safe, its signers' devices (not the keys) and the timelock in
   `docs/security/audit-pack.md`.

Simpler first step if you want no delay yet: transfer straight to the Safe
(omit `TIMELOCK`); add the timelock later the same way.

Tests: `packages/contracts/test/governance.test.cjs` covers the two-step
transfer, the delay, proposer-only scheduling, cancellation, the missing
admin and the plan script's calldata.
