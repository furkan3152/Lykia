# Circle Developer Grants: application draft

Program: https://www.circle.com/grant (relaunch announcement: https://community.arc.io/public/blogs/circle-developer-grants-program-relaunches-2026-05-14).

Circle's published criteria: alignment with Circle products, team strength, innovation, and impact on the USDC network. The 2026 program prioritises meaningful Arc integrations moving from testnet to mainnet and production deployments. Funding is milestone-based in USDC. This draft is organised around those points.

Fields marked **[OWNER]** must be filled in by the owner.

Lykia is built by one developer without a company. The official page speaks of teams and publishes no separate individual track (checked 2026-11-01): apply as a solo builder only if the form allows it.

## Applicant

- Project: Lykia (built on Arc Network)
- Builder: **[OWNER: name, prior work, links]** (individual developer, no company)
- Contact: **[OWNER]**
- Repository: **[OWNER: public or private access for reviewers]**
- Live app: https://lykia-akdogan1.vercel.app · API: https://lykia-api-akdogan1.vercel.app

## Summary

Lykia turns an agent's or a person's intent into a plan across the protocols live on Arc, checks it against a typed rule document (the Fence), and hands out unsigned transactions on Circle's rails. Agents can spawn sub-agents whose Fence and budget must fit inside the parent's, on and off chain. The server never signs.

## Alignment with Circle products

Lykia is built on USDC and EURC and uses CCTP V2 and the Forwarding Service, Gateway, Gateway Nanopayments and x402, the Agent Marketplace, the Compliance Engine, developer-controlled wallets with Gas Station, Modular Wallets (passkeys) and StableFX (wired, awaiting access). Details with code paths: `docs/pitch/arc-circle-brief.md` and `docs/circle.md`.

## Arc integration (testnet to mainnet)

- Live on Arc mainnet: the app, the API and two contracts created by the owner wallet and code-verified (`LykiaAccountFactory` `0x810e8db89f4c4e8fa814ed3ed0d636d3416dd7f9`, `LykiaRouter` `0xc9c0ea4d22ddbef4504a634759fb78334efc5d18`).
- Arc-native features used: USDC gas with native/ERC-20 handling, deterministic finality, Arc Memo, Multicall3From, ERC-8004 registries.
- Executable venues on mainnet: Aave V4, Morpho Vault V2, Morpho Blue, Uniswap v3 and v4, Aerodrome Slipstream, CCTP, Gateway, transfers with memos.

## Innovation

- A Fence that understands DeFi: health factor, FX band against Chainlink, slippage, token checks, venues, hours and signers, evaluated fail-closed.
- An agent tree with strict-subset Fences and carved budgets, enforced again on chain by `LykiaAccount` sub-sessions.
- Policy-checked routing across Arc venues with the reason for each choice.
- ERC-8004 Tags and ERC-8354-format policy verdicts.

## Impact on the USDC network

- Each plan settles in USDC or EURC on Arc and routes to Arc protocols.
- Agents can discover and pay for services in USDC through the Agent Marketplace and x402.
- Open SDK and MCP server so other agent teams can use Arc's protocols without integrating each one.

Usage figures come only from `GET /v1/stats` (public, aggregate). Targets are listed under milestones.

## Milestones (targets)

| # | Deliverable | Evidence | Target date | Amount |
|---|---|---|---|---|
| 1 | `LykiaOrders` deployed on Arc mainnet; `LykiaRouter` venues allowlisted; API on an always-on host with 30 s schedulers | Explorer links; health endpoint | **[OWNER]** | **[OWNER]** |
| 2 | Self-review published (Slither, Mythril, fuzz and invariant tests, every finding triaged) and a community review round; ownership moved to a 2-of-3 Safe behind a timelock | `docs/security/self-review.md`; explorer links | **[OWNER]** | **[OWNER]** |
| 3 | Two to three pilot teams building agents on Arc integrated through the SDK or MCP | Pilot write-ups; on-chain transactions | **[OWNER]** | **[OWNER]** |
| 4 | Mainnet usage target: **[OWNER: e.g. number of executed plans and USDC volume routed to Arc venues]** | Public dashboard from the API and explorer | **[OWNER]** | **[OWNER]** |
| 5 | StableFX taker flow live once access is granted; Lykia's x402 services submitted to the Agent Marketplace; Fence -> Circle wallet policies in the agent setup | Live endpoints; `GET /v1/circle/policies/compile` | **[OWNER]** | **[OWNER]** |

## Budget (placeholders)

| Line | Amount (USDC) |
|---|---|
| Independent review (optional, if funded) | **[OWNER]** |
| Engineering | **[OWNER]** |
| Hosting and infrastructure | **[OWNER]** |
| Pilot support | **[OWNER]** |
| Total | **[OWNER]** |

## Risks and how they are handled

- No paid audit (no budget): a self-review and community review instead, and mainnet beta caps stay on because of that (`docs/security/self-review.md`).
- Thin liquidity on some Arc pairs: the Fence denies quotes that drift from the Chainlink reference.
- Agent demand on Arc is still forming: pilots in milestone 3 test it directly.
