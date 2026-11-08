/**
 * "Prove it": every flow's exact prepared calldata, simulated on Arc
 * mainnet with eth_call. Nothing is signed or broadcast.
 *
 * Plans go through the real planner (dry run, Lykia's fee, the Fence and
 * the beta cap), then their calls are built by the same adapters prepare
 * uses and run as one Multicall3From batch from the owner (simulate.ts).
 * Inputs the owner does not hold are funded with state overrides. Agent
 * operations run against the deployed LykiaAccountFactory: the account is
 * created, funded and given a session inside the batch, and the agent's
 * signed transfer runs in the same batch.
 *
 * Run: npm run prove -w @lykia/api   (PROVE_OWNER overrides the sender)
 */
import { contractAddress, decodeMemo, DEFAULT_FENCE, getToken, invoiceIdFromNote, invoiceNote, lykiaContracts, memoData, payoutNote, tokenAddress, verdictTag, type Address, type Fence, type PlanAction } from "@lykia/core";
import { decodeErrorResult, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, numberToHex, pad, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config.js";
import { closeContext, createContext } from "../context.js";
import { MemoryStore } from "../store/memory.js";
import { systemClock } from "../clock.js";
import { services } from "../services.js";
import { MULTICALL3_FROM_ABI } from "../engine/abis.js";
import { externalInputs } from "../engine/search.js";
import { revertReason, simulateRoute, type SimStep } from "../engine/simulate.js";
import { ACCOUNT_SALT, sessionCalldata, type SessionSpec } from "../agents/onchain.js";
import { MORPHO_MARKETS } from "../engine/venues/morphoBlue.js";
import { proveAggregator } from "./proveAggregator.js";
import { proveCircle } from "./proveCircle.js";
import { buildBatch } from "../devflows/batch.js";
import { invoiceFence } from "../devflows/invoices.js";
import { findBalanceSlot } from "../engine/simulate.js";

const OWNER = (process.env.PROVE_OWNER ?? "0xada5bb90d0de0bd1b6f3938708f49295a8d1f7cb") as Address;
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const PAYEE_FENCE: Fence = { ...DEFAULT_FENCE, recipients: { mode: "allowlist", allow: [PAYEE] } };
const GALAXY = "0x8E357432CC12ff425c36432F312968aEb16112AF" as Address;
const MAIN_SPOKE = "0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d" as Address;

const config = loadConfig({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/DATABASE_URL|POSTGRES_URL/u.test(k))), NODE_ENV: "development", LYKIA_MODE: "mainnet", LYKIA_LOG_LEVEL: "silent" });
const ctx = createContext(config, { store: new MemoryStore(systemClock) });
const s = services(ctx);
const client = ctx.chains.client("mainnet");

interface Row {
  readonly flow: string;
  readonly result: "PASS" | "FAIL" | "REFUSED (expected)" | "GATED";
  readonly detail: string;
}
const rows: Row[] = [];
const record = (row: Row) => {
  rows.push(row);
  process.stdout.write(`${row.result.padEnd(18)} ${row.flow} — ${row.detail}\n`);
};

