// i18n-ignore-file: design kit for reviewing states during development; its fixtures stand in for API answers.
/**
 * Sample data for the kits (development only): a staged plan in each of its
 * states, a bridge that Across won, and the Fold's side of the hand-offs
 * between Lyko on watch and Ask Lyko. Nothing here calls the API.
 */
import { DEFAULT_FENCE, evaluateFence, outrunOf, type IntentGraph, type IntentStep } from "@lykia/core";
import type { AgentProposal } from "@lykia/core/api/agents";
import type { CreateIntentResponse } from "@lykia/core/api/intents";
import type { FoldInsight, FoldInstruction } from "@lykia/core/api/fold";

export const KIT_OWNER = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f";
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const FEE = "0x1111111111111111111111111111111111111111";
const TX = "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

export type StagedKitState = "start" | "after" | "paused";

const verdict = evaluateFence(DEFAULT_FENCE, { environment: "mainnet", signer: "wallet", owner: KIT_OWNER, steps: [], spent: { dayUsd: "0", weekUsd: "0" }, now: 0 });

export function stagedGraph(state: StagedKitState, id = `out_kitStaged${state}`): IntentGraph {
  const settled = state !== "start";
  const swap: IntentStep = {
    id: "s1",
    kind: "swap",
    venue: "uniswap-v4",
    summary: "Swap 500 USDC → EURC on Uniswap v4 (min 440.4 EURC)",
    signer: "wallet",
    account: KIT_OWNER,
    dependsOn: [],
    inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "500000000", usd: "500.00" }],
    outputs: [{ symbol: "EURC", token: EURC, decimals: 6, amount: "442630000", minimum: "440400000", usd: "493.70" }],
    settlement: { kind: "receipt" },
    route: { chosen: { venue: "uniswap-v4", label: "Uniswap v4 0.05% pool", risk: "low", executable: true, notes: [] }, alternatives: [], reason: "Uniswap v4 0.05% pool gives the most after gas." },
    fee: { bps: 100, recipient: FEE, symbol: "USDC", token: USDC, decimals: 6, amount: "5000000", usd: "5.00", basis: "input" },
    status: settled ? "settled" : "ready",
    stage: 1,
    ...(settled ? { references: [TX] as `0x${string}`[], received: { symbol: "EURC", token: EURC, decimals: 6, amount: "442610000", usd: "493.68" }, settledAt: "2026-11-08T09:00:02Z" } : {}),
  } as IntentStep;
  const deposit: IntentStep = {
    id: "s2",
    kind: "deposit",
    venue: "morpho-vaults",
    summary: settled ? "Deposit 438.1839 EURC into Morpho Galaxy EURC" : "Deposit 435.996 EURC into Morpho Galaxy EURC",
    signer: "wallet",
    account: KIT_OWNER,
    dependsOn: ["s1"],
    inputs: [{ symbol: "EURC", token: EURC, decimals: 6, amount: settled ? "442610000" : "440400000", usd: settled ? "493.68" : "491.21" }],
    outputs: [{ symbol: "EURC@morpho-vaults", token: EURC, decimals: 6, amount: settled ? "438183900" : "435996000", usd: null }],
    settlement: { kind: "receipt" },
    route: { chosen: { venue: "morpho-vaults", label: "Morpho Galaxy EURC", apy: "0.0118", risk: "medium", executable: true, notes: [] }, alternatives: [], reason: "Morpho Galaxy EURC: 1.18% APY, chosen over Aave V4 Main Spoke EURC (0.67% APY)." },
    fee: { bps: 100, recipient: FEE, symbol: "EURC", token: EURC, decimals: 6, amount: settled ? "4426100" : "4404000", usd: null, basis: "input" },
    status: settled ? "awaiting-signature" : "blocked",
    stage: 2,
    ...(settled ? { replanned: { symbol: "EURC", planned: "440400000", actual: "442610000", at: "2026-11-08T09:00:04Z" } } : {}),
    ...(state === "paused" ? { status: "ready" as const, failure: { code: "FENCE_DENIED", message: "Your Fence refuses this step now: today's spend would pass the 500 USD daily cap.", retryable: true } } : {}),
  } as IntentStep;
  return { spec: "lykia.intent/v1", id, environment: "mainnet", createdAt: "2026-11-08T09:00:00Z", source: "Swap 500 USDC to EURC, then deposit it into Morpho", owner: KIT_OWNER, steps: [swap, deposit], verdict, warnings: [] } as IntentGraph;
}

