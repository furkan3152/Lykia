// i18n-ignore-file: design kit for reviewing states during development; its fixtures stand in for API answers.
/**
 * Preflight in the kits: sample plans whose findings are computed by core's
 * own checks (runPreflight, watchFindings) from sample balances, so the kit
 * shows exactly what the engine would say. Nothing here calls the API.
 */
import { DEFAULT_FENCE, evaluateFence, runPreflight, tx, watchFindings, type Finding, type IntentGraph, type IntentStep, type PreflightPlan, type PreflightState } from "@lykia/core";
import type { AgentProposal } from "@lykia/core/api/agents";
import type { FoldInsight } from "@lykia/core/api/fold";

import { KIT_OWNER } from "./stagedFixtures";

const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const FEE = "0x1111111111111111111111111111111111111111";
const SUPPLIER = "0xabcd7f20c3d14e9a8b6f5e2d1c0b9a8f7e6d1234";
const LOOKALIKE = "0xabcd03e1f2a4b5c6d7e8f9a0b1c2d3e4f5a61234";
const AT = "2026-11-09T17:58:00.000Z";
const NOW = Date.parse(AT);

const read = { source: "Arc chain · balanceOf", readAt: AT };
function state(usdc: string, over: Partial<PreflightState> = {}): PreflightState {
  return {
    now: NOW,
    wallet: { balances: { USDC: usdc, EURC: "0" }, read },
    gas: { priceWei: "20000000000", read: { source: "Arc chain · eth_gasPrice", readAt: AT } },
    prices: { USDC: { usd: "1", updatedAt: null, maxAgeSeconds: null, source: "unit of account" }, EURC: { usd: "1.1154", updatedAt: AT, maxAgeSeconds: 93_600, source: "chainlink:EURC/USD" } },
    prefs: { gasReserveUsdc: "0.5", cashFloorUsd: "500", explicit: false, read: { source: "Your Lyko", readAt: null } },
    obligations: [],
    running: [],
    recent: [],
    counterparties: [],
    code: {},
    contracts: [{ address: USDC, name: "USDC token" }],
    incoming: [],
    head: null,
    destinations: {},
    unlimitedApprovals: [],
    vaults: {},
    health: {},
    budget: { kind: "fence", name: "Your Fence" },
    beta: null,
    minFeeGwei: 20,
    ...over,
  };
}

const verdict = evaluateFence(DEFAULT_FENCE, { environment: "mainnet", signer: "wallet", owner: KIT_OWNER, steps: [], spent: { dayUsd: "0", weekUsd: "0" }, now: 0 });

function graphOf(id: string, source: string, steps: IntentStep[], findings: readonly Finding[]): IntentGraph {
  return { spec: "lykia.intent/v1", id, environment: "mainnet", createdAt: AT, source, owner: KIT_OWNER, steps, verdict, warnings: [], preflight: findings } as IntentGraph;
}

function planOf(id: string, source: string, steps: IntentStep[], actions: PreflightPlan["actions"], recipient?: string): PreflightPlan {
  return {
    id,
    environment: "mainnet",
    owner: KIT_OWNER,
    account: KIT_OWNER,
    accountKind: "eoa",
    source,
    dryRun: false,
    createdAt: AT,
    actions,
    steps: steps.map((s) => ({ id: s.id, kind: s.kind, venue: s.venue, summary: s.summary, inputs: s.inputs, outputs: s.outputs, ...(s.fee ? { fee: s.fee } : {}), settlement: s.settlement, ...(s.route ? { route: s.route } : {}), stage: 1, status: s.status, gasUnits: s.kind === "transfer" ? 125_000 : 240_000, action: 0, usd: s.inputs[0]?.usd ?? null, ...(recipient ? { recipient } : {}), ...(s.kind === "fx" ? { fxDeviationBps: 6 } : {}), params: {} })),
    verdict: { decision: verdict.decision, reasons: verdict.reasons },
    fence: DEFAULT_FENCE,
    spent: { dayUsd: "0.00", weekUsd: "0.00" },
  };
}

