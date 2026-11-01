# Arc typed mandates and execution proofs

**Status: pending.** Arc has announced "typed mandates" and "execution
proofs" for agents as part of its Agent Sector roadmap. No public
specification exists as of 2026-11-01, so Lykia ships an adapter interface
and a neutral draft mapping, and changes only the adapter when Arc
publishes the format.

Nothing changes in Lykia's own records:

- the Fence stays `lykia.fence/v1`, hashed and pinned by Tags;
- verdicts stay `lykia.verdict/v1`, with their digest in each step's Arc Memo;
- verdicts are still filed to the ERC-8004 ValidationRegistry as ERC-8354
  policy attestations (`POST /v1/tags/attest`).

## Interface

`apps/api/src/circle/mandates.ts`:

```ts
interface MandateAdapter {
  id: string;
  status: "pending" | "available";
  toMandate(fence, { principal, agent?, environment, validUntil? }): MandateDraft;
  toExecutionProof(verdict, { transactions? }): ExecutionProofDraft;
}
```

Routes: `POST /v1/circle/mandates/draft` and `POST /v1/circle/mandates/proof`.

## Mapping (draft)

| Mandate concept | From the Fence |
|---|---|
| principal | the Fence owner |
| agent | the Tag's agent address |
| scope: actions | `kinds.allow` (absent = any) |
| scope: venues | `venues.allow` / `venues.deny` |
| scope: assets | `tokens.allow` (absent = registry only) |
| scope: counterparties | `recipients.mode`, `allow`, `deny` |
| limits | `caps.perStepUsd`, `perIntentUsd`, `dailyUsd`, `weeklyUsd` |
| constraints | slippage, minimum health factor, FX band, Scent, schedule |
| paused | `mode: "whistle"` |
| source binding | `fenceHash` |

| Execution proof concept | From the verdict |
|---|---|
| decision | `decision` |
| binding | `digest` (Fence hash + facts digest + decision) |
| per-rule evidence | `reasons[].rule`, `reasons[].decision` |
| transactions | Arc transactions whose memo carries the digest |
| attestation | the ERC-8354 record in the ValidationRegistry |

When Arc publishes the spec: implement `toMandate` / `toExecutionProof` in
Arc's format, set `status: "available"`, and keep the drafts' fields as the
source of truth.