/** A bridge out of Arc that Across won: it delivers more than CCTP and Relay (figures from the 2026-11-08 simulation). */
export function acrossGraph(id = "out_kitAcross1"): IntentGraph {
  const step: IntentStep = {
    id: "s1",
    kind: "bridge",
    venue: "across",
    summary: "Bridge 99 USDC to Base over Across (cross-chain: delivered on Base, min 98.491333 USDC)",
    signer: "wallet",
    account: KIT_OWNER,
    dependsOn: [],
    inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "100000000", usd: "100.00" }],
    outputs: [{ symbol: "USDC@base", token: USDC, decimals: 6, amount: "98986265", minimum: "98491333", usd: "98.99" }],
    settlement: { kind: "receipt" },
    route: {
      chosen: { venue: "across", label: "Across to Base", amountOut: "98986265", netAmountOut: "98986265", risk: "medium", executable: true, notes: ["Cross-chain: an Across relayer delivers on the destination chain; unfilled deposits are refunded on Arc.", "Across's fee 0.013735 USDC."] },
      alternatives: [
        { venue: "cctp", label: "CCTP to Base", amountOut: "98945337", netAmountOut: "98945337", risk: "low", executable: true, notes: ["Burn and mint; Circle forwards the mint."] },
        { venue: "relay", label: "Relay to Base", amountOut: "98929596", netAmountOut: "98929596", risk: "medium", executable: true, notes: ["Relay's fee 0.070404 USDC."] },
      ],
      reason: "Across delivers 98.986265 USDC on Base, more than CCTP's 98.945337 USDC and Relay's 98.929596 USDC.",
    },
    fee: { bps: 100, recipient: FEE, symbol: "USDC", token: USDC, decimals: 6, amount: "1000000", usd: "1.00", basis: "input" },
    status: "ready",
    stage: 1,
  } as IntentStep;
  return { spec: "lykia.intent/v1", id, environment: "mainnet", createdAt: "2026-11-08T09:00:00Z", source: "Bridge 100 USDC to Base", owner: KIT_OWNER, steps: [step], verdict, warnings: ["Cross-chain: an Across relayer delivers on Base in about 2 s; if it does not fill, Across refunds the USDC on Arc after the fill deadline."] } as IntentGraph;
}

export function intentResponse(graph: IntentGraph): CreateIntentResponse {
  return { intent: graph, outrun: outrunOf(graph), stored: true };
}

export const proposalFor = (graph: IntentGraph, over: Partial<AgentProposal> = {}): AgentProposal => ({
  intentId: graph.id,
  title: "swap + earn",
  steps: graph.steps.map((s) => s.summary),
  decision: "allow",
  reasons: [],
  warnings: graph.warnings,
  attribution: [{ agent: "Lyko", role: "orchestrator", part: "swap + earn" }],
  rationale: "",
  ...over,
});

const HANDOFF_ID = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f:ins_a1b2c3d4e5f60718";
const WATCH_ID = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f:ins_0f1e2d3c4b5a6978";

/** Repaying a quarter of the Aave debt, as Lyko on watch hands it to Ask Lyko. */
export function repayGraph(id = "out_kitRepay01"): IntentGraph {
  const step: IntentStep = {
    id: "s1",
    kind: "repay",
    venue: "aave-v4",
    summary: "Repay 312.5 USDC on Aave V4 Main Spoke",
    signer: "wallet",
    account: KIT_OWNER,
    dependsOn: [],
    inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "312500000", usd: "312.50" }],
    outputs: [],
    settlement: { kind: "receipt" },
    status: "ready",
    stage: 1,
  } as IntentStep;
  return { spec: "lykia.intent/v1", id, environment: "mainnet", createdAt: "2026-11-08T09:10:00Z", source: "Repay 312.5 USDC on aave-v4", owner: KIT_OWNER, steps: [step], verdict, warnings: [] } as IntentGraph;
}

