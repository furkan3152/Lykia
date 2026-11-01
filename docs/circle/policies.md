# Fence -> Circle wallet policy (the default agent setup)

**Default path:** run an agent on a Circle wallet and let Lykia's Fence
check every step before it reaches the wallet. Circle enforces the rules it
supports natively; Lykia's preflight enforces the rest. A Lykia smart
account (`LykiaAccount`) is optional, for owners who also want every Fence
rule enforced on chain.

| Mode | Signer | Who enforces what |
|---|---|---|
| Circle wallet + Fence preflight (default) | Circle Agent Wallet or developer-controlled SCA wallet | Circle: caps, recipient and contract allow/block lists, sanctions screening. Lykia: everything else, before signing. |
| Lykia smart account (optional) | A `LykiaAccount` session key | On chain: caps per token, recipients, call rules, sub-sessions, the Whistle. Lykia: the rest before signing. |

## Compile

```http
POST /v1/circle/policies/compile
{ "template": "caravan", "wallet": "0xAgentWallet", "owner": "0xOwner" }
```

`fence` (a `lykia.fence/v1` document) may replace `template`. The answer:

- `policy`: `{ policyType: "stablecoin", chain: "ARC", limits: { perTx, daily, weekly, monthly }, rules: [{ ruleType, targets }] }`, rule types
  `recipient-allowlist`, `recipient-blocklist`, `contract-allowlist`, `contract-blocklist`;
- `commands`: the verbatim `circle wallet limit set ...` commands;
- `coverage`: for every Fence rule, `enforcedBy: "circle" | "lykia" | "both"` and how;
- `warnings`: for example when Circle's tiers had to be tightened.

Mapping rules:

| Fence | Circle | Notes |
|---|---|---|
| `caps.perStepUsd` | `--per-tx` | Never above Lykia's mainnet beta cap |
| `caps.dailyUsd` | `--daily` | Never above the beta daily cap |
| `caps.weeklyUsd` | `--weekly` | |
| (none) | `--monthly` | Left unset |
| `recipients` own-only | `recipient-allowlist [owner]` | Needs `owner` |
| `recipients.allow` | `recipient-allowlist` | The owner is added |
| `recipients.deny` | `recipient-blocklist` | |
| `venues.allow` | `contract-allowlist` | Venue registry contracts plus allowed token contracts |
| `venues.deny` | `contract-blocklist` | |
| per-intent cap, kinds, tokens, slippage, health factor, FX band, Scent, schedule, confirmations, bridges, signers, the Whistle | none | Lykia only |

Circle requires `perTx <= daily <= weekly <= monthly`; the compiler lowers
the smaller tier instead of loosening a larger one.

## Apply

```http
POST /v1/circle/policies/apply
{ "template": "caravan", "wallet": "0xAgentWallet", "walletKind": "agent-wallet" }
```

Lykia never applies a policy itself:

- **Agent Wallets:** Circle sets policies through the Circle CLI and confirms
  each change with an email OTP that only the wallet owner receives
  (status `requires-owner-otp`). Run the returned commands in your own
  terminal. Never paste the OTP into Lykia or an agent. Policies apply to
  mainnet agent wallets only.
- **Developer-controlled wallets:** Circle documents no spending-policy API
  yet (status `not-yet-available`). The Fence preflight enforces every
  rule; add a Lykia smart account for on-chain enforcement.

Source: https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies
