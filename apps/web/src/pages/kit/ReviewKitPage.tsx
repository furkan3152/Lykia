// i18n-ignore-file: design kit for reviewing states during development; its fixtures stand in for API answers.
/**
 * The review kit (development only, /app/kit/review?state=…): the review
 * modal in every state with sample data, so each can be checked and
 * screenshotted without a wallet. Nothing here calls the API or moves money.
 */
import { DEFAULT_FENCE, evaluateFence, outrunOf, type IntentGraph, type IntentStep } from "@lykia/core";
import type { SecurityReport } from "@lykia/core/security/index";
import { useMemo, useState } from "react";

import { navigate } from "../../app/routes/history";
import { useSearchParam } from "../../app/routes/useRoute";
import { ReviewDialog } from "../../features/route/ReviewModal";
import { reviewView } from "../../features/route/reviewModel";
import { leadSentence } from "../../features/route/plain";
import type { ReviewPhase } from "../../features/route/useReviewFlow";
import { classifyTxError } from "../../features/route/txErrors";
import { PageHead } from "../../mosaic";
import { planStages } from "@lykia/core";
import { STAGE_START, stageReduce, type StageState } from "../../features/route/stagedFlow";
import { stagedGraph } from "./stagedFixtures";
import { gasPlan, poisonedPlan } from "./preflightFixtures";

/** The stage machine as the modal holds it for a staged kit state: step 1, step 2 after step 1 settled, or paused. */
function kitStage(state: string): StageState | undefined {
  if (!state.startsWith("stage-")) return undefined;
  const fold = (st: StageState, g: ReturnType<typeof stagedGraph>) => stageReduce(st, { type: "graph", plan: planStages(g), decision: "allow", signable: true });
  if (state === "stage-1") return stageReduce(fold(STAGE_START, stagedGraph("start")), { type: "phase", phase: "quoted" });
  if (state === "stage-2") return stageReduce(fold(fold(STAGE_START, stagedGraph("start")), stagedGraph("after")), { type: "phase", phase: "quoted" });
  return fold(STAGE_START, stagedGraph("paused"));
}

const OWNER = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f";
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const TX = "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const FEE = "0x1111111111111111111111111111111111111111";

const STATES = ["loading", "quoting", "quoted", "refreshed", "confirm", "signing", "submitted", "settled", "failed", "failed-chain", "denied", "stage-1", "stage-2", "stage-paused", "preflight-warn", "preflight-block"] as const;
type KitState = (typeof STATES)[number];

function sampleGraph(state: KitState): IntentGraph {
  const confirm = state === "confirm";
  const deny = state === "denied";
  const verdict = evaluateFence(DEFAULT_FENCE, { environment: "mainnet", signer: "wallet", owner: OWNER, steps: [], spent: { dayUsd: "0", weekUsd: "0" }, now: 0 });
  const decided = deny
    ? { ...verdict, decision: "deny" as const, signable: false, reasons: [{ rule: "caps.perStep", decision: "deny" as const, message: "5,000 USD is above the per-step cap of 1,000 USD." }] }
    : confirm
      ? { ...verdict, decision: "confirm" as const, reasons: [{ rule: "confirm.aboveUsd", decision: "confirm" as const, message: "Plans above 250 USD ask you to confirm." }] }
      : verdict;
  const settled = state === "settled";
  const fx: IntentStep = {
    id: "s1",
    kind: "fx",
    venue: "uniswap-v4",
    summary: "Convert 198 USDC -> 176.22 EURC on Uniswap v4 0.05% pool (min 175.34)",
    signer: "wallet",
    account: OWNER,
    dependsOn: [],
    inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "200000000", usd: "200.00" }],
    outputs: [{ symbol: "EURC", token: EURC, decimals: 6, amount: "176220000", minimum: "175340000", usd: "198.40" }],
    settlement: { kind: "receipt" },
    route: { chosen: { venue: "uniswap-v4", label: "Uniswap v4 0.05% pool", risk: "low", executable: true, notes: [] }, alternatives: [], reason: "Uniswap v4 0.05% pool gives the most after gas, 8 bps more than Uniswap v3 0.05% pool." },
    fee: { bps: 100, recipient: FEE, symbol: "USDC", token: USDC, decimals: 6, amount: "2000000", usd: "2.00", basis: "input" },
    status: settled || state === "submitted" ? "settled" : "ready",
    ...(settled || state === "submitted" ? { references: [TX] as `0x${string}`[] } : {}),
  } as IntentStep;
  const earn: IntentStep = {
    id: "s2",
    kind: "deposit",
    venue: "morpho-vaults",
    summary: "Deposit 174.45 EURC into Morpho Galaxy EURC",
    signer: "wallet",
    account: OWNER,
    dependsOn: ["s1"],
    inputs: [{ symbol: "EURC", token: EURC, decimals: 6, amount: "176220000", usd: "198.40" }],
    outputs: [{ symbol: "EURC@morpho-vaults", token: EURC, decimals: 6, amount: "174457800", usd: "196.42" }],
    settlement: { kind: "receipt" },
    route: { chosen: { venue: "morpho-vaults", label: "Morpho Galaxy EURC", apy: "0.0118", risk: "medium", executable: true, notes: [] }, alternatives: [], reason: "Morpho Galaxy EURC: 1.18% APY (Morpho API), $562K TVL, medium risk; chosen over Aave V4 Main Spoke EURC (0.67% APY). Compared 5 venues: Morpho Galaxy EURC 1.18% APY, Aave V4 Forex Spoke EURC 0.67% APY, Aave V4 Main Spoke EURC 0.67% APY, Morpho Gauntlet EURC Prime 1.97% APY (not executable), Morpho Steakhouse Prime EURC 1.97% APY (not executable)." },
    fee: { bps: 100, recipient: FEE, symbol: "EURC", token: EURC, decimals: 6, amount: "1762200", usd: "1.98", basis: "input" },
    status: settled ? "settled" : "blocked",
    ...(settled ? { references: [TX] as `0x${string}`[] } : {}),
  } as IntentStep;
  return { spec: "lykia.intent/v1", id: "out_kit7Fq2xR", environment: "mainnet", createdAt: "2026-11-06T09:00:00Z", source: "buy EURC with 200 USDC and lend it at the best yield", owner: OWNER, steps: [fx, earn], verdict: decided, warnings: [] } as IntentGraph;
}