export const HANDOFF_PROPOSAL: AgentProposal = proposalFor(repayGraph(), {
  title: "Repay a quarter: Health factor 1.31 on Aave V4 Main Spoke",
  attribution: [{ agent: "Lyko on watch", role: "sentinel", part: "noticed it" }, { agent: "Lyko", role: "orchestrator", part: "planned it" }],
  rationale: "Health factor now 1.31 · Your Fence floor 1.5",
  from: { agent: "watch", instructionId: HANDOFF_ID },
});

export const FOLD_INSIGHTS: readonly FoldInsight[] = [
  {
    id: "watch-0f1e2d3c4b5a6978",
    kind: "watch-task",
    severity: "act",
    title: "Health factor 1.31 on Aave V4 Main Spoke, below 1.5",
    explain: "You asked Ask Lyko to watch this (health factor below 1.5 on Aave V4), and it is met now. Lyko on watch has a move ready below.",
    figures: [{ label: "Watching", value: "Health factor below 1.5 on Aave V4" }, { label: "Now", value: "Health factor 1.31 on Aave V4 Main Spoke, below 1.5" }],
    draft: { label: "Repay a quarter", sentence: "Repay 312.5 USDC on aave-v4" },
    handled: false,
    origin: { agent: "ask", instructionId: WATCH_ID },
  },
  {
    id: "health-aave-v4-main",
    kind: "health-factor",
    severity: "act",
    title: "Health factor 1.31 on Aave V4 Main Spoke",
    explain: "Your Fence floor is 1.5. A price move could push the position under it and toward liquidation. Repaying part of the debt, or adding collateral, raises it.",
    figures: [{ label: "Health factor now", value: "1.31" }, { label: "Your Fence floor", value: "1.5" }, { label: "Debt on this venue", value: "$1,250" }],
    draft: { label: "Repay a quarter", sentence: "Repay 312.5 USDC on aave-v4" },
    handled: true,
    sent: { instructionId: HANDOFF_ID, status: "planned", intentId: "out_kitRepay01", threadId: `${KIT_OWNER}:thr_kit` },
  },
  {
    id: "idle-usdc",
    kind: "idle-usdc",
    severity: "watch",
    title: "$740 of USDC is resting above your floor",
    explain: "Your wallet keeps $200 liquid for gas and payments. The rest earns nothing while it sits; a low-risk lending market or vault on Arc can hold it and you can withdraw any time.",
    figures: [{ label: "USDC in your wallet", value: "$940" }, { label: "Your liquidity floor", value: "$200" }],
    draft: { label: "Put it to work", sentence: "Put 740 USDC to work at low risk" },
    handled: false,
  },
] as FoldInsight[];

export const FOLD_INSTRUCTIONS: readonly FoldInstruction[] = [
  { id: WATCH_ID, source: "watch", sourceLabel: "From Ask Lyko", name: "Health factor below 1.5 on Aave V4", status: "active", trigger: "watch task · health below", nextRunAt: null, nextRunLabel: "on each Fold read", lastRunAt: "2026-11-08T09:12:00Z", lastResult: "Health factor 1.31 on Aave V4 Main Spoke, below 1.5", nextVerdict: { decision: "allow", reason: "A watch only raises an insight; it moves nothing." }, controllable: true, editSentence: "", environment: "mainnet" },
  { id: `${KIT_OWNER}:ins_1122334455667788`, source: "watch", sourceLabel: "From Ask Lyko", name: "Liquidity out of range on Uniswap", status: "paused", trigger: "watch task · lp out of range", nextRunAt: null, nextRunLabel: "paused", lastRunAt: null, lastResult: "1 liquidity position is in range", nextVerdict: { decision: "allow", reason: "A watch only raises an insight; it moves nothing." }, controllable: true, editSentence: "", environment: "mainnet" },
  { id: "alr_kit01", source: "alert", sourceLabel: "Alert", name: "EURC above $1.20", status: "active", trigger: "price above", nextRunAt: null, nextRunLabel: "when it happens", lastRunAt: null, lastResult: "Quiet so far", nextVerdict: { decision: "allow", reason: "Alerts notify; they move nothing." }, controllable: true, editSentence: "", environment: "mainnet" },
] as FoldInstruction[];

export const HANDOFF_IDS = { handoff: HANDOFF_ID, watch: WATCH_ID };
