# Security policy: responsible disclosure

Lykia is open-source software maintained by an individual developer. There
is no company behind it and no paid bug bounty. Reports are still very
welcome, and every valid one is credited publicly (if you want) in
`docs/security/self-review.md` and the release notes.

**Lykia's contracts have not been audited by a paid firm.** That is why
mainnet use is capped (`LYKIA_BETA_CAP_USD`, $1,000 per step and $5,000 per
day per owner by default). See `docs/security/self-review.md` and
`docs/security/help-us-review.md`.

## How to report

- Use GitHub's **private vulnerability reporting** on this repository
  ("Security" tab, "Report a vulnerability"). Do not open a public issue.
- Include the affected component, a description, steps or a proof of
  concept (a hardhat test is ideal), and the impact you expect.

## Scope

- Contracts: `LykiaAccount`, `LykiaAccountFactory`, `LykiaRouter`,
  `LykiaOrders`, `LykiaTimelock` (`packages/contracts/contracts`).
- API: plan binding and submit verification, Fence evaluation
  (`packages/core/src/fenceEvaluate.ts`), the Circle policy compiler,
  x402 payment verification, session and key handling, SSRF guards.
- The web app's signing flows (what is shown vs what is signed).

Out of scope: practice venues on testnet, third-party protocols and Circle
products, issues that need a compromised owner key or device, social
engineering, denial of service against hosting providers, missing best
practices without a concrete impact.

## Rules

- Test on Arc testnet or a local fork. Never touch other people's funds.
- Give a reasonable time to fix before public disclosure (90 days by
  default, sooner by agreement).
- Do not access or keep other users' data.

## What to expect

- An acknowledgement within 7 days (best effort: one person).
- A fix or a written reason, a public write-up after the fix, and credit.
- If funds are at risk, the Whistle, router pause and lowered beta caps are
  used first, then the fix.

There is no monetary reward. Thank you for helping anyway.
