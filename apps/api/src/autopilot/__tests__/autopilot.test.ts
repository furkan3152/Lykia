/**
 * Lyko Autopilot over HTTP, against a fake Arc with a modelled LykiaAccount
 * and a mocked Circle Wallets API: the opt-in gates, the ceilings, signing
 * refused outside the leash, the kill switch, the Whistle, the anomaly pause,
 * a task that runs from the background check, a watch that ends in an
 * Autopilot action, and Circle signing exactly the prepared step.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { AUTOPILOT_LABEL, autopilotAckDigest, getToken, tokenAddress, verdictTag, type Address } from "@lykia/core";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { ManualClock } from "../../clock.js";
import { FakeArc, serve, testConfig, type Served } from "../../__tests__/support.js";
import { agentServices, setLlmClient } from "../../agents/index.js";
import { SESSION_ABI } from "../../agents/onchain.js";
import { createWatch } from "../../agents/instructions.js";
import { MULTICALL3_FROM_ABI } from "../../engine/abis.js";
import { getOwnKey } from "../../platform/keys.js";
import { issueToken } from "../../platform/session.js";
import { ACCOUNT_ABI, sessionIdOf } from "../../leash/chain.js";
import { leashService } from "../../leash/service.js";
import { autopilotService, onlyAccountCalls, setAutopilotFacts } from "../service.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const OWNER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d").address.toLowerCase() as Address;
const SIGNER = "0x5160000000000000000000000000000000000a11" as Address;
const WALLET_ID = "a1a1a1a1-2222-4333-8444-555555555555";
const ACCOUNT = "0xacc0000000000000000000000000000000000002" as Address;
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const STRANGER = "0x3333333333333333333333333333333333333333" as Address;
const USDC = tokenAddress(getToken("USDC")!, "mainnet")!.toLowerCase() as Address;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

/** The parts of LykiaAccount a leash reads, as a model. */
class FakeAccount {
  nonce = 0n;
  whistle = false;
  sessions = new Map<string, { key: Address; parent: Hex; validUntil: bigint; maxCalls: number; callsUsed: number; revoked: boolean; fenceHash: Hex }>();
  limits = new Map<string, { perCall: bigint; daily: bigint; budget: bigint; dayUsed: bigint; consumed: bigint }>();
  rules = new Set<string>();
  recipients = new Set<string>();
  constructor(private readonly clock: ManualClock) {}

  install(arc: FakeArc): void {
    const sid = (c: { args?: readonly unknown[] }) => String(c.args?.[0]).toLowerCase();
    arc.extraReads.set("predictAccount", () => ACCOUNT);
    arc.extraReads.set("sessionNonce", () => this.nonce);
    arc.extraReads.set("whistle", () => this.whistle);
    arc.extraReads.set("getSession", (c) => this.sessions.get(sid(c)) ?? { key: "0x0000000000000000000000000000000000000000", parent: ZERO32, validUntil: 0n, epoch: 0n, maxCalls: 0, callsUsed: 0, depth: 0, revoked: false, fenceHash: ZERO32 });
    arc.extraReads.set("isSessionValid", (c) => this.valid(sid(c)));
    arc.extraReads.set("getLimit", (c) => {
      const l = this.limits.get(`${sid(c)}:${String(c.args?.[1]).toLowerCase()}`);
      return [{ allowed: Boolean(l), perCall: l?.perCall ?? 0n, daily: l?.daily ?? 0n, budget: l?.budget ?? 0n }, { dayAmount: l?.dayUsed ?? 0n, consumed: l?.consumed ?? 0n }];
    });
    arc.extraReads.set("spendable", (c) => {
      const l = this.limits.get(`${sid(c)}:${String(c.args?.[1]).toLowerCase()}`);
      if (!l || !this.valid(sid(c)) || l.dayUsed >= l.daily) return 0n;
      return [l.perCall, l.daily - l.dayUsed, l.budget - l.consumed].reduce((a, b) => (a < b ? a : b));
    });
    arc.extraReads.set("getRule", (c) => ({ allowed: this.rules.has(`${sid(c)}:${String(c.args?.[1]).toLowerCase()}:${String(c.args?.[2]).toLowerCase()}`), homeward: false, receiverWords: 0 }));
    arc.extraReads.set("isRecipient", (c) => this.recipients.has(`${sid(c)}:${String(c.args?.[1]).toLowerCase()}`));
  }