let n = 0;
async function provePlan(flow: string, actions: PlanAction[], options: { fence?: Fence; expectRefusal?: RegExp } = {}): Promise<void> {
  try {
    const planned = await s.planner.plan({ id: `out_prove${(n++).toString().padStart(4, "0")}`, environment: "mainnet", owner: OWNER, signer: "wallet", actions, fence: options.fence ?? DEFAULT_FENCE, source: flow, now: Date.now(), spent: { dayUsd: "0", weekUsd: "0" }, dryRun: true });
    const verdict = planned.graph.verdict;
    if (verdict.decision === "deny") {
      const reasons = verdict.reasons.filter((r) => r.decision === "deny").map((r) => r.message).join("; ");
      record({ flow, result: options.expectRefusal?.test(reasons) ? "REFUSED (expected)" : "FAIL", detail: `Fence deny: ${reasons}` });
      return;
    }
    const steps: SimStep[] = planned.graph.steps.map((st) => ({ id: st.id, plan: planned.plans[st.id]! }));
    const sim = await simulateRoute(ctx.chains, "mainnet", OWNER, { intentId: planned.graph.id, verdictDigest: verdict.digest, steps, fund: externalInputs(planned.graph.steps) });
    const summary = planned.graph.steps.map((st) => `${st.summary}${st.fee ? ` [fee ${st.fee.amount} ${st.fee.symbol} units]` : ""}`).join(" → ");
    record({ flow, result: sim.ok ? "PASS" : "FAIL", detail: `${sim.ok ? `${sim.calls.length} calls ok at block ${sim.block}` : sim.reason}. ${summary}. Fence ${verdict.decision}.${sim.funded.length ? ` Funded: ${sim.funded.map((f) => `${f.symbol} (${f.how.split(" (")[0]})`).join(", ")}.` : ""}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record({ flow, result: options.expectRefusal?.test(message) ? "REFUSED (expected)" : "FAIL", detail: message });
  }
}

async function proveRaw(flow: string, steps: SimStep[], fund: { symbol: string; units: bigint }[]): Promise<void> {
  const sim = await simulateRoute(ctx.chains, "mainnet", OWNER, { intentId: `out_prove${(n++).toString().padStart(4, "0")}`, verdictDigest: `sha256:${"0".repeat(64)}`, steps, fund });
  record({ flow, result: sim.ok ? "PASS" : "FAIL", detail: sim.ok ? `${sim.calls.map((c) => c.label).join(" → ")} (block ${sim.block})` : sim.reason ?? "failed" });
}

const ACCOUNT_ABI = lykiaContracts.lykiaAccountArtifact.abi;
const FACTORY_ABI = lykiaContracts.lykiaAccountFactoryArtifact.abi;
const usdc = contractAddress("usdc", "mainnet") as Address;

/** One aggregate3 from the owner, with the owner's native USDC topped up. Returns the first failure's decoded reason. */
async function ownerBatch(calls: { to: Address; data: Hex; label: string }[]): Promise<{ ok: boolean; reason?: string }> {
  const data = encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [calls.map((c) => ({ target: c.to, allowFailure: true, callData: c.data }))] });
  const balance = await client.getBalance({ address: OWNER });
  const result = await client.call({ account: OWNER, to: contractAddress("multicall3From", "mainnet") as Address, data, stateOverride: [{ address: OWNER, balance: balance + 1_000n * 10n ** 18n }] });
  const decoded = decodeFunctionResult({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", data: result.data as Hex }) as readonly { success: boolean; returnData: Hex }[];
  const index = decoded.findIndex((r) => !r.success);
  if (index < 0) return { ok: true };
  const raw = decoded[index]!.returnData;
  let reason = revertReason(raw);
  try {
    const err = decodeErrorResult({ abi: ACCOUNT_ABI, data: raw });
    reason = `${err.errorName}(${(err.args ?? []).map(String).join(", ")})`;
  } catch {
    /* keep the generic reason */
  }
  return { ok: false, reason: `${calls[index]!.label}: ${reason}` };
}

async function proveAgent(): Promise<void> {
  const factory = lykiaContracts.deployedAddress("mainnet", "LykiaAccountFactory") as Address | null;
  if (!factory) {
    record({ flow: "Agent account", result: "GATED", detail: "LykiaAccountFactory is not deployed." });
    return;
  }
  const guardian = "0x0000000000000000000000000000000000000000" as Address;
  const account = (await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: "predictAccount", args: [OWNER, ACCOUNT_SALT, guardian, usdc] })) as Address;
  const exists = ((await client.getCode({ address: account })) ?? "0x") !== "0x";
  const agent = privateKeyToAccount(generatePrivateKey());
  const now = Math.floor(Date.now() / 1000);
  const spec: SessionSpec = {
    key: agent.address,
    validUntil: BigInt(now + 7 * 86_400),
    maxCalls: 10,
    fenceHash: keccak256("0x01"),
    tokens: [{ token: usdc, perCall: 25_000_000n, daily: 50_000_000n, budget: 100_000_000n }],
    calls: [],
    recipients: [PAYEE],
  };
  const sessionNonce = exists ? ((await client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "sessionNonce" })) as bigint) : 0n;
  const sessionId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [account, agent.address, sessionNonce + 1n]));
  const signTransfer = async (amount: bigint, to: Address, nonce: bigint) => {
    const deadline = BigInt(now + 3600);
    const signature = await agent.signTypedData({
      domain: { name: "LykiaAccount", version: "1", chainId: 5042, verifyingContract: account },
      types: { AgentTransfer: [{ name: "sessionId", type: "bytes32" }, { name: "token", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "memoHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType: "AgentTransfer",
      message: { sessionId, token: usdc, to, amount, memoHash: keccak256("0x"), nonce, deadline },
    });
    return { to: account, data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "agentTransferWithSig", args: [sessionId, usdc, to, amount, "0x", nonce, deadline, signature] }), label: `agent pays ${Number(amount) / 1e6} USDC to ${to.slice(0, 6)}…` };
  };
  const setup = [
    ...(exists ? [] : [{ to: factory, data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "createAccount", args: [OWNER, ACCOUNT_SALT, guardian, usdc] }), label: "createAccount (deployed factory)" }]),
    { to: usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, 60_000_000n] }), label: "fund the account with 60 USDC" },
    { to: account, data: sessionCalldata(spec), label: "createSession (25 USDC per call, 50 a day, payee allowlist)" },
  ];
  const within = await ownerBatch([...setup, await signTransfer(20_000_000n, PAYEE, 0n)]);
  record({ flow: "Agent: create LykiaAccount → fund → session with Fence limits → agent transfer within caps", result: within.ok ? "PASS" : "FAIL", detail: within.ok ? `account ${account}, session key ${agent.address.slice(0, 8)}…: 20 USDC to the allowlisted payee passed` : within.reason ?? "" });
  const over = await ownerBatch([...setup, await signTransfer(30_000_000n, PAYEE, 0n)]);
  record({ flow: "Agent: transfer above the per-call cap", result: !over.ok && /PerCallCapExceeded/u.test(over.reason ?? "") ? "REFUSED (expected)" : "FAIL", detail: over.reason ?? "unexpectedly passed" });
  const stranger = await ownerBatch([...setup, await signTransfer(5_000_000n, "0x3333333333333333333333333333333333333333", 0n)]);
  record({ flow: "Agent: transfer to a recipient outside the session", result: !stranger.ok && /RecipientNotAllowed/u.test(stranger.reason ?? "") ? "REFUSED (expected)" : "FAIL", detail: stranger.reason ?? "unexpectedly passed" });
  const revoked = await ownerBatch([...setup, { to: account, data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "revokeSession", args: [sessionId] }), label: "revokeSession" }, await signTransfer(5_000_000n, PAYEE, 0n)]);
  record({ flow: "Agent: revoke, then the agent tries again", result: !revoked.ok && /SessionInvalid|revoke/iu.test(revoked.reason ?? "") ? "REFUSED (expected)" : "FAIL", detail: revoked.reason ?? "unexpectedly passed" });
  const whistle = await ownerBatch([...setup, { to: account, data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "blowWhistle" }), label: "blowWhistle" }, await signTransfer(5_000_000n, PAYEE, 0n)]);
  record({ flow: "Agent: Whistle blown, then a payment to a stranger", result: !whistle.ok ? "REFUSED (expected)" : "FAIL", detail: whistle.reason ?? "unexpectedly passed" });
}

async function proveTag(): Promise<void> {
  const registry = contractAddress("identityRegistry", "mainnet") as Address;
  try {
    await client.call({ account: OWNER, to: registry, data: encodeFunctionData({ abi: parseAbi(["function register(string agentURI) returns (uint256)"]), functionName: "register", args: ["https://lykiaai.com/v1/tags/card/prove.json"] }) });
    record({ flow: "Tag register (ERC-8004 IdentityRegistry.register)", result: "PASS", detail: `eth_call from the owner to ${registry}` });
  } catch (error) {
    record({ flow: "Tag register (ERC-8004 IdentityRegistry.register)", result: "FAIL", detail: error instanceof Error ? error.message.split("\n")[0]! : String(error) });
  }
}


/** State overrides that give the owner `units` of each token (native USDC through the balance, others through their balance slot). */
async function fundOwner(needs: { symbol: string; units: bigint }[]): Promise<{ address: Address; balance?: bigint; stateDiff?: { slot: Hex; value: Hex }[] }[]> {
  const out: { address: Address; balance?: bigint; stateDiff?: { slot: Hex; value: Hex }[] }[] = [];
  const native = await client.getBalance({ address: OWNER });
  let extra = 10n ** 18n;
  for (const need of needs) {
    if (need.symbol === "USDC") {
      extra += need.units * 10n ** 12n;
      continue;
    }
    const token = tokenAddress(getToken(need.symbol)!, "mainnet") as Address;
    const slot = await findBalanceSlot(ctx.chains, "mainnet", token, OWNER);
    if (!slot) throw new Error(`no balance slot for ${need.symbol}`);
    const a = pad(OWNER, { size: 32 });
    const sl = pad(numberToHex(slot.slot), { size: 32 });
    const key = keccak256(slot.vyper ? (`${sl}${a.slice(2)}` as Hex) : (`${a}${sl.slice(2)}` as Hex));
    const current = (await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [OWNER] })) as bigint;
    out.push({ address: token, stateDiff: [{ slot: key, value: pad(numberToHex(current + need.units), { size: 32 }) }] });
  }
  out.push({ address: OWNER, balance: native + extra });
  return out;
}

/** Payouts: three recipients, two tokens, one Multicall3From transaction exactly as POST /v1/payouts builds it (allowFailure false). */
async function provePayoutBatch(): Promise<void> {
  const flow = "Payout batch: 3 recipients (USDC, USDC, EURC) in one Multicall3From transaction, an Arc Memo per row";
  const payees = [PAYEE, "0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444"] as Address[];
  const rows = [
    { to: payees[0]!, token: "USDC", amount: "40", reference: "INV-1001" },
    { to: payees[1]!, token: "USDC", amount: "25", reference: "INV-1002" },
    { to: payees[2]!, token: "EURC", amount: "15", reference: "INV-1003" },
  ];
  try {
    const fence: Fence = { ...DEFAULT_FENCE, recipients: { mode: "allowlist", allow: payees }, confirm: { when: [] } };
    const actions: PlanAction[] = rows.map((r) => ({ verb: "send", token: r.token, amount: { exact: r.amount }, to: r.to, memo: payoutNote("po_prove000001", { reference: r.reference }) }));
    const planned = await s.planner.plan({ id: `out_prove${(n++).toString().padStart(4, "0")}`, environment: "mainnet", owner: OWNER, signer: "wallet", actions, fence, source: flow, now: Date.now(), spent: { dayUsd: "0", weekUsd: "0" }, dryRun: true });
    const verdict = planned.graph.verdict;
    if (verdict.decision === "deny") {
      record({ flow, result: "FAIL", detail: `Fence deny: ${verdict.reasons.filter((r) => r.decision === "deny").map((r) => r.message).join("; ")}` });
      return;
    }
    const steps = planned.graph.steps.map((st) => ({ id: st.id, plan: planned.plans[st.id]! }));
    const built = await buildBatch(ctx.chains, "mainnet", OWNER, planned.graph.id, verdict.digest, steps);
    const fees = planned.graph.steps.map((st) => (st.fee ? BigInt(st.fee.amount) : 0n));
    const usdcUnits = BigInt(Math.round((40 + 25) * 1e6)) + fees[0]! + fees[1]!;
    const eurcUnits = 15_000_000n + fees[2]!;
    const block = await client.getBlockNumber();
    await client.call({ account: OWNER, to: built.transaction.to, data: built.transaction.data, blockNumber: block, stateOverride: await fundOwner([{ symbol: "USDC", units: usdcUnits }, { symbol: "EURC", units: eurcUnits }]) });
    const memos = planned.graph.steps.map((st) => memoData({ intentId: planned.graph.id, stepId: st.id, verdict: verdictTag(verdict.digest), ...(planned.plans[st.id]!.params.note ? { note: planned.plans[st.id]!.params.note } : {}) }));
    const notes = memos.map((m) => decodeMemo(m)?.note ?? "");
    record({ flow, result: notes.every((t, i) => t.includes(rows[i]!.reference)) ? "PASS" : "FAIL", detail: `1 transaction, ${built.calls} inner calls (3 fee transfers + 3 memo-wrapped transfers) ok at block ${block}. ${planned.graph.steps.map((st) => `${st.summary} [fee ${st.fee?.amount ?? 0} units]`).join(" + ")}. Fence ${verdict.decision}. Memo notes: ${notes.join(" / ")}. Funded: USDC (native balance override), EURC (storage override).` });
  } catch (error) {
    record({ flow, result: "FAIL", detail: error instanceof Error ? error.message.split("\n")[0]! : String(error) });
  }
}

/** Invoices: the payer's transfer as the hosted page plans it (invoice Fence, memo "invoice inv_…"), then reconciliation reads the memo. */
async function proveInvoicePayment(): Promise<void> {
  const id = "inv_prove0000001";
  const invoice = { payee: PAYEE, token: "USDC" };
  for (const [flow, amount] of [["Invoice payment: pay 120 USDC invoice in full through the pay page's plan", "120"], ["Invoice payment: partial payment of 50 USDC on the same invoice", "50"]] as const) {
    try {
      const actions: PlanAction[] = [{ verb: "send", token: "USDC", amount: { exact: amount }, to: PAYEE, memo: invoiceNote(id, "INV-77") }];
      const planned = await s.planner.plan({ id: `out_prove${(n++).toString().padStart(4, "0")}`, environment: "mainnet", owner: OWNER, signer: "wallet", actions, fence: invoiceFence(invoice), source: flow, now: Date.now(), spent: { dayUsd: "0", weekUsd: "0" }, dryRun: true });
      const verdict = planned.graph.verdict;
      if (verdict.decision === "deny") {
        record({ flow, result: "FAIL", detail: `Fence deny: ${verdict.reasons.filter((r) => r.decision === "deny").map((r) => r.message).join("; ")}` });
        continue;
      }
      const steps: SimStep[] = planned.graph.steps.map((st) => ({ id: st.id, plan: planned.plans[st.id]! }));
      const sim = await simulateRoute(ctx.chains, "mainnet", OWNER, { intentId: planned.graph.id, verdictDigest: verdict.digest, steps, fund: externalInputs(planned.graph.steps) });
      const st = planned.graph.steps[0]!;
      const memo = decodeMemo(memoData({ intentId: planned.graph.id, stepId: st.id, verdict: verdictTag(verdict.digest), note: planned.plans[st.id]!.params.note ?? "" }));
      const reconciles = invoiceIdFromNote(memo?.note) === id;
      record({ flow, result: sim.ok && reconciles ? "PASS" : "FAIL", detail: `${sim.ok ? `${sim.calls.length} calls ok at block ${sim.block}` : sim.reason}. ${st.summary} [fee ${st.fee?.amount ?? 0} USDC units]. Fence ${verdict.decision} (invoice Fence: this payee and token only). Memo note "${memo?.note ?? ""}" reconciles to ${reconciles ? id : "nothing"}.` });
    } catch (error) {
      record({ flow, result: "FAIL", detail: error instanceof Error ? error.message.split("\n")[0]! : String(error) });
    }
  }
}

const usdcUnits = (v: string) => BigInt(Math.round(Number(v) * 1e6));
const market = MORPHO_MARKETS.mainnet![0]!;
const cirbtc = tokenAddress(getToken("cirBTC")!, "mainnet") as Address;

await provePlan("Send 25 USDC with a memo to an allowlisted payee", [{ verb: "send", token: "USDC", amount: { exact: "25" }, to: PAYEE, memo: "invoice 7" }], { fence: PAYEE_FENCE });
await provePlan("Send 20 EURC", [{ verb: "send", token: "EURC", amount: { exact: "20" }, to: PAYEE }], { fence: PAYEE_FENCE });
await provePlan("Send 15 MXNB (partner stablecoin, priced at its peg)", [{ verb: "send", token: "MXNB", amount: { exact: "15" }, to: PAYEE }], { fence: { ...PAYEE_FENCE, tokens: { allow: ["USDC", "EURC", "MXNB"], unlisted: "deny" } } as Fence });
await provePlan("Send 15 GBPA (no GBP price on Arc)", [{ verb: "send", token: "GBPA", amount: { exact: "15" }, to: PAYEE }], { fence: { ...PAYEE_FENCE, tokens: { allow: ["USDC", "EURC", "GBPA"], unlisted: "deny" } } as Fence, expectRefusal: /no USD price/u });
await provePlan("Send 0.01 WETH", [{ verb: "send", token: "WETH", amount: { exact: "0.01" }, to: PAYEE }], { fence: { ...PAYEE_FENCE, tokens: { allow: ["USDC", "EURC", "WETH"], unlisted: "deny" } } as Fence });
await provePlan("FX 100 USDC → EURC", [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }]);
await provePlan("FX 100 EURC → USDC", [{ verb: "fx", from: "EURC", to: "USDC", amount: { exact: "100" } }]);
await provePlan("Swap 100 USDC → cirBTC", [{ verb: "swap", from: "USDC", to: "cirBTC", amount: { exact: "100" } }]);
await provePlan("Swap 50 USDC → WETH", [{ verb: "swap", from: "USDC", to: "WETH", amount: { exact: "50" } }], { fence: { ...DEFAULT_FENCE, tokens: { allow: ["USDC", "EURC", "cirBTC", "WETH"], unlisted: "deny" } } as Fence });
await provePlan("Earn: deposit 200 USDC (best vault or Aave)", [{ verb: "earn", token: "USDC", amount: { exact: "200" } }]);
await provePlan("Earn: deposit 100 EURC", [{ verb: "earn", token: "EURC", amount: { exact: "100" }, maxRisk: "high" }]);
await proveRaw("Earn: deposit 100 USDC into Morpho Galaxy, then withdraw 50 (one batch)", [
  { id: "s1", plan: { adapter: "vault-deposit", params: { vault: GALAXY, vaultName: "Morpho Galaxy USDC", token: usdc, symbol: "USDC", decimals: "6", amount: usdcUnits("100").toString(), display: "100 USDC" } } },
  { id: "s2", plan: { adapter: "vault-withdraw", params: { vault: GALAXY, vaultName: "Morpho Galaxy USDC", mode: "withdraw", amount: usdcUnits("50").toString(), shares: "0", display: "50 USDC", decimals: "6", symbol: "USDC" } } },
], [{ symbol: "USDC", units: usdcUnits("100") }]);
await proveRaw("Aave V4: supply 100 USDC, then withdraw all", [
  { id: "s1", plan: { adapter: "aave-supply", params: { spoke: MAIN_SPOKE, spokeName: "Aave V4 Main Spoke", reserveId: "0", token: usdc, symbol: "USDC", decimals: "6", amount: usdcUnits("100").toString(), display: "100 USDC" } } },
  { id: "s2", plan: { adapter: "aave-withdraw", params: { spoke: MAIN_SPOKE, spokeName: "Aave V4 Main Spoke", reserveId: "0", mode: "all", amount: "0", display: "all USDC", decimals: "6", symbol: "USDC" } } },
], [{ symbol: "USDC", units: usdcUnits("100") }]);
await provePlan("Borrow 300 USDC against cirBTC (health ≥ 1.8, best venue)", [{ verb: "borrow", token: "USDC", amount: { exact: "300" }, collateral: { token: "cirBTC" }, minHealth: "1.8" }]);
await proveRaw("Aave V4: post 0.01 cirBTC, borrow 200 USDC, repay 200 USDC (one batch)", [
  { id: "s1", plan: { adapter: "aave-borrow", params: { spoke: MAIN_SPOKE, spokeName: "Aave V4 Main Spoke", loanReserve: "0", collReserve: "2", loanToken: usdc, collToken: cirbtc, loanSymbol: "USDC", collSymbol: "cirBTC", decimals: "8", loanDecimals: "6", amount: usdcUnits("200").toString(), collateral: "1000000", display: "200 USDC" } } },
  { id: "s2", plan: { adapter: "aave-repay", params: { spoke: MAIN_SPOKE, spokeName: "Aave V4 Main Spoke", reserveId: "0", token: usdc, symbol: "USDC", amount: usdcUnits("200").toString(), mode: "exact", display: "200 USDC", decimals: "6" } } },
], [{ symbol: "cirBTC", units: 1_000_000n }]);
await proveRaw("Morpho Blue: post 0.01 cirBTC, borrow 200 USDC, repay 200 USDC (one batch)", [
  { id: "s1", plan: { adapter: "morpho-borrow", params: { market: market.id, loanToken: usdc, collToken: cirbtc, loanSymbol: "USDC", collSymbol: "cirBTC", decimals: "8", loanDecimals: "6", amount: usdcUnits("200").toString(), collateral: "1000000", display: "200 USDC" } } },
  { id: "s2", plan: { adapter: "morpho-repay", params: { market: market.id, token: usdc, symbol: "USDC", amount: usdcUnits("200").toString(), mode: "exact", display: "200 USDC", decimals: "6" } } },
], [{ symbol: "cirBTC", units: 1_000_000n }]);
await provePlan("Borrow 1000 USDC on cirBTC and put it to work (health ≥ 1.8)", [{ verb: "borrow", token: "USDC", amount: { exact: "1000" }, collateral: { token: "cirBTC" }, minHealth: "1.8" }, { verb: "earn", token: "USDC", amount: { previous: true } }]);
await provePlan("CCTP V2 out: bridge 50 USDC to Base (standard; Circle's Forwarding Service mints on Base)", [{ verb: "bridge", token: "USDC", amount: { exact: "50" }, destination: "base" }]);
await provePlan("Gateway: deposit 40 USDC into the unified balance", [{ verb: "unify", amount: { exact: "40" } }]);
await provePlan("Complex intent: 40% best vault, 20% to EURC, bridge the rest to Base (of 500 USDC kept as base)", [{ verb: "earn", token: "USDC", amount: { exact: "200" } }, { verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }, { verb: "bridge", token: "USDC", amount: { exact: "195" }, destination: "base" }]);
await provePlan("Convert 500 USDC to EURC, then pay 200 EURC for invoice 7", [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "500" } }, { verb: "send", token: "EURC", amount: { exact: "200" }, to: PAYEE, memo: "invoice 7" }], { fence: PAYEE_FENCE });
await provePlan("Beta cap: send 1500 USDC under a loose Fence", [{ verb: "send", token: "USDC", amount: { exact: "1500" }, to: PAYEE }], { fence: { ...PAYEE_FENCE, caps: { perStepUsd: "1000000", perIntentUsd: "1000000", dailyUsd: "1000000", weeklyUsd: "1000000" }, confirm: { aboveUsd: "1000000", when: [] } }, expectRefusal: /beta|cap/iu });
await provePlan("Fence: Shepherd refuses a stranger", [{ verb: "send", token: "USDC", amount: { exact: "10" }, to: PAYEE }], { expectRefusal: /not the owner|recipient/iu });
await proveTag();
await proveAggregator(ctx, OWNER, record);
await proveCircle(ctx, OWNER, record);
await proveAgent();
await provePayoutBatch();
await proveInvoicePayment();
const orders = lykiaContracts.deployedAddress("mainnet", "LykiaOrders");
record({ flow: "LykiaOrders (limit, stop-loss, DCA, TWAP)", result: orders ? "PASS" : "GATED", detail: orders ? `deployed at ${orders}` : "Not deployed on mainnet: the Orders page shows “deploy from the owner console”." });

process.stdout.write(`\n| Flow | Result | Detail |\n|---|---|---|\n${rows.map((r) => `| ${r.flow} | ${r.result} | ${r.detail.replace(/\|/gu, "/")} |`).join("\n")}\n`);
await closeContext(ctx);
process.exit(rows.some((r) => r.result === "FAIL") ? 1 : 0);
