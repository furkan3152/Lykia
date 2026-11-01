# Software notice and risk disclosure

> **DRAFT.** Plain-English notice written by the developer, not by a lawyer.
> It has not had legal review. Last updated 2026-11-01.

## What Lykia is

Lykia is open-source software (MIT licence) for planning stablecoin moves
on Arc Network and checking them against rules you set (the Fence). It is
built by an individual developer, not a company. It is built on Arc
Network and Circle's products; it is not affiliated with, endorsed by or a
partner of Circle or Arc.

## Non-custodial

- Lykia never holds your funds and never holds your keys.
- Lykia's server prepares **unsigned** transactions. You, your wallet, your
  passkey smart account or an agent session you created signs every
  transaction. Nothing moves until a signature you control exists.
- Lykia cannot reverse, cancel or recover a transaction once it is signed
  and final on Arc.

What Lykia controls and what it does not:

| Lykia controls | Lykia does not control |
|---|---|
| The plan it proposes and the Fence verdict it computes | Your keys, wallets and their recovery |
| Its own contracts' admin functions (router venue list, pause) through the owner key, moving to a multisig with a timelock | Arc Network, USDC, EURC, CCTP, Gateway, StableFX or any Circle product |
| Which venues it routes to | Third-party protocols (Aave, Morpho, Uniswap and others), their prices or their failures |
| The API's uptime | Circle wallets you create: with developer-controlled wallets, whoever holds the API key and entity secret (you, if you run the API) controls the wallet |

**Developer-controlled wallets caveat.** If you run Lykia with
`CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET`, the agent wallets created
through Circle are controlled by whoever holds those credentials. On a
Lykia deployment you run, that is you. Do not use someone else's deployment
for developer-controlled wallets unless you accept that they control those
wallets.

## Risks

- **No warranty.** The software is provided "as is", without warranty of
  any kind (see `LICENSE`). You use it at your own risk.
- **Not audited.** Lykia's contracts have not been audited by a paid firm;
  there is no budget for one. They have had a self-review with automated
  tools and fuzz tests (`docs/security/self-review.md`), which is not the
  same thing. **This is why the mainnet beta caps exist**: every mainnet
  move is capped at $1,000 per step and $5,000 per day per owner, above
  every Fence (`LYKIA_BETA_CAP_USD`). Moves that bring value home are never
  capped.
- **Smart contract risk.** Bugs in Lykia's contracts or in the protocols it
  routes to can lose funds.
- **Stablecoin and network risk.** Stablecoins can depeg; networks can halt
  or reorganise (Arc has deterministic finality, other chains may not).
- **Agent risk.** An AI agent can misread an instruction. The Fence limits
  what it can do; it does not make its choices good.
- **Oracle and liquidity risk.** Prices can be stale or thin; the Fence
  denies when a fact it needs is missing, but cannot prevent every bad fill.
- **Scent is not a guarantee.** Token checks say what can be proven; Lykia
  never calls a token "safe".

## Not financial advice

Lykia shows routes, yields and verdicts. None of it is financial,
investment, tax or legal advice. Yields are variable and can be lost.

## Compliance controls in the software

- Recipient screening with Circle's Compliance Engine when a Circle API key
  is configured; a DENIED address becomes a Fence deny.
- Circle Agent Wallets screen every transfer against sanctions controls.
- Fence recipient allowlists and blocklists; agents cannot pay strangers
  unless allowlisted.
- Per-step, per-plan, daily and weekly caps, plus the mainnet beta cap.
- The Whistle: stops all new risk while still letting value come home.

You are responsible for complying with the laws that apply to you.