const SECURITY: SecurityReport = {
  schema: "lykia.security/v1",
  stepId: "s1",
  decision: "pass",
  findings: [],
  summary: {
    lines: ["Approve exactly 200 USDC to Permit2 (Uniswap)", "Pay the Lykia fee: 2 USDC", "Swap 198 USDC for at least 175.34 EURC on Uniswap v4, with the Arc Memo"],
    calls: [],
    balanceChanges: [{ token: USDC, symbol: "USDC", out: "200000000", in: null }],
    approvals: [{ token: USDC, spender: "0x000000000022D473030F116dDEE9F6B43aC78BA3", amount: "198000000", exact: true }],
    contractsTouched: [],
  },
  simulation: "eth_call",
  checkedAt: "2026-11-06T09:00:04Z",
  cleanup: [],
  digest: "sha256:4f1c2a9be0d377aa51c0",
} as unknown as SecurityReport;

export default function ReviewKitPage() {
  const param = useSearchParam("state");
  const state: KitState = (STATES as readonly string[]).includes(param ?? "") ? (param as KitState) : "quoted";
  const [open, setOpen] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [acked, setAcked] = useState(false);
  const graph = useMemo(() => (state === "preflight-warn" ? gasPlan().graph : state === "preflight-block" ? poisonedPlan().graph : state === "stage-1" ? stagedGraph("start") : state === "stage-2" ? stagedGraph("after") : state === "stage-paused" ? stagedGraph("paused") : sampleGraph(state)), [state]);
  const stage = useMemo(() => kitStage(state), [state]);
  const view = useMemo(() => (state === "loading" ? null : reviewView(graph, outrunOf(graph))), [graph, state]);
  const phase: ReviewPhase = (
    { loading: "idle", quoting: "quoting", quoted: "quoted", refreshed: "quoted", confirm: "idle", signing: "signing", submitted: "settled", settled: "settled", failed: "failed", "failed-chain": "failed", denied: "idle", "stage-1": "quoted", "stage-2": "quoted", "stage-paused": "idle", "preflight-warn": "idle", "preflight-block": "idle" } as const
  )[state];
  const failure =
    state === "failed"
      ? classifyTxError(Object.assign(new Error("User rejected the request."), { name: "UserRejectedRequestError", code: 4001 }), "sign")
      : state === "failed-chain"
        ? classifyTxError(Object.assign(new Error("The current chain of the wallet (id: 1) does not match the target chain for the transaction (id: 5042 – Arc)."), { name: "ChainMismatchError" }), "chain", { network: "Arc mainnet" })
        : null;
  return (
    <div>
      <PageHead kicker="KIT · REVIEW" title={<>Review and <em>sign</em></>} sub="Every state of the review modal, with sample data. Nothing here calls the API." />
      <div className="m-wrap" style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 16 }}>
        {STATES.map((s) => (
          <button key={s} type="button" className="m-chip" aria-pressed={s === state} onClick={() => { navigate(`/app/kit/review?state=${s}`); setOpen(true); }}>
            {s}
          </button>
        ))}
      </div>
      <ReviewDialog
        open={open}
        onClose={() => setOpen(false)}
        title={state === "preflight-warn" ? "Buy EURC with 2 USDC" : state === "preflight-block" ? "Send 250 USDC to 0xabcd…1234" : stage ? "Swap 500 USDC to EURC, then deposit it into Morpho" : "Buy EURC with 200 USDC and lend it at the best yield"}
        view={view}
        lead={state === "loading" ? null : leadSentence(graph)}
        phase={phase}
        failure={failure}
        security={state === "quoting" || state === "loading" || state === "confirm" || state === "denied" || state.startsWith("stage-") || state.startsWith("preflight-") ? null : SECURITY}
        refreshes={state === "refreshed" ? 1 : 0}
        quotedAt={state === "quoted" || state === "refreshed" || state === "signing" || state === "stage-1" || state === "stage-2" ? Date.UTC(2026, 10, 6, 9, 0, 4) : null}
        lastTx={state === "settled" || state === "submitted" ? TX : null}
        connected
        walletLabel={null}
        confirmed={confirmed}
        onConfirm={setConfirmed}
        onSign={() => undefined}
        onRetry={() => undefined}
        onReplan={() => undefined}
        onConnect={() => undefined}
        txCount={state === "loading" || state === "quoting" ? null : 2}
        transferCostUsd="0.0021"
        {...(stage ? { stage, onStop: () => undefined } : {})}
        {...(graph.preflight ? { preflight: graph.preflight, preflightAcked: acked, onPreflightAck: setAcked, onFix: () => undefined } : {})}
      />
    </div>
  );
}
