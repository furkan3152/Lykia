# Lykia

**Arc gives agents money. Lyko keeps them in line.**

Lykia is the agent and stablecoin desk of the Kletia family, built on Arc
Network. Say an outcome, in English or Turkish, and Lykia does four things:

1. Plans it across the venues that are live on Arc.
2. Checks the plan against your **Fence** (Çit), a typed rule book around an
   agent or around yourself.
3. Hands each step to your own wallet, or to an agent wallet, to sign.
4. Tracks every step until it is final, which on Arc takes under a second.

Lyko is a shepherd dog that looks like a Kangal. He keeps the flock (your
agents and assets) inside the Fence and the wolves (scam tokens, rug pulls,
exploits) outside it.

| Product | Focus |
|---|---|
| Kletia | Flagship: multi-chain intent infrastructure |
| Elyia | Trading |
| Lykia | Agents and stablecoins, built on Arc Network |

## What makes it Arc-native

| Arc feature | How Lykia uses it |
|---|---|
| USDC as gas, deterministic finality | A step on Arc is settled once its receipt exists, so the Outrun follows the money live. Lykia handles both forms of USDC: native (18 decimals) and ERC-20 (6 decimals). |
| Arc Memo | Every value-moving call carries a memo with the outrun id, the step and the Fence verdict digest, or an invoice reference for payments. |
| Multicall3From (CallFrom) | The approve, the action and the memo go out as one final transaction while the user stays `msg.sender`. |
| ERC-8004 | A **Künye** is an agent identity whose card pins the hash of the Fence it follows. Fence verdicts can be filed to the ValidationRegistry. |
| CCTP V2, Gateway | Bridging USDC out of Arc with attestation tracking, and deposits into the unified Gateway balance. |
| StableFX, Chainlink | USDC/EURC conversion, checked against the Chainlink EURC/USD reference rate (the Fence's FX band). |
| x402 | Paid routes priced per call in USDC on Arc. |

Every Circle and protocol address in the registry was checked on-chain with
`eth_getCode` on Arc mainnet (5042) and testnet (5042002).

## Pillars

- **Fence**: limits on caps, recipients, venues, tokens, slippage, health
  factor, FX band, Scent level, hours and signers. If a fact it needs is
  missing, it denies. The **Whistle** stops all new risk but still lets value
  come home. See [docs/fence.md](docs/fence.md).
- **Künye**: an on-chain licence for agents (ERC-8004 plus the Fence hash),
  so anyone can check which rules an agent follows.
- **Outrun**: a plan drawn as an arc from the start to the **Fold**. Each
  waypoint is named after a stop on the Lycian Way.
- **Scent**: what can be proven about a token before anyone touches it:
  registry and look-alike checks, proxies, privileged functions, the owner
  and a simulated transfer. Scent never calls a token safe.
- **Flock**: one balance sheet for the wallet, the Gateway balance and
  venue positions, priced with Chainlink. A token without a price shows as
  "unpriced", never as zero.
- **Lyko agent, MCP, x402**: agents can plan and inspect through REST or MCP.
  The server never signs.

## Workspaces

```
packages/core/   @lykia/core — zero-I/O spec: networks, contracts, tokens, venues,
                 intent graph, Fence, verdicts, Künye, memos, Outrun, lore
apps/api/        @lykia/api  — Express 5 service on Arc (see its README)
apps/web/        @lykia/web  — the pixel deck: Lyko, the valley, Deck, Flock, Fence,
                 Scent, Künye, developers (see its README)
docs/            the Fence spec and brand notes
```

## Quick start

Requires Node 22.12 or newer.

```sh
npm ci
npm run dev:api        # http://localhost:3002
npm run dev:web        # http://localhost:5176
```

`npm run verify` runs the whole gate: package build and tests, lint,
typecheck, the API and web test suites, and both app builds.

## Status

Lykia is non-custodial and fails closed. It has not been independently
audited.

**Live on mainnet:**

- Transfers with memos
- Morpho Vault V2 deposits and withdrawals
- Uniswap v3 swaps and USDC/EURC conversion
- CCTP and Gateway deposits

**Live on testnet:** the Circle venues only. Morpho and Uniswap are not
deployed on Arc testnet.

**Listed but not executable yet:**

- **Borrowing and repaying.** Arc runs Aave V4 and Morpho Blue; both are in
  the registry, but Lykia cannot execute them yet.
- **The StableFX taker flow.** It needs Circle credentials.

The [API README](apps/api/README.md#what-is-live) has the details.

## License

[MIT](LICENSE)