  valid(id: string): boolean {
    const s = this.sessions.get(id);
    return Boolean(s && !s.revoked && Number(s.validUntil) * 1000 >= this.clock.now());
  }

  /** What the owner's createSession does once signed. */
  land(data: Hex): Hex {
    const { args } = decodeFunctionData({ abi: SESSION_ABI, data });
    const spec = args[0] as { key: Address; validUntil: bigint; maxCalls: number; fenceHash: Hex; tokens: readonly { token: Address; perCall: bigint; daily: bigint; budget: bigint }[]; calls: readonly { target: Address; selector: Hex }[]; recipients: readonly Address[] };
    this.nonce += 1n;
    const id = sessionIdOf(ACCOUNT, spec.key, this.nonce).toLowerCase() as Hex;
    this.sessions.set(id, { key: spec.key, parent: ZERO32, validUntil: spec.validUntil, maxCalls: spec.maxCalls, callsUsed: 0, revoked: false, fenceHash: spec.fenceHash });
    for (const t of spec.tokens) this.limits.set(`${id}:${t.token.toLowerCase()}`, { perCall: t.perCall, daily: t.daily, budget: t.budget, dayUsed: 0n, consumed: 0n });
    for (const c of spec.calls) this.rules.add(`${id}:${c.target.toLowerCase()}:${c.selector.toLowerCase()}`);
    for (const r of spec.recipients) this.recipients.add(`${id}:${r.toLowerCase()}`);
    return id;
  }
}

/** The account calls inside a prepared Autopilot transaction (direct, or batched through Multicall3From). */
function accountCalls(to: string, data: Hex): { functionName: string; args: readonly unknown[] }[] {
  if (to.toLowerCase() === ACCOUNT) return [decodeFunctionData({ abi: ACCOUNT_ABI, data }) as never];
  const { args } = decodeFunctionData({ abi: MULTICALL3_FROM_ABI, data });
  return (args[0] as readonly { callData: Hex }[]).map((c) => decodeFunctionData({ abi: ACCOUNT_ABI, data: c.callData }) as never);
}