/** The owner's case: "buy EURC with 2 USDC" from a wallet holding 2.01 USDC. */
export function gasPlan(): { graph: IntentGraph; proposal: AgentProposal; text: string } {
  const id = "out_kitPreflightGas";
  const source = "buy EURC with 2 USDC";
  const fx: IntentStep = {
    id: "s1",
    kind: "fx",
    venue: "uniswap-v4",
    summary: "Convert 1.98 USDC -> 1.7741 EURC on Uniswap v4 0.05% pool (min 1.7652)",
    signer: "wallet",
    account: KIT_OWNER,
    dependsOn: [],
    inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "2000000", usd: "2.00" }],
    outputs: [{ symbol: "EURC", token: EURC, decimals: 6, amount: "1774100", minimum: "1765200", usd: "1.98" }],
    fee: { bps: 100, recipient: FEE, symbol: "USDC", token: USDC, decimals: 6, amount: "20000", usd: "0.02", basis: "input" },
    settlement: { kind: "receipt" },
    route: { chosen: { venue: "uniswap-v4", label: "Uniswap v4 0.05% pool", risk: "low", executable: true, notes: [] }, alternatives: [], reason: "Uniswap v4 0.05% pool gives the most after gas." },
    status: "ready",
    stage: 1,
  } as IntentStep;
  const findings = runPreflight(planOf(id, source, [fx], [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "2" } }]), state("2010000"));
  const graph = graphOf(id, source, [fx], findings);
  const lead = findings[0]?.say ?? "";
  const fix = findings[0]?.fixes[0];
  return {
    graph,
    proposal: { intentId: id, title: source, steps: [fx.summary], decision: "allow", reasons: [], warnings: [], preflight: findings, attribution: [{ agent: "FX hedger", role: "fx-hedger", part: "fx" }], rationale: "" },
    text: `${lead}${fix?.question ? ` ${fix.question}` : ""}\n\n- ${fx.summary}\n\n**Next:** pick a fix below, or review and sign it as it is.`,
  };
}

/**
 * A tester's case: "Bridge 1 USDC to Base" on testnet from a wallet holding
 * 1.02 USDC. The plan is real (Fence and preflight computed by core); the
 * question is the one Lyko asks when a bridge would leave nothing for gas.
 */
export function bridgePlan(): { graph: IntentGraph; proposal: AgentProposal; text: string; clarify: { question: string; options: string[] } } {
  const id = "out_kitBridgeBase";
  const source = "Bridge 1 USDC to Base";
  const bridge: IntentStep = {
    id: "s1",
    kind: "bridge",
    venue: "cctp",
    summary: tx("Bridge {display} to {destinationName} over CCTP{value}", { display: "0.99 USDC", destinationName: "Base", value: tx(" (Circle forwards the mint)") }),
    signer: "wallet",
    account: KIT_OWNER,
    dependsOn: [],
    inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "1000000", usd: "1.00" }],
    outputs: [{ symbol: "USDC@base", token: USDC, decimals: 6, amount: "990000", usd: "0.99" }],
    fee: { bps: 100, recipient: FEE, symbol: "USDC", token: USDC, decimals: 6, amount: "10000", usd: "0.01", basis: "input" },
    settlement: { kind: "cctp", destination: "base", expectedSeconds: 20 },
    route: { chosen: { venue: "cctp", label: "CCTP", risk: "low", executable: true, notes: [] }, alternatives: [], reason: "As asked: cctp." },
    status: "ready",
    stage: 1,
  } as IntentStep;
  const plan = { ...planOf(id, source, [bridge], [{ verb: "bridge", token: "USDC", amount: { exact: "1" }, destination: "base" }]), environment: "testnet" as const };
  const findings = runPreflight(plan, state("1020000"));
  const fenceVerdict = evaluateFence(DEFAULT_FENCE, { environment: "testnet", signer: "wallet", owner: KIT_OWNER, proposedByAgent: true, steps: [{ id: "s1", kind: "bridge", venue: "cctp", usd: "1.00", tokens: [], destination: "base", fee: { line: "Lykia fee 1% · 0.01 USDC", usd: "0.01" } }], spent: { dayUsd: "0", weekUsd: "0" }, now: NOW });
  const graph = { ...graphOf(id, source, [bridge], findings), environment: "testnet", verdict: fenceVerdict } as IntentGraph;
  return {
    graph,
    proposal: { intentId: id, title: "bridge", steps: [bridge.summary], decision: fenceVerdict.decision, reasons: fenceVerdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message), warnings: [], preflight: findings, attribution: [{ agent: "Lyko", role: "orchestrator", part: "bridge" }], rationale: "Route search winner: As asked: cctp (net -0.21 USD over 90 days; beat 0 other options)." },
    clarify: { question: tx("How would you like to proceed? Bridging everything leaves no USDC for Arc gas."), options: [tx("Bridge {amount} {symbol} to {name}", { amount: "1", symbol: "USDC", name: "Base" }), tx("Bridge idle USDC but keep a gas reserve on Arc"), tx("Cancel this bridge")] },
    text: `${findings[0]?.say ?? ""}\n\n- ${bridge.summary}`,
  };
}

