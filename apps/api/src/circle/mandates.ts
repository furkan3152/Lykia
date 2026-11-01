/**
 * Arc typed mandates and execution proofs: the adapter layer.
 *
 * Arc has announced "typed mandates" (what an agent may do, signed by its
 * principal) and "execution proofs" (evidence that an action stayed inside a
 * mandate) as part of its Agent Sector roadmap. No public specification
 * exists yet (checked 2026-11-01), so this module defines the interface Lykia
 * will implement and a neutral draft mapping from the Fence and its verdict.
 * The draft is NOT Arc's format and is labelled `status: "pending"` until
 * Arc publishes one; then only `ARC_MANDATE_ADAPTER` changes.
 *
 * Nothing replaces Lykia's own records: `lykia.fence/v1`, `lykia.verdict/v1`
 * and ERC-8004 / ERC-8354 filing stay exactly as they are. See
 * docs/circle/mandates.md.
 */
import { fenceHash, normalizeFence, type Address, type ArcEnvironment, type Fence, type FenceVerdict } from "@lykia/core";

export const MANDATE_DRAFT_SCHEMA = "lykia.mandate-draft/v0" as const;
export const EXECUTION_PROOF_DRAFT_SCHEMA = "lykia.execution-proof-draft/v0" as const;

export type MandateStatus = "pending" | "available";

/** A mandate in Lykia's neutral draft shape: principal, agent, scope, limits, constraints, validity. */
export interface MandateDraft {
  readonly schema: typeof MANDATE_DRAFT_SCHEMA;
  readonly status: MandateStatus;
  readonly target: "arc-typed-mandate";
  readonly principal: Address;
  readonly agent: Address | null;
  readonly environment: ArcEnvironment;
  /** The Fence the mandate was derived from; Tags pin the same hash on chain. */
  readonly source: { readonly schema: "lykia.fence/v1"; readonly fenceHash: string };
  readonly scope: {
    readonly actions: readonly string[] | "any";
    readonly venues: { readonly allow: readonly string[] | "any"; readonly deny: readonly string[] };
    readonly tokens: readonly string[] | "registry";
    readonly recipients: { readonly mode: string; readonly allow: readonly Address[]; readonly deny: readonly Address[] };
  };
  readonly limits: { readonly perActionUsd: string | null; readonly perPlanUsd: string | null; readonly dailyUsd: string | null; readonly weeklyUsd: string | null };
  readonly constraints: { readonly maxSlippageBps: number | null; readonly minHealthFactor: string | null; readonly fxMaxDeviationBps: number | null; readonly scent: string; readonly schedule: Fence["schedule"] | null };
  readonly paused: boolean;
  readonly validUntil: string | null;
}

/** Evidence that a verdict allowed (or refused) a plan, in a neutral draft shape. */
export interface ExecutionProofDraft {
  readonly schema: typeof EXECUTION_PROOF_DRAFT_SCHEMA;
  readonly status: MandateStatus;
  readonly target: "arc-execution-proof";
  readonly decision: FenceVerdict["decision"];
  readonly verdict: { readonly schema: FenceVerdict["schema"]; readonly digest: string; readonly fenceHash: string; readonly factsDigest: string };
  readonly rules: readonly { readonly rule: string; readonly outcome: string }[];
  /** Arc transactions that carried the verdict digest in their memo. */
  readonly transactions: readonly string[];
  /** Where the same verdict is (or can be) filed today. */
  readonly filed: { readonly erc8354: string; readonly registry: "ERC-8004 ValidationRegistry" };
}

export interface MandateAdapter {
  readonly id: string;
  readonly status: MandateStatus;
  readonly note: string;
  toMandate(fence: Fence, input: { readonly principal: Address; readonly agent?: Address; readonly environment: ArcEnvironment; readonly validUntil?: string }): MandateDraft;
  toExecutionProof(verdict: FenceVerdict, input?: { readonly transactions?: readonly string[] }): ExecutionProofDraft;
}

export const ARC_MANDATE_ADAPTER: MandateAdapter = {
  id: "arc-typed-mandates",
  status: "pending",
  note: "Arc has announced typed mandates and execution proofs (Agent Sector roadmap) without a public spec. These drafts show the mapping Lykia will use; they are not submitted anywhere.",
  toMandate(input, { principal, agent, environment, validUntil }) {
    const f = normalizeFence(input);
    return {
      schema: MANDATE_DRAFT_SCHEMA,
      status: "pending",
      target: "arc-typed-mandate",
      principal,
      agent: agent ?? null,
      environment,
      source: { schema: "lykia.fence/v1", fenceHash: fenceHash(input) },
      scope: {
        actions: f.kinds?.allow ?? "any",
        venues: { allow: f.venues?.allow ?? "any", deny: f.venues?.deny ?? [] },
        tokens: f.tokens?.allow ?? "registry",
        recipients: { mode: f.recipients?.mode ?? "own", allow: f.recipients?.allow ?? [], deny: f.recipients?.deny ?? [] },
      },
      limits: { perActionUsd: f.caps?.perStepUsd ?? null, perPlanUsd: f.caps?.perIntentUsd ?? null, dailyUsd: f.caps?.dailyUsd ?? null, weeklyUsd: f.caps?.weeklyUsd ?? null },
      constraints: { maxSlippageBps: f.limits?.maxSlippageBps ?? null, minHealthFactor: f.lending?.minHealthFactor ?? null, fxMaxDeviationBps: f.fx?.maxDeviationBps ?? null, scent: f.scent?.require ?? "no-red-flags", schedule: f.schedule ?? null },
      paused: f.mode === "whistle",
      validUntil: validUntil ?? null,
    };
  },
  toExecutionProof(verdict, input = {}) {
    return {
      schema: EXECUTION_PROOF_DRAFT_SCHEMA,
      status: "pending",
      target: "arc-execution-proof",
      decision: verdict.decision,
      verdict: { schema: verdict.schema, digest: verdict.digest, fenceHash: verdict.fenceHash, factsDigest: verdict.factsDigest },
      rules: verdict.reasons.map((r) => ({ rule: r.rule, outcome: r.decision })),
      transactions: input.transactions ?? [],
      filed: { erc8354: "POST /v1/tags/attest files this verdict as an ERC-8354 policy attestation", registry: "ERC-8004 ValidationRegistry" },
    };
  },
};