describe("Lyko Autopilot", () => {
  let ctx: AppContext;
  let served: Served;
  let arc: FakeArc;
  let account: FakeAccount;
  const clock = new ManualClock(Date.UTC(2026, 10, 8, 10, 0, 0));
  const hooks: { type: string; data: Record<string, unknown> }[] = [];
  const executions: { contractAddress: string; callData: Hex; walletId: string }[] = [];
  const walletBodies: Record<string, unknown>[] = [];
  const circleTxs = new Map<string, { state: string; txHash: string | null }>();
  let sessionId: Hex = ZERO32;

  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(`${served.url}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  const json = async (res: Response): Promise<Body> => res.json();
  const owner = () => ({ "lykia-session": issueToken(ctx, OWNER).token });
  const ap = () => autopilotService(ctx);
  const enableBody = (over: Record<string, unknown> = {}) => ({ ack: autopilotAckDigest(), limits: { perStepUsd: "25", perDayUsd: "60", days: 7 }, payees: [PAYEE], ...over });

  before(async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    let n = 0;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/config/entity/publicKey")) return reply({ publicKey: pem });
      if (url.endsWith("/developer/walletSets")) return reply({ walletSet: { id: "99999999-2222-4333-8444-555555555555" } });
      if (url.endsWith("/developer/wallets")) {
        walletBodies.push(body!);
        return reply({ wallets: [{ id: WALLET_ID, address: SIGNER, blockchain: "ARC", accountType: body?.accountType }] });
      }
      if (url.endsWith("/developer/transactions/contractExecution")) {
        executions.push({ contractAddress: String(body!.contractAddress), callData: body!.callData as Hex, walletId: String(body!.walletId) });
        n += 1;
        const id = `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
        circleTxs.set(id, { state: "INITIATED", txHash: null });
        return reply({ id, state: "INITIATED" });
      }
      const tx = /\/transactions\/([0-9a-f-]{36})$/u.exec(url);
      if (tx && circleTxs.has(tx[1]!)) return reply({ transaction: circleTxs.get(tx[1]!) });
      return new Response("{}", { status: 404 });
    };
    arc = new FakeArc();
    arc.now = () => Math.floor(clock.now() / 1000);
    account = new FakeAccount(clock);
    account.install(arc);
    arc.code.set(ACCOUNT, "0x60016000");
    arc.setBalance(USDC, ACCOUNT, 500_000_000n);
    arc.onCall = async () => ({ data: "0x" });
    ctx = createContext(testConfig({ LYKIA_SESSION_SECRET: "a".repeat(40), LYKIA_MODE: "mainnet", LYKIA_RATE_LIMIT_HEAVY: "1000", LYKIA_CIRCLE_SERVER_WALLETS: "true", CIRCLE_API_KEY: "TEST_API_KEY:abc:def", CIRCLE_ENTITY_SECRET: "b".repeat(64) }), { chains: arc.asChains(), pulse: idlePulse, clock, fetch: fetchImpl as never });
    setLlmClient(ctx, null);
    agentServices(ctx).webhooks.emit = (async (type: string, _owner: string, data: Record<string, unknown>) => {
      hooks.push({ type, data });
      return 0;
    }) as never;
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  /** Circle sends the step: the transaction and its receipt (with the memo the account emits) appear on Arc. */
  function land(execution: { contractAddress: string; callData: Hex }, circleId: string, label: string, opts: { memo?: boolean } = {}): Hex {
    const hash = keccak256(toHex(label));
    arc.transactions.set(hash, { from: SIGNER, to: execution.contractAddress, input: execution.callData, value: 0n, chainId: 5042 });
    const logs = accountCalls(execution.contractAddress, execution.callData).flatMap((c) => {
      const [sid, token, to, amount, memo] = c.args as [Hex, Address, Address, bigint, Hex];
      const transfer = { address: ACCOUNT, topics: encodeEventTopics({ abi: ACCOUNT_ABI, eventName: "AgentTransfer", args: { sessionId: sid, token, to } } as never), data: encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [amount, keccak256(memo)]), transactionHash: hash, blockNumber: 990n, logIndex: 0, blockHash: ZERO32, transactionIndex: 0, removed: false };
      const memoLog = { address: ACCOUNT, topics: encodeEventTopics({ abi: ACCOUNT_ABI, eventName: "AgentMemo", args: { sessionId: sid, memoHash: keccak256(memo) } } as never), data: encodeAbiParameters([{ type: "bytes" }], [memo]), transactionHash: hash, blockNumber: 990n, logIndex: 1, blockHash: ZERO32, transactionIndex: 0, removed: false };
      return memo.length > 2 && opts.memo !== false ? [transfer, memoLog] : [transfer];
    });
    arc.receipts.set(hash, { status: "success", blockNumber: 990n, logs });
    circleTxs.set(circleId, { state: "COMPLETE", txHash: hash });
    return hash;
  }

  it("is off unless the operator opted in", async () => {
    const off = createContext(testConfig({ LYKIA_SESSION_SECRET: "c".repeat(40), LYKIA_MODE: "mainnet" }), { chains: arc.asChains(), pulse: idlePulse, clock });
    try {
      const offer = autopilotService(off).offer("mainnet");
      assert.equal(offer.available, false);
      assert.match(offer.reason ?? "", /LYKIA_CIRCLE_SERVER_WALLETS/u);
      await assert.rejects(autopilotService(off).enable({ owner: OWNER, environment: "mainnet", ack: autopilotAckDigest(), limits: { perStepUsd: "25", perDayUsd: "60", days: 7 }, publicBaseUrl: "http://x" }), (e: { status?: number; code?: string }) => e.status === 403 && e.code === "CIRCLE_SERVER_WALLETS_OFF");
    } finally {
      await closeContext(off);
    }
    // Here it is available, and nothing is on yet.
    const view = await json(await call("/v1/autopilot", { headers: owner() }));
    assert.equal(view.offer.available, true);
    assert.equal(view.offer.ack.digest, autopilotAckDigest());
    assert.deepEqual(view.offer.ceilings, { perStepUsd: "100", perDayUsd: "300" });
    assert.equal(view.autopilot, null);
    assert.equal((await call("/v1/autopilot")).status, 401, "signed in only");
  });

  it("needs the acknowledgement and limits under the ceilings", async () => {
    const noAck = await call("/v1/autopilot/enable", { headers: owner(), body: enableBody({ ack: "sha256:00" }) });
    assert.equal(noAck.status, 400);
    assert.equal((await json(noAck)).error.code, "AUTOPILOT_ACK_REQUIRED");
    const over = await json(await call("/v1/autopilot/enable", { headers: owner(), body: enableBody({ limits: { perStepUsd: "150", perDayUsd: "400", days: 7 } }) }));
    assert.equal(over.error.code, "INVALID_AUTOPILOT");
    const paths = over.error.details.issues.map((i: { path: string }) => i.path);
    assert.ok(paths.includes("limits.perStepUsd") && paths.includes("limits.perDayUsd"), JSON.stringify(paths));
    const self = await json(await call("/v1/autopilot/enable", { headers: owner(), body: enableBody({ payees: [OWNER] }) }));
    assert.equal(self.error.code, "INVALID_AUTOPILOT");
    assert.equal(executions.length, 0);
    assert.equal(walletBodies.length, 0, "no Circle wallet before the checks pass");
  });

  it("turns on as a leash the owner signs once, with the owner's own Circle EOA as the session key", async () => {
    const res = await call("/v1/autopilot/enable", { headers: owner(), body: enableBody() });
    const body = await json(res);
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.autopilot.status, "pending");
    assert.equal(body.autopilot.signer.address, SIGNER);
    assert.equal(walletBodies[0]!.accountType, "EOA");
    const sessionTx = body.transactions[body.transactions.length - 1];
    assert.equal(sessionTx.from, OWNER, "the owner's wallet signs the session");
    const { functionName, args } = decodeFunctionData({ abi: SESSION_ABI, data: sessionTx.data });
    assert.equal(functionName, "createSession");
    const spec = args[0] as { key: Address; tokens: readonly { token: Address; perCall: bigint; daily: bigint }[]; recipients: readonly Address[] };
    assert.equal(spec.key.toLowerCase(), SIGNER);
    const usdc = spec.tokens.find((t) => t.token.toLowerCase() === USDC)!;
    assert.equal(usdc.perCall, 25_000_000n, "per call on chain = the Autopilot step cap");
    assert.equal(usdc.daily, 60_000_000n);
    assert.ok(spec.recipients.map((r) => r.toLowerCase()).includes(PAYEE));
    // The leash's API key is switched off: only the Autopilot service plans under it.
    const leash = await leashService(ctx).get(body.autopilot.leashId);
    assert.ok((await getOwnKey(ctx, OWNER, leash.key.id)).revokedAt, "the leash key is revoked");
    // A second enable while it is pending is refused.
    assert.equal((await call("/v1/autopilot/enable", { headers: owner(), body: enableBody() })).status, 409);

    // Nothing is signed before the session lands.
    const task = await json(await call("/v1/autopilot/tasks", { headers: owner(), body: { task: { kind: "pay", amountUsd: "20", every: "week", payee: PAYEE } } }));
    const taskId = task.autopilot.tasks[0].id;
    const early = await json(await call(`/v1/autopilot/tasks/${taskId}/run`, { headers: owner(), body: {} }));
    assert.equal(early.run.status, "refused");
    assert.equal(early.run.reasons[0].code, "autopilot.off");
    assert.equal(executions.length, 0);

    sessionId = account.land(sessionTx.data);
    const view = await json(await call("/v1/autopilot", { headers: owner() }));
    assert.equal(view.autopilot.status, "on");
    assert.equal(view.leash.status, "active");
  });

  it("signs a task through Circle with exactly the prepared step, then settles it chain-proven", async () => {
    const view = await json(await call("/v1/autopilot", { headers: owner() }));
    const taskId = view.autopilot.tasks[0].id;
    const r = await json(await call(`/v1/autopilot/tasks/${taskId}/run`, { headers: owner(), body: {} }));
    assert.equal(r.run.status, "signing", JSON.stringify(r.run));
    assert.equal(r.run.label, AUTOPILOT_LABEL);
    assert.ok(r.run.verdictDigest && r.run.intentId && r.run.stepId);
    assert.equal(executions.length, 1);
    const e = executions[0]!;
    assert.equal(e.walletId, WALLET_ID);
    assert.ok(onlyAccountCalls({ to: e.contractAddress, data: e.callData }, ACCOUNT, "mainnet"), "Circle is only ever asked to call the owner's account");
    const calls = accountCalls(e.contractAddress, e.callData);
    assert.ok(calls.every((c) => c.functionName === "agentTransfer" && String(c.args[0]).toLowerCase() === sessionId));
    const pay = calls.find((c) => String(c.args[2]).toLowerCase() === PAYEE)!;
    assert.equal(pay.args[3], 20_000_000n);
    // The Arc Memo carries the verdict digest.
    const memo = new TextDecoder().decode(Buffer.from(String(pay.args[4]).slice(2), "hex"));
    assert.equal(memo, `lykia:1:${r.run.intentId}:${r.run.stepId}:${verdictTag(r.run.verdictDigest)}`);
    const signed = hooks.find((h) => h.type === "autopilot.signed")!;
    assert.equal(signed.data.verdictDigest, r.run.verdictDigest);
    assert.equal(signed.data.label, AUTOPILOT_LABEL);

    // Circle broadcasts; the background check settles it through the leash.
    const hash = land(e, [...circleTxs.keys()][0]!, "autopilot-1");
    const tick = await ap().tick();
    assert.equal(tick.settled, 1);
    const after = await json(await call("/v1/autopilot", { headers: owner() }));
    const run = after.runs.find((x: { id: string }) => x.id === r.run.id);
    assert.equal(run.status, "settled");
    assert.equal(run.txHash, hash);
    assert.equal(run.chainProven, true);
    assert.equal(after.today.spentUsd, "20.20", "the 1% fee counts");
    const trail = await leashService(ctx).trail(await leashService(ctx).get(after.autopilot.leashId));
    assert.ok(trail.items.some((i) => i.kind === "settled" && i.chainProven && i.txHash === hash), "chain-proven in the leash trail");
    assert.equal(tick.ran, 0, "the weekly task already ran this week");
  });

  it("refuses outside the leash without asking Circle, and pauses itself on repeated refusals", async () => {
    const before = executions.length;
    const a = (await ap().get(OWNER, "mainnet"))!;
    const tooBig = await ap().run(a, { taskId: null, sentence: `send 30 USDC to ${PAYEE}`, origin: "owner" });
    assert.equal(tooBig.status, "refused");
    assert.ok(tooBig.reasons!.some((x) => x.code === "fence.caps.step"), JSON.stringify(tooBig.reasons));
    const stranger = await ap().run(a, { taskId: null, sentence: `send 5 USDC to ${STRANGER}`, origin: "owner" });
    assert.ok(stranger.reasons!.some((x) => x.code === "fence.recipients"), JSON.stringify(stranger.reasons));
    assert.equal((await ap().get(OWNER, "mainnet"))!.status, "on", "two refusals are not yet an anomaly");
    const swap = await ap().run(a, { taskId: null, sentence: "swap 10 USDC to cirBTC", origin: "owner" });
    assert.equal(swap.status, "refused");
    assert.equal(executions.length, before, "Circle was never asked");
    const paused = (await ap().get(OWNER, "mainnet"))!;
    assert.equal(paused.status, "paused");
    assert.equal(paused.paused?.code, "anomaly.denies");
    assert.ok(hooks.some((h) => h.type === "autopilot.paused" && h.data.code === "anomaly.denies"));
    // Paused: nothing is signed, not even a valid step.
    const meanwhile = await ap().run(paused, { taskId: null, sentence: `send 1 USDC to ${PAYEE}`, origin: "owner" });
    assert.equal(meanwhile.reasons![0]!.code, "autopilot.off");
    assert.equal(executions.length, before);
    // The task cannot ask for more than a step either.
    const big = await call("/v1/autopilot/tasks", { headers: owner(), body: { task: { kind: "pay", amountUsd: "40", every: "week", payee: PAYEE } } });
    assert.equal(big.status, 400);
    const unknownPayee = await call("/v1/autopilot/tasks", { headers: owner(), body: { task: { kind: "pay", amountUsd: "5", every: "week", payee: STRANGER } } });
    assert.equal(unknownPayee.status, 400);
  });

  it("pauses on unusual spend velocity and holds its own daily cap", async () => {
    assert.equal((await json(await call("/v1/autopilot/resume", { headers: owner(), body: {} }))).autopilot.status, "on");
    clock.advance(61 * 60_000);
    const a = () => ap().get(OWNER, "mainnet").then((x) => x!);
    const first = await ap().run(await a(), { taskId: null, sentence: `send 20 USDC to ${PAYEE}`, origin: "owner" });
    assert.equal(first.status, "signing", JSON.stringify(first.reasons));
    const count = executions.length;
    // $20.20 signed a moment ago; $15.15 more inside 15 minutes is more than half the $60 day.
    const burst = await ap().run(await a(), { taskId: null, sentence: `send 15 USDC to ${PAYEE}`, origin: "owner" });
    assert.equal(burst.status, "refused");
    assert.equal(burst.reasons![0]!.code, "anomaly.velocity");
    assert.equal(executions.length, count, "the burst was never signed");
    assert.equal((await a()).status, "paused");
    await call("/v1/autopilot/resume", { headers: owner(), body: {} });
    clock.advance(16 * 60_000);
    // $40.40 signed today; $20.20 more would pass Autopilot's own $60 (the leash has settled only $20.20 of it).
    const day = await ap().run(await a(), { taskId: null, sentence: `send 20 USDC to ${PAYEE}`, origin: "owner" });
    assert.equal(day.status, "refused");
    assert.equal(day.reasons![0]!.code, "autopilot.budget.day", JSON.stringify(day.reasons));
    assert.equal(executions.length, count);
  });

  it("Stop Autopilot ends server signing at once and returns revokeSession", async () => {
    const res = await json(await call("/v1/autopilot/stop", { headers: owner(), body: {} }));
    assert.equal(res.signingStopped, true);
    assert.equal(res.autopilot.status, "stopped");
    const { functionName, args } = decodeFunctionData({ abi: ACCOUNT_ABI, data: res.transaction.data });
    assert.equal(functionName, "revokeSession");
    assert.equal(String(args[0]).toLowerCase(), sessionId);
    assert.equal(res.transaction.from, OWNER);
    assert.equal((await leashService(ctx).get(res.autopilot.leashId)).status, "revoked");
    assert.ok(hooks.some((h) => h.type === "autopilot.stopped" && h.data.by === "owner"));
    const before = executions.length;
    const after = await ap().run(res.autopilot, { taskId: null, sentence: `send 1 USDC to ${PAYEE}`, origin: "owner" });
    assert.equal(after.reasons![0]!.code, "autopilot.off");
    assert.equal((await ap().tick()).ran, 0);
    assert.equal(executions.length, before);
    // A step Circle already had settles; nothing new is asked for.
    assert.equal((await call("/v1/autopilot/resume", { headers: owner(), body: {} })).status, 409, "a stopped Autopilot is turned on again, not resumed");
  });

  async function enableAndLand(): Promise<void> {
    const body = await json(await call("/v1/autopilot/enable", { headers: owner(), body: enableBody() }));
    assert.equal(body.autopilot.status, "pending", JSON.stringify(body));
    sessionId = account.land(body.transactions[body.transactions.length - 1].data);
    assert.equal((await json(await call("/v1/autopilot", { headers: owner() }))).autopilot.status, "on");
  }

  it("the Whistle stops it: from the Fold and on chain", async () => {
    await enableAndLand();
    assert.equal(walletBodies.length, 1, "the same Circle wallet is reused");
    // The Whistle pauses Autopilot on the server at once (nothing is signed), and lists it so it can be resumed.
    const blown = await json(await call("/v1/pack/whistle", { headers: owner(), body: { owner: OWNER, environment: "mainnet" } }));
    assert.equal(blown.autopilot.stopped, true);
    assert.ok(blown.whistle.items.some((i: { kind: string; state: string }) => i.kind === "autopilot" && i.state === "paused"));
    const held = (await ap().get(OWNER, "mainnet"))!;
    assert.equal(held.status, "paused");
    assert.match(held.paused?.reason ?? "", /Whistle/u);
    const before0 = executions.length;
    const refused = await ap().run(held, { taskId: null, sentence: `send 1 USDC to ${PAYEE}`, origin: "owner" });
    assert.notEqual(refused.status, "executed");
    assert.equal(executions.length, before0, "nothing is signed while the Whistle holds it");
    const resumed = await json(await call("/v1/whistle/resume", { headers: owner(), body: { owner: OWNER, environment: "mainnet", kind: "autopilot", id: "autopilot:mainnet" } }));
    assert.ok(resumed.items.some((i: { kind: string; state: string }) => i.kind === "autopilot" && i.state === "resumed"));
    assert.equal((await ap().get(OWNER, "mainnet"))!.status, "on");

    account.whistle = true;
    const before = executions.length;
    const r = await ap().run((await ap().get(OWNER, "mainnet"))!, { taskId: null, sentence: `send 1 USDC to ${PAYEE}`, origin: "owner" });
    assert.equal(r.status, "refused");
    assert.equal((await ap().get(OWNER, "mainnet"))!.status, "stopped");
    assert.equal(executions.length, before);
    account.whistle = false;
  });

  it("runs a watch that ends in an Autopilot action from the background check, once per time it becomes true", async () => {
    clock.advance(2 * 3_600_000);
    await enableAndLand();
    const watch = await createWatch(ctx, { owner: OWNER, environment: "mainnet", condition: { kind: "idle-above", token: "USDC", amount: "100" } });
    const added = await json(await call("/v1/autopilot/tasks", { headers: owner(), body: { task: { kind: "watch", watchId: watch.id, condition: { kind: "idle-above", token: "USDC", amount: "100" }, sentence: `send 5 USDC to ${PAYEE}`, amountUsd: "5" } } }));
    assert.ok(added.autopilot, JSON.stringify(added));
    // The schedule task from before is still there (weekly): park it so only the watch counts.
    for (const t of added.autopilot.tasks.filter((x: { kind: string }) => x.kind !== "watch")) await call(`/v1/autopilot/tasks/${t.id}/pause`, { headers: owner(), body: {} });
    let idle = 500;
    setAutopilotFacts(ctx, async () => ({ health: [], ranges: [], rates: [], wallet: { USDC: idle } }));
    const before = executions.length;
    const first = await ap().tick();
    assert.equal(first.ran, 1);
    assert.equal(executions.length, before + 1);
    const runs = (await ap().runs(OWNER, "mainnet")).filter((x) => x.origin === "watch");
    assert.equal(runs[0]!.status, "signing");
    assert.equal(runs[0]!.label, AUTOPILOT_LABEL);
    // Still true: it does not run again until the condition was clear.
    assert.equal((await ap().tick()).ran, 0);
    idle = 50;
    await ap().tick();
    idle = 600;
    assert.equal((await ap().tick()).ran, 1);
    setAutopilotFacts(ctx, null);
    await call("/v1/autopilot/stop", { headers: owner(), body: {} });
  });

  it("Stop wins a race: pressed while a step is being planned, Circle is never asked", async () => {
    clock.advance(2 * 3_600_000);
    await enableAndLand();
    const leashes = leashService(ctx);
    const plan = leashes.plan.bind(leashes);
    leashes.plan = (async (...args: Parameters<typeof plan>) => {
      const out = await plan(...args);
      await call("/v1/autopilot/stop", { headers: owner(), body: {} });
      return out;
    }) as typeof plan;
    try {
      const before = executions.length;
      const r = await ap().run((await ap().get(OWNER, "mainnet"))!, { taskId: null, sentence: `send 2 USDC to ${PAYEE}`, origin: "owner" });
      assert.equal(r.status, "refused");
      assert.equal(r.reasons![0]!.code, "autopilot.off");
      assert.equal(executions.length, before);
    } finally {
      leashes.plan = plan;
    }
  });

  it("an API key cannot reach Autopilot", async () => {
    const res = await call("/v1/autopilot/stop", { headers: { "lykia-key": "lyk_test_nothing" }, body: {} });
    assert.ok(res.status === 401 || res.status === 403, String(res.status));
  });
});
