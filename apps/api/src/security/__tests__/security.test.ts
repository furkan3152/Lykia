import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FEE_RECIPIENT, DEFAULT_FENCE, type UnsignedTransaction } from "@lykia/core";
import { SESSION_HEADER } from "@lykia/core/api/platform";
import { analyzeFlow, verifyAuditChain, type AuditEntry, type SecurityReport } from "@lykia/core/security/index";
import { encodeFunctionData, erc20Abi, maxUint256, type Address, type Hex } from "viem";
import { createApp } from "../../app.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { approveCall, feeCall, shape } from "../../engine/calls.js";
import { issueToken } from "../../platform/session.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "../../__tests__/support.js";
import { decodeTransactions } from "../decode.js";
import { simulateStep } from "../simulate.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as Address;
const ADMIN = "0x8c5281055b197443ff01dbbdfbf29fd63946ca1e";
const FRIEND = "0x1111111111111111111111111111111111111111" as Address;
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const VAULT = "0x4444444444444444444444444444444444444444" as Address;
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const SECRETS = { LYKIA_SESSION_SECRET: "s".repeat(40) + "-session-sentinel", CIRCLE_API_KEY: "TEST_API_KEY:circle-sentinel-0001", CIRCLE_ENTITY_SECRET: "e".repeat(64), TELEGRAM_BOT_TOKEN: "123456:telegram-sentinel", ANTHROPIC_API_KEY: "sk-ant-sentinel-0001" };

const transfer = (to: Address, amount: bigint) => ({ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), label: "send" });
const shapeOpts = { environment: "testnet" as const, chainId: 5042002, from: OWNER, memo: { intentId: "out_test0001", stepId: "s1", verdict: "0000000000000000" }, account: "eoa" as const };
const sendFlow = { stepId: "s1", account: OWNER, owner: OWNER, kind: "transfer", inputs: [{ token: USDC, symbol: "USDC", amount: "20000000" }], fees: [{ token: USDC, recipient: DEFAULT_FEE_RECIPIENT as Address, amount: "200000" }], recipients: [FRIEND], knownContracts: [] };

describe("security layer: decode and balance diff", () => {
  it("passes the engine's own batch and decodes it into plain lines", () => {
    const txs = shape([feeCall(USDC, DEFAULT_FEE_RECIPIENT as Address, 200_000n, "fee"), transfer(FRIEND, 20_000_000n)], null, shapeOpts);
    const calls = decodeTransactions(txs);
    assert.deepEqual(calls.map((c) => c.kind), ["erc20-transfer", "erc20-transfer"]);
    const flow = analyzeFlow(sendFlow, calls);
    assert.deepEqual(flow.findings, []);
    assert.equal(flow.summary.balanceChanges[0]?.out, "20200000");
  });

  it("blocks a changed recipient, a fee overcharge and an outflow beyond the plan", () => {
    const thief = "0x9999999999999999999999999999999999999999" as Address;
    const rules = (txs: UnsignedTransaction[]) => analyzeFlow(sendFlow, decodeTransactions(txs)).findings.map((f) => f.rule);
    assert.ok(rules(shape([feeCall(USDC, DEFAULT_FEE_RECIPIENT as Address, 200_000n, "fee"), transfer(thief, 20_000_000n)], null, shapeOpts)).includes("simulation.unexpected-transfer"));
    assert.ok(rules(shape([feeCall(USDC, DEFAULT_FEE_RECIPIENT as Address, 2_000_000n, "fee"), transfer(FRIEND, 20_000_000n)], null, shapeOpts)).includes("simulation.fee-overcharge"));
    assert.ok(rules(shape([feeCall(USDC, DEFAULT_FEE_RECIPIENT as Address, 200_000n, "fee"), transfer(FRIEND, 25_000_000n)], null, shapeOpts)).includes("simulation.outflow-exceeds-plan"));
  });

  it("does not count a payment to the fee recipient as a fee overcharge", () => {
    const fee = DEFAULT_FEE_RECIPIENT as Address;
    const toFeeRecipient = { ...sendFlow, recipients: [fee] };
    const rules = (flow: typeof sendFlow, txs: UnsignedTransaction[]) => analyzeFlow(flow, decodeTransactions(txs)).findings.map((f) => f.rule);
    assert.deepEqual(rules(toFeeRecipient, shape([feeCall(USDC, fee, 200_000n, "fee"), transfer(fee, 20_000_000n)], null, shapeOpts)), []);
    // The owner is the fee recipient and sends to itself.
    const selfSend = { ...sendFlow, account: fee, owner: fee, recipients: [] };
    assert.deepEqual(rules(selfSend, shape([feeCall(USDC, fee, 200_000n, "fee"), transfer(fee, 20_000_000n)], null, { ...shapeOpts, from: fee })), []);
    // Taking more than plan + fee is still refused.
    const over = rules(toFeeRecipient, shape([feeCall(USDC, fee, 2_000_000n, "fee"), transfer(fee, 20_000_000n)], null, shapeOpts));
    assert.ok(over.includes("simulation.outflow-exceeds-plan"));
  });

  it("blocks unlimited, oversized and unknown-spender approvals and a vault receiver swap", () => {
    const deposit = (receiver: Address) => ({ to: VAULT, data: encodeFunctionData({ abi: [{ type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ name: "", type: "uint256" }] }], functionName: "deposit", args: [5_000_000n, receiver] }), label: "deposit" });
    const flow = { ...sendFlow, kind: "deposit", inputs: [{ token: USDC, symbol: "USDC", amount: "5000000" }], fees: [], recipients: [], knownContracts: [VAULT] };
    const rules = (txs: UnsignedTransaction[]) => analyzeFlow(flow, decodeTransactions(txs)).findings.map((f) => f.rule);
    assert.deepEqual(rules(shape(deposit(OWNER), approveCall(USDC, VAULT, 5_000_000n, "approve"), shapeOpts)), []);
    assert.ok(rules(shape(deposit(OWNER), approveCall(USDC, VAULT, maxUint256, "approve"), shapeOpts)).includes("simulation.unlimited-approval"));
    assert.ok(rules(shape(deposit(OWNER), approveCall(USDC, VAULT, 6_000_000n, "approve"), shapeOpts)).includes("simulation.approval-exceeds-need"));
    assert.ok(rules(shape(deposit(OWNER), approveCall(USDC, "0x7777777777777777777777777777777777777777", 5_000_000n, "approve"), shapeOpts)).includes("simulation.unknown-spender"));
    assert.ok(rules(shape(deposit("0x9999999999999999999999999999999999999999"), approveCall(USDC, VAULT, 5_000_000n, "approve"), shapeOpts)).includes("simulation.changed-recipient"));
  });

  it("simulates with eth_call, blocks a revert and reports an RPC that cannot simulate", async () => {
    const tx: UnsignedTransaction = { chainId: 5042002, from: OWNER, to: USDC, data: "0x" as Hex, value: "0", label: "x" };
    assert.equal((await simulateStep({ call: async () => ({ data: "0x" }) }, "s1", [tx])).method, "eth_call");
    const reverted = await simulateStep({ call: async () => { throw Object.assign(new Error("execution reverted: nope"), { name: "ExecutionRevertedError" }); } }, "s1", [tx]);
    assert.equal(reverted.findings[0]?.rule, "simulation.reverts");
    assert.equal((await simulateStep({}, "s1", [tx])).method, "unavailable");
  });
});