/** A lookalike of a supplier the owner paid before (address poisoning). */
export function poisonedPlan(): { graph: IntentGraph; proposal: AgentProposal; text: string } {
  const id = "out_kitPreflightPoison";
  const source = `send 250 USDC to ${LOOKALIKE}`;
  const send: IntentStep = {
    id: "s1",
    kind: "transfer",
    venue: "arc",
    summary: `Send 250 USDC to ${LOOKALIKE}`,
    signer: "wallet",
    account: KIT_OWNER,
    dependsOn: [],
    inputs: [{ symbol: "USDC", token: USDC, decimals: 6, amount: "252500000", usd: "252.50" }],
    outputs: [],
    fee: { bps: 100, recipient: FEE, symbol: "USDC", token: USDC, decimals: 6, amount: "2500000", usd: "2.50", basis: "on-top" },
    settlement: { kind: "receipt" },
    status: "ready",
    stage: 1,
  } as IntentStep;
  const findings = runPreflight(planOf(id, source, [send], [{ verb: "send", token: "USDC", amount: { exact: "250" }, to: LOOKALIKE as `0x${string}` }], LOOKALIKE), state("1800000000", { counterparties: [{ address: SUPPLIER, label: "Supplier" }] }));
  const graph = graphOf(id, source, [send], findings);
  return {
    graph,
    proposal: { intentId: id, title: source, steps: [send.summary], decision: "allow", reasons: [], warnings: [], preflight: findings, attribution: [{ agent: "Payroll", role: "payroll", part: "send" }], rationale: "" },
    text: `${findings[0]?.say ?? ""}\n\n- ${send.summary}\n\n**Next:** pick a fix below; this can't be signed as it is.`,
  };
}

/** Lyko on watch after the owner's trade: 0.01 USDC left beside 1.77 EURC. */
export function gasEmptyInsight(): FoldInsight {
  const f = watchFindings({ now: NOW, owner: KIT_OWNER, usdc: "10000", read: { source: "Arc chain · native USDC", readAt: AT }, holdings: [{ symbol: "EURC", units: "1774100", decimals: 6, usd: "1.98" }], gasReserveUsdc: "0.5", gas: { priceWei: "20000000000", read: { source: "Arc chain · eth_gasPrice", readAt: AT } }, minFeeGwei: 20, obligations: [], inFlight: [] }).find((x) => x.id === "gas-empty")!;
  const fix = f.fixes[0]!;
  return { id: "gas-floor", kind: "gas-floor", severity: "act", title: f.title, explain: f.why, figures: f.figures.map((x) => ({ label: x.label, value: x.value })), draft: { label: fix.label, sentence: null, ...(fix.address ? { receive: fix.address as `0x${string}` } : {}) }, handled: false, from: { source: f.figures[0]!.source, readAt: AT, block: "29836287" } };
}
