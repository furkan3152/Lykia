# Security

These contracts are **not audited** by a paid firm (an unfunded, one-person project). They have a self-review with Slither, Mythril and fuzz/invariant tests (`docs/security/self-review.md`). Mainnet use is capped for that reason.

## Threat model

The account protects the owner's funds from:

- **A compromised or misbehaving agent key.** It is limited to its session's allowlisted calls and its caps. It cannot approve, transfer or permit tokens except through the capped paths, cannot change limits and cannot sign ERC-1271 messages.
- **A sub-agent spawned by an agent.** It is limited to a subset of its parent, and its spending is charged to the parent as well.
- **A relayer.** It can only submit what a session key signed, once, before the deadline, on this account and this chain.
- **A venue that tries to take more than its allowance.** Allowances are exact and reset to zero after every call.
- **A venue that tries to send outputs elsewhere.** Receiver words are checked, and only what leaves the account is charged.

The router protects callers from venues that under-deliver (per-step and final floors), from anyone trying to call token approval or transfer functions through it, and from re-entrancy. It returns what it produced in the same transaction.

## Known limitations

- **Daily caps** are a rolling window: spends land in 6 h buckets and a charge passes only if the last five buckets (24 to 30 h) stay within the cap, so no 24 h window can exceed it. The price is conservatism: a spend keeps counting for up to 30 h. Tests cover the midnight boundary.
- **Receiver checks** cover static ABI words only. Recipients inside dynamic data (for example a struct with a `bytes` field, or the router's `Intent.recipient`) are not checked on chain. Allowlist such calls only where the off-chain Fence and Lykia's planner pin the recipient, or where outflow measurement is enough.
- **Outflow measurement** covers the tokens the session has limits for, plus the native coin and its ERC-20 face. A token without a limit can still leave the account if the owner left a standing approval for it to an allowlisted venue. Owners should not leave standing approvals on accounts that host agents.
- **Allowlisting a general-purpose contract** (a multicall, an aggregator with arbitrary hooks, a contract with `delegatecall` helpers) effectively hands that contract's power to the agent.
- **The homeward lane** only covers calls the owner marked `homeward`. A blown Whistle does not lift caps.
- **Practice venues** are owner-controlled testnet stand-ins (owner-set prices and rates, no interest) and must never hold real value.
- **Arc specifics.** The contracts target Cancun opcodes. Arc's native USDC (18 decimals) and its ERC-20 face (6 decimals) read one balance. Accounts must be created with `nativeUsdc` set to the face on Arc, or native spends are charged under the native key instead.

## Reporting

Follow the responsible-disclosure policy in the repository's root `SECURITY.md`: report privately through GitHub's private vulnerability reporting, never in a public issue.