describe("security layer: API", () => {
  let ctx: AppContext;
  let served: Served;
  const arc = new FakeArc();

  before(async () => {
    arc.setBalance(USDC, OWNER, 1_000_000_000n);
    ctx = createContext(testConfig({ LYKIA_ADMIN_ADDRESSES: ADMIN, LYKIA_WEB_ORIGIN: "https://lykia.example", ...SECRETS }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const headers = (address?: string) => ({ "content-type": "application/json", ...(address ? { [SESSION_HEADER]: issueToken(ctx, address).token } : {}) });
  const call = (method: string, path: string, body?: unknown, address?: string) => fetch(`${served.url}${path}`, { method, headers: headers(address), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const fence = { ...DEFAULT_FENCE, recipients: { mode: "allowlist", allow: [FRIEND] } };
  const planSend = async () => {
    const created = await call("POST", "/v1/intents", { actions: [{ verb: "send", token: "USDC", amount: { exact: "20" }, to: FRIEND }], owner: OWNER, environment: "testnet", fence });
    assert.equal(created.status, 201, await created.clone().text());
    return ((await created.json()) as { intent: { id: string } }).intent.id;
  };

  it("adds a security block to prepare and writes a verifiable audit log only the owner can read", async () => {
    const id = await planSend();
    const res = await call("POST", `/v1/intents/${id}/steps/s1/prepare`, { confirm: true });
    assert.equal(res.status, 200, await res.clone().text());
    const { security } = (await res.json()) as { security: SecurityReport };
    assert.equal(security.schema, "lykia.security/v1");
    assert.notEqual(security.decision, "block");
    assert.ok(security.findings.some((f) => f.rule === "address.first-time"));
    assert.ok(security.summary.lines.some((l) => l.includes(FRIEND)));
    assert.match(security.digest, /^sha256:[0-9a-f]{64}$/u);

    assert.equal((await call("GET", "/v1/security/audit")).status, 401);
    assert.equal((await call("GET", `/v1/security/audit?owner=${OWNER}`, undefined, FRIEND)).status, 403);
    const audit = (await (await call("GET", "/v1/security/audit", undefined, OWNER)).json()) as { entries: AuditEntry[]; verified: { ok: boolean } };
    assert.equal(audit.verified.ok, true);
    assert.equal(audit.entries.at(-1)?.kind, "prepare");
    const tampered = audit.entries.map((e, i) => (i === 0 ? { ...e, data: { ...e.data, decision: "pass!" } } : e));
    assert.equal(verifyAuditChain(tampered).ok, false);
    const ndjson = await call("GET", "/v1/security/audit?format=ndjson", undefined, OWNER);
    assert.equal(ndjson.headers.get("content-type")?.startsWith("application/x-ndjson"), true);
  });

  it("enforces velocity limits from the owner's policy", async () => {
    assert.equal((await call("PUT", "/v1/security/policy", { txPerMinute: 1 }, OWNER)).status, 200);
    const id = await planSend();
    const res = await call("POST", `/v1/intents/${id}/steps/s1/prepare`, { confirm: true, acknowledge: true });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: { code: string; details: { security: SecurityReport } } };
    assert.equal(body.error.code, "SECURITY_BLOCKED");
    assert.ok(body.error.details.security.findings.some((f) => f.rule === "monitor.velocity-tx"));
    await call("PUT", "/v1/security/policy", { txPerMinute: 60 }, OWNER);
  });

  it("lets only an admin halt routing, and a halt blocks new steps", async () => {
    assert.equal((await call("POST", "/v1/security/halt", { halt: true, reason: "drill" }, OWNER)).status, 403);
    assert.equal((await call("POST", "/v1/security/halt", { halt: true, reason: "incident drill" }, ADMIN)).status, 200);
    const status = (await (await call("GET", "/v1/security/status?environment=testnet")).json()) as { halted: boolean; layers: { id: string; status: string }[] };
    assert.equal(status.halted, true);
    assert.equal(status.layers.find((l) => l.id === "breakers")?.status, "alert");
    const id = await planSend();
    const blocked = await call("POST", `/v1/intents/${id}/steps/s1/prepare`, { confirm: true, acknowledge: true });
    assert.equal(blocked.status, 409);
    assert.equal(((await blocked.json()) as { error: { code: string } }).error.code, "SECURITY_BLOCKED");
    await call("POST", "/v1/security/halt", { halt: false, reason: "drill over" }, ADMIN);
    const platform = (await (await call("GET", "/v1/security/audit?chain=platform", undefined, ADMIN)).json()) as { entries: AuditEntry[]; verified: { ok: boolean } };
    assert.deepEqual(platform.entries.map((e) => e.kind), ["halt", "halt"]);
    assert.equal(platform.verified.ok, true);
  });

  it("lets owners pause and resume only their own subjects", async () => {
    assert.equal((await call("POST", "/v1/security/pause", { subject: FRIEND, reason: "not mine" }, OWNER)).status, 403);
    assert.equal((await call("POST", "/v1/security/pause", { subject: OWNER, reason: "travelling" }, OWNER)).status, 200);
    const id = await planSend();
    assert.equal((await call("POST", `/v1/intents/${id}/steps/s1/prepare`, { confirm: true })).status, 409);
    assert.equal((await call("POST", "/v1/security/resume", { subject: OWNER }, FRIEND)).status, 403);
    assert.equal((await call("POST", "/v1/security/resume", { subject: OWNER }, OWNER)).status, 200);
  });

  it("checks an address and flags a look-alike of a known contact", async () => {
    await ctx.store.collection("security_recipients").put(`${OWNER}:${FRIEND}`, { address: FRIEND, count: 1, lastAt: "2026-11-01T00:00:00.000Z" });
    const look = "0x1111a00000000000000000000000000000001111";
    const report = (await (await call("POST", "/v1/security/check-address", { owner: OWNER, address: look, environment: "testnet" })).json()) as { findings: { rule: string; severity: string }[] };
    assert.equal(report.findings.find((f) => f.rule === "address.lookalike")?.severity, "block");
  });

  it("hardens the platform: CSP, strict CORS, no secrets in responses", async () => {
    const res = await fetch(`${served.url}/v1/security/status`, { headers: { origin: "https://evil.example" } });
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/u);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    const ok = await fetch(`${served.url}/v1/security/status`, { headers: { origin: "https://lykia.example" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://lykia.example");
    const paths = ["/health", "/v1/security/status", "/v1/fees", "/v1/deployments", "/v1/admin/flags", "/v1/admin/overview", "/v1/security/audit?chain=platform", "/v1/system/status"];
    for (const path of paths) {
      const text = await (await call("GET", path, undefined, ADMIN)).text();
      for (const [name, value] of Object.entries(SECRETS)) assert.equal(text.includes(value), false, `${path} leaks ${name}`);
    }
  });

  it("refuses a replayed SIWE nonce", async () => {
    const { issueNonce, verifySiwe } = await import("../../platform/siwe.js");
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(`0x${"ab".repeat(32)}`);
    const nonce = await issueNonce(ctx, { address: account.address, chainId: 5042002 });
    const message = (nonce as { message: string }).message;
    const signature = await account.signMessage({ message });
    await verifySiwe(ctx, message, signature);
    await assert.rejects(verifySiwe(ctx, message, signature), /nonce/iu);
  });
});
