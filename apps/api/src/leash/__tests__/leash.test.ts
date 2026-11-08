/**
 * Leashes end to end over HTTP, against a fake Arc with a modelled
 * LykiaAccount: creation (strict-subset Fence, the session transaction, the
 * key shown once), carving and its return on revoke and expiry, what a leash
 * key may and may not do, revocation at once, denials with reasons, the
 * budget webhooks, the chain-proven trail and MCP tool filtering.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getToken, isSubFence, leashCeiling, tokenAddress, type Address } from "@lykia/core";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { ManualClock } from "../../clock.js";
import { FakeArc, serve, testConfig, type Served } from "../../__tests__/support.js";
import { agentServices, setLlmClient } from "../../agents/index.js";
import { SESSION_ABI } from "../../agents/onchain.js";
import { issueToken } from "../../platform/session.js";
import { ACCOUNT_ABI, sessionIdOf, wrapForSession } from "../chain.js";
import { leashService } from "../service.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const OWNER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d").address.toLowerCase() as Address;
const OTHER = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a").address.toLowerCase() as Address;
const AGENT_KEY = "0x7777777777777777777777777777777777777777" as Address;
const ACCOUNT = "0xacc0000000000000000000000000000000000001" as Address;
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const STRANGER = "0x3333333333333333333333333333333333333333" as Address;
const USDC = tokenAddress(getToken("USDC")!, "mainnet")!.toLowerCase() as Address;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
/** Response bodies, read loosely: the assertions check their shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

/** The parts of LykiaAccount a leash reads, as a model. */
class FakeAccount {
  nonce = 0n;
  sessions = new Map<string, { key: Address; parent: Hex; validUntil: bigint; maxCalls: number; callsUsed: number; revoked: boolean; fenceHash: Hex }>();
  limits = new Map<string, { perCall: bigint; daily: bigint; budget: bigint; dayUsed: bigint; consumed: bigint }>();
  rules = new Set<string>();
  recipients = new Set<string>();
  constructor(private readonly clock: ManualClock) {}

  install(arc: FakeArc): void {
    const sid = (c: { args?: readonly unknown[] }) => String(c.args?.[0]).toLowerCase();
    arc.extraReads.set("predictAccount", () => ACCOUNT);
    arc.extraReads.set("sessionNonce", () => this.nonce);
    arc.extraReads.set("getSession", (c) => this.sessions.get(sid(c)) ?? { key: "0x0000000000000000000000000000000000000000", parent: ZERO32, validUntil: 0n, epoch: 0n, maxCalls: 0, callsUsed: 0, depth: 0, revoked: false, fenceHash: ZERO32 });
    arc.extraReads.set("isSessionValid", (c) => this.valid(sid(c)));
    arc.extraReads.set("getLimit", (c) => {
      const l = this.limits.get(`${sid(c)}:${String(c.args?.[1]).toLowerCase()}`);
      return [{ allowed: Boolean(l), perCall: l?.perCall ?? 0n, daily: l?.daily ?? 0n, budget: l?.budget ?? 0n }, { dayAmount: l?.dayUsed ?? 0n, consumed: l?.consumed ?? 0n }];
    });
    arc.extraReads.set("spendable", (c) => {
      const l = this.limits.get(`${sid(c)}:${String(c.args?.[1]).toLowerCase()}`);
      if (!l || !this.valid(sid(c)) || l.dayUsed >= l.daily) return 0n;
      const room = [l.perCall, l.daily - l.dayUsed, l.budget - l.consumed];
      return room.reduce((a, b) => (a < b ? a : b));
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
    const spec = (args.length === 2 ? args[1] : args[0]) as { key: Address; validUntil: bigint; maxCalls: number; fenceHash: Hex; tokens: readonly { token: Address; perCall: bigint; daily: bigint; budget: bigint }[]; calls: readonly { target: Address; selector: Hex }[]; recipients: readonly Address[] };
    this.nonce += 1n;
    const id = sessionIdOf(ACCOUNT, spec.key, this.nonce).toLowerCase() as Hex;
    this.sessions.set(id, { key: spec.key, parent: args.length === 2 ? (args[0] as Hex) : ZERO32, validUntil: spec.validUntil, maxCalls: spec.maxCalls, callsUsed: 0, revoked: false, fenceHash: spec.fenceHash });
    for (const t of spec.tokens) this.limits.set(`${id}:${t.token.toLowerCase()}`, { perCall: t.perCall, daily: t.daily, budget: t.budget, dayUsed: 0n, consumed: 0n });
    for (const c of spec.calls) this.rules.add(`${id}:${c.target.toLowerCase()}:${c.selector.toLowerCase()}`);
    for (const r of spec.recipients) this.recipients.add(`${id}:${r.toLowerCase()}`);
    return id;
  }
}

function log(name: "AgentTransfer" | "AgentMemo" | "AgentCall", args: Record<string, unknown>, data: Hex, hash: Hex) {
  const topics = encodeEventTopics({ abi: ACCOUNT_ABI, eventName: name, args } as never);
  return { address: ACCOUNT, topics, data, transactionHash: hash, blockNumber: 990n, logIndex: 0, blockHash: ZERO32, transactionIndex: 0, removed: false };
}

describe("leashes", () => {
  let ctx: AppContext;
  let served: Served;
  let arc: FakeArc;
  let account: FakeAccount;
  const clock = new ManualClock(Date.UTC(2026, 10, 8, 10, 0, 0));
  let otherSession = "";
  const hooks: { type: string; data: Record<string, unknown> }[] = [];

  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(`${served.url}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;
  /** A fresh session each time: the tests move the clock by days. */
  const owner = () => ({ "lykia-session": issueToken(ctx, OWNER).token });
  const days = (n: number) => new Date(clock.now() + n * 86_400_000).toISOString();
  const payInvoices = (over: Record<string, unknown> = {}) => ({ agent: { name: "Invoice bot", signer: AGENT_KEY }, template: "pay-invoices", budget: { perStepUsd: "20", perDayUsd: "20", totalUsd: "140" }, expiresAt: days(7), recipients: [PAYEE], ...over });

  before(async () => {
    arc = new FakeArc();
    arc.now = () => Math.floor(clock.now() / 1000);
    account = new FakeAccount(clock);
    account.install(arc);
    arc.code.set(ACCOUNT, "0x60016000");
    arc.setBalance(USDC, ACCOUNT, 500_000_000n);
    ctx = createContext(testConfig({ LYKIA_SESSION_SECRET: "l".repeat(40), LYKIA_MODE: "mainnet", LYKIA_RATE_LIMIT_HEAVY: "1000" }), { chains: arc.asChains(), pulse: idlePulse, clock, fetch: (async () => new Response("{}", { status: 404 })) as never });
    setLlmClient(ctx, null);
    const webhooks = agentServices(ctx).webhooks;
    webhooks.emit = (async (type: string, _owner: string, data: Record<string, unknown>) => {
      hooks.push({ type, data });
      return 0;
    }) as never;
    served = await serve(createApp(ctx));
    otherSession = issueToken(ctx, OTHER).token;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });
  beforeEach(() => {
    hooks.length = 0;
  });

  async function create(body: Record<string, unknown>, headers?: Record<string, string>) {
    const res = await call("/v1/leashes", { headers: headers ?? owner(), body });
    return { res, body: await json<Body>(res) };
  }

  it("creates a strict-subset Fence, the createSession transaction and a key shown once", async () => {
    const { res, body } = await create(payInvoices());
    assert.equal(res.status, 201, JSON.stringify(body));
    const leash = body.leash;
    assert.equal(leash.status, "pending");
    assert.equal(leash.template, "pay-invoices");
    // Inside the template's ceiling (the mainnet beta cap included), and narrower than it.
    const ceiling = leashCeiling({ template: "pay-invoices", environment: "mainnet", recipients: [PAYEE], beta: ctx.config.beta });
    assert.ok(isSubFence(ceiling, leash.fence));
    assert.ok(!isSubFence(leash.fence, ceiling), "strictly inside, not equal");
    assert.deepEqual(leash.fence.kinds.allow, ["transfer"]);
    assert.equal(leash.fence.caps.perStepUsd, "20");
    assert.deepEqual(leash.fence.signers, ["agent"]);
    // One transaction (the account exists): createSession from the owner with the leash's caps in token units.
    assert.equal(body.transactions.length, 1);
    const tx = body.transactions[0];
    assert.equal(tx.from, OWNER);
    assert.equal(tx.to, ACCOUNT);
    const { functionName, args } = decodeFunctionData({ abi: SESSION_ABI, data: tx.data });
    assert.equal(functionName, "createSession");
    const spec = args[0] as { key: Address; validUntil: bigint; fenceHash: Hex; tokens: readonly { token: Address; perCall: bigint; daily: bigint; budget: bigint }[]; calls: readonly unknown[]; recipients: readonly Address[] };
    assert.equal(spec.key.toLowerCase(), AGENT_KEY);
    assert.equal(spec.fenceHash, `0x${leash.fenceHash.slice(7)}`);
    assert.equal(Number(spec.validUntil), Math.floor(Date.parse(leash.expiresAt) / 1000));
    const usdc = spec.tokens.find((t) => t.token.toLowerCase() === USDC)!;
    assert.deepEqual([usdc.perCall, usdc.daily, usdc.budget], [20_000_000n, 20_000_000n, 140_000_000n]);
    assert.equal(spec.calls.length, 0, "a payments leash allowlists no contract calls");
    assert.ok(spec.recipients.map((r) => r.toLowerCase()).includes(PAYEE));
    // The key: shown once, for this leash only, with an MCP snippet.
    assert.match(body.apiKey.secret, /^lk_leash_live_[a-z0-9]{12}_/u);
    const server = Object.values(body.mcp.mcpServers)[0] as { url: string; headers: Record<string, string> };
    assert.equal(server.headers["Lykia-Key"], body.apiKey.secret);
    assert.match(server.url, /\/v1\/mcp$/u);
    const again = await json<Body>(await call(`/v1/leashes/${leash.id}`, { headers: owner() }));
    assert.ok(!JSON.stringify(again).includes(body.apiKey.secret), "the secret is never shown again");
    assert.ok(body.enforcement.some((e: { limit: string; enforcedBy: string }) => e.limit === "Slippage" && e.enforcedBy === "api"));
    await leashService(ctx).revoke(await leashService(ctx).get(leash.id));
  });

  it("carves the daily budget from the owner's Fence and returns it on revoke and on expiry", async () => {
    const big = (name: string) => payInvoices({ agent: { name, signer: AGENT_KEY }, budget: { perStepUsd: "500", perDayUsd: "2000", totalUsd: "4000" } });
    const a = await create(big("A"));
    const b = await create(big("B"));
    assert.equal(a.res.status, 201);
    assert.equal(b.res.status, 201);
    const c = await create(big("C"));
    assert.equal(c.res.status, 422);
    assert.equal(c.body.error.code, "BUDGET_EXCEEDED");
    assert.equal(c.body.error.details.free.dailyUsd, "1000.00");
    // Revoke A: its carve is free again.
    assert.equal((await call(`/v1/leashes/${a.body.leash.id}/revoke`, { headers: owner(), body: {} })).status, 200);
    const c2 = await create(big("C"));
    assert.equal(c2.res.status, 201, JSON.stringify(c2.body));
    // B and C expire: both carves return.
    const later = { ...big("D"), expiresAt: days(30) };
    clock.advance(8 * 86_400_000);
    const d = await create(later);
    assert.equal(d.res.status, 201, JSON.stringify(d.body));
    assert.equal((await leashService(ctx).get(b.body.leash.id)).status, "expired");
    assert.equal((await agentServices(ctx).pack.get(b.body.leash.agentId)).status, "revoked");
    clock.advance(-8 * 86_400_000);
    await leashService(ctx).revoke(await leashService(ctx).get(d.body.leash.id));
  });

  it("carves a sub-agent's leash from a Pack agent's Fence and budget", async () => {
    const pack = agentServices(ctx).pack;
    const parent = await pack.create({ owner: OWNER, environment: "mainnet", name: "Ops", role: "custom", fence: { schema: "lykia.fence/v1", kinds: { allow: ["transfer", "swap"] }, tokens: { allow: ["USDC"], unlisted: "deny" }, recipients: { mode: "allowlist", allow: [PAYEE] }, caps: { perStepUsd: "100", perIntentUsd: "300", dailyUsd: "300" }, scent: { require: "verified" } } });
    const sub = (perDay: string) => ({ parentAgentId: parent.id, name: `Pup ${perDay}`, signer: AGENT_KEY, template: "pay-invoices", budget: { perStepUsd: "50", perDayUsd: perDay, totalUsd: "1000" }, expiresAt: days(3), recipients: [PAYEE] });
    const one = await create(sub("200"));
    assert.equal(one.res.status, 201, JSON.stringify(one.body));
    assert.ok(isSubFence(parent.fence, one.body.leash.fence));
    assert.deepEqual(one.body.leash.fence.tokens.allow, ["USDC"], "the parent's narrower token list wins");
    const two = await create(sub("150"));
    assert.equal(two.res.status, 422);
    assert.equal(two.body.error.code, "BUDGET_EXCEEDED");
    // Asking above the parent's cap is an error, never a silent clamp.
    const greedy = await create({ ...sub("50"), budget: { perStepUsd: "150", perDayUsd: "150", totalUsd: "300" } });
    assert.equal(greedy.res.status, 422);
    assert.equal(greedy.body.error.code, "SUB_FENCE_VIOLATION");
    await leashService(ctx).revoke(await leashService(ctx).get(one.body.leash.id));
  });

  it("refuses limits above the mainnet beta cap and nonsense budgets", async () => {
    const over = await create(payInvoices({ budget: { perStepUsd: "1500", perDayUsd: "1500", totalUsd: "3000" } }));
    assert.equal(over.res.status, 422);
    assert.match(JSON.stringify(over.body.error.details.violations), /beta cap/u);
    const upside = await create(payInvoices({ budget: { perStepUsd: "30", perDayUsd: "20", totalUsd: "10" } }));
    assert.equal(upside.res.status, 400);
    assert.equal(upside.body.error.code, "INVALID_LEASH");
    const noPayee = await create(payInvoices({ recipients: [] }));
    assert.equal(noPayee.res.status, 400);
    const ownerKey = await create(payInvoices({ agent: { name: "x", signer: OWNER } }));
    assert.equal(ownerKey.res.status, 400);
  });

  describe("a live leash", () => {
    let leashId = "";
    let key = "";
    let sessionId: Hex;
    const asLeash = () => ({ "lykia-key": key });

    before(async () => {
      const { body } = await create(payInvoices({ agent: { name: "Payer", signer: AGENT_KEY } }));
      leashId = body.leash.id;
      key = body.apiKey.secret;
      sessionId = account.land(body.transactions[body.transactions.length - 1].data);
      arc.onCall = async () => ({ data: "0x" });
    });

    it("binds the session from the chain and reads usage from it", async () => {
      const view = await json<Body>(await call(`/v1/leashes/${leashId}`, { headers: asLeash() }));
      assert.equal(view.status, "active");
      assert.equal(view.session.sessionId, sessionId);
      assert.equal(view.usage.source, "chain");
      assert.equal(view.usage.tokens.find((t: { token: string }) => t.token === USDC).spendable, "20000000");
      assert.equal(view.usage.day.remainingUsd, "20.00");
    });

    it("a leash key cannot create, renew, revoke or widen, nor reach anything else", async () => {
      const refused = async (path: string, body?: unknown) => {
        const res = await call(path, { headers: asLeash(), ...(body !== undefined ? { body } : {}) });
        return { status: res.status, code: (await json<{ error?: { code: string } }>(res)).error?.code };
      };
      assert.deepEqual(await refused("/v1/leashes", payInvoices()), { status: 403, code: "LEASH_KEY_SCOPE" });
      assert.deepEqual(await refused(`/v1/leashes/${leashId}/renew`, { expiresAt: days(30), budget: { perStepUsd: "500", perDayUsd: "500", totalUsd: "5000" } }), { status: 403, code: "LEASH_KEY_SCOPE" });
      assert.deepEqual(await refused(`/v1/leashes/${leashId}/revoke`, {}), { status: 403, code: "LEASH_KEY_SCOPE" });
      assert.deepEqual(await refused(`/v1/leashes/${leashId}/session`, {}), { status: 403, code: "LEASH_KEY_SCOPE" });
      assert.deepEqual(await refused(`/v1/leashes?owner=${OWNER}`), { status: 403, code: "LEASH_KEY_SCOPE" });
      assert.deepEqual(await refused(`/v1/pack?owner=${OWNER}`), { status: 403, code: "LEASH_KEY_SCOPE" });
      assert.deepEqual(await refused("/v1/intents", { owner: OWNER, text: "send 100 USDC to 0x3333333333333333333333333333333333333333" }), { status: 403, code: "LEASH_KEY_SCOPE" });
      assert.deepEqual(await refused("/v1/developers/keys", { label: "escape" }), { status: 403, code: "LEASH_KEY_SCOPE" });
      assert.deepEqual(await refused("/v1/leashes/lsh_000000000000"), { status: 403, code: "LEASH_KEY_SCOPE" });
      // Another owner cannot touch it either.
      const other = await call(`/v1/leashes/${leashId}/revoke`, { headers: { "lykia-session": otherSession }, body: {} });
      assert.equal(other.status, 403);
      assert.equal((await call(`/v1/leashes/${leashId}`, { headers: { "lykia-session": otherSession } })).status, 403);
    });

    it("denies over-cap, off-venue and off-payee requests with reason codes and what is left", async () => {
      const deny = async (text: string) => {
        const res = await call(`/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text } });
        assert.equal(res.status, 422, text);
        const body = await json<{ error: { code: string; details: { reasons: { code: string; message: string }[]; remaining: Record<string, string> } } }>(res);
        assert.equal(body.error.code, "LEASH_DENIED");
        return body.error.details;
      };
      const over = await deny(`send 30 USDC to ${PAYEE}`);
      assert.ok(over.reasons.some((r) => r.code === "fence.caps.step"), JSON.stringify(over.reasons));
      assert.deepEqual(over.remaining, { stepUsd: "20.00", dayUsd: "20.00", totalUsd: "140.00" });
      const stranger = await deny(`send 5 USDC to ${STRANGER}`);
      assert.ok(stranger.reasons.some((r) => r.code === "fence.recipients"));
      const swap = await deny("swap 10 USDC to EURC");
      assert.ok(swap.reasons.some((r) => r.code === "fence.kinds"), JSON.stringify(swap.reasons));
      assert.ok(swap.reasons.some((r) => r.code === "fence.venues"), JSON.stringify(swap.reasons));
      const vault = await deny("deposit 10 USDC into the Galaxy vault");
      assert.ok(vault.reasons.some((r) => ["fence.kinds", "fence.venues", "leash.venue.none"].includes(r.code)), JSON.stringify(vault.reasons));
      const denials = hooks.filter((h) => h.type === "leash.denied");
      assert.equal(denials.length, 4);
      assert.ok(Array.isArray(denials[0]!.data.reasons) && denials[0]!.data.remaining);
    });

    it("plans inside the leash, wraps the step for the session key, and settles it with a chain-proven trail", async () => {
      const res = await call(`/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `send 10 USDC to ${PAYEE}` } });
      const plan = await json<Body>(res);
      assert.equal(res.status, 200, JSON.stringify(plan));
      const prepared = plan.prepared;
      assert.equal(prepared.transaction.from, AGENT_KEY, "the agent's key signs, never the owner");
      assert.equal(prepared.simulated, true);
      assert.ok(prepared.calls.every((c: { kind: string }) => c.kind === "agentTransfer"));
      assert.ok(prepared.calls.some((c: { to: string; amount: string }) => c.to === PAYEE && c.amount === "10000000"));
      // The agent sends it; the chain emits AgentTransfer and AgentMemo for the session.
      const hash = keccak256(toHex("leash-tx-1"));
      arc.transactions.set(hash, { from: AGENT_KEY, to: prepared.transaction.to, input: prepared.transaction.data, value: 0n, chainId: 5042 });
      const memo = toHex(new TextEncoder().encode(prepared.memo));
      arc.receipts.set(hash, {
        status: "success",
        blockNumber: 990n,
        logs: [
          log("AgentTransfer", { sessionId, token: USDC, to: PAYEE }, encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [10_000_000n, keccak256(memo)]), hash),
          log("AgentMemo", { sessionId, memoHash: keccak256(memo) }, encodeAbiParameters([{ type: "bytes" }], [memo]), hash),
        ],
      });
      const submitted = await json<Body>(await call(`/v1/leashes/${leashId}/submit`, { headers: asLeash(), body: { intentId: prepared.intentId, stepId: prepared.stepId, hash } }));
      assert.equal(submitted.status, "settled", JSON.stringify(submitted));
      assert.equal(submitted.chainProven, true);
      assert.equal(submitted.usage.day.spentUsd, "10.10", "the 1% fee counts toward the leash");
      // 50% of the day: one threshold webhook.
      const thresholds = hooks.filter((h) => h.type === "leash.budget.threshold").map((h) => `${h.data.window}:${h.data.threshold}`);
      assert.ok(thresholds.includes("day:50"), JSON.stringify(thresholds));
      assert.ok(!thresholds.includes("day:80"));
      // A transaction the session key sent directly, without Lykia.
      const rogue = keccak256(toHex("rogue"));
      arc.logs = [log("AgentTransfer", { sessionId, token: USDC, to: PAYEE }, encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [1_000_000n, keccak256("0x")]), rogue)];
      const trail = await json<{ items: { kind: string; chainProven: boolean; source: string; txHash?: string }[] }>(await call(`/v1/leashes/${leashId}/trail`, { headers: asLeash() }));
      const settled = trail.items.find((i) => i.kind === "settled")!;
      assert.equal(settled.chainProven, true);
      assert.equal(settled.txHash, hash);
      assert.ok(trail.items.filter((i) => i.kind === "denied").every((i) => !i.chainProven));
      const direct = trail.items.find((i) => i.source === "chain")!;
      assert.equal(direct.txHash, rogue);
      assert.equal(direct.chainProven, true);
      // A receipt without the memo is not proven.
      const plan2 = await json<Body>(await call(`/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `send 6 USDC to ${PAYEE}` } }));
      const hash2 = keccak256(toHex("leash-tx-2"));
      arc.transactions.set(hash2, { from: AGENT_KEY, to: plan2.prepared.transaction.to, input: plan2.prepared.transaction.data, value: 0n, chainId: 5042 });
      arc.receipts.set(hash2, { status: "success", blockNumber: 991n, logs: [] });
      const unproven = await json<Body>(await call(`/v1/leashes/${leashId}/submit`, { headers: asLeash(), body: { intentId: plan2.prepared.intentId, stepId: plan2.prepared.stepId, hash: hash2 } }));
      assert.equal(unproven.chainProven, false);
      assert.ok(hooks.some((h) => h.type === "leash.budget.threshold" && h.data.threshold === 80), "16.16 of 20 crossed 80%");
      // A hash that is not the prepared transaction is refused.
      const plan3 = await json<Body>(await call(`/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `send 1 USDC to ${PAYEE}` } }));
      const forged = keccak256(toHex("forged"));
      arc.transactions.set(forged, { from: AGENT_KEY, to: plan3.prepared.transaction.to, input: "0xdeadbeef", value: 0n, chainId: 5042 });
      assert.equal((await call(`/v1/leashes/${leashId}/submit`, { headers: asLeash(), body: { intentId: plan3.prepared.intentId, stepId: plan3.prepared.stepId, hash: forged } })).status, 409);
    });

    it("refuses when the chain says there is not enough left (spendable is authoritative)", async () => {
      const limit = account.limits.get(`${sessionId}:${USDC}`)!;
      account.limits.set(`${sessionId}:${USDC}`, { ...limit, consumed: limit.budget - 2_000_000n });
      const res = await call(`/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `send 3 USDC to ${PAYEE}` } });
      const body = await json<{ error: { details: { reasons: { code: string }[] } } }>(res);
      assert.equal(res.status, 422);
      assert.ok(body.error.details.reasons.some((r) => r.code === "leash.chain.spendable"), JSON.stringify(body));
      account.limits.set(`${sessionId}:${USDC}`, limit);
    });

    it("MCP with a leash key lists only the leash's tools", async () => {
      const rpc = async (headers: Record<string, string>, method: string, params: unknown = {}) => {
        const r = await call("/v1/mcp", { headers: { accept: "application/json, text/event-stream", ...headers }, body: { jsonrpc: "2.0", id: 1, method, params } });
        const text = await r.text();
        const line = text.split("\n").find((l) => l.startsWith("data: "));
        return JSON.parse(line ? line.slice(6) : text) as { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean } };
      };
      const leashed = (await rpc(asLeash(), "tools/list")).result?.tools?.map((t) => t.name).sort();
      assert.deepEqual(leashed, ["leash_plan", "leash_status", "leash_submit", "leash_trail", "lykia_scent", "lykia_venues"]);
      const open = (await rpc({}, "tools/list")).result?.tools?.map((t) => t.name) ?? [];
      assert.ok(open.includes("lykia_plan") && open.includes("lykia_pack") && !open.includes("leash_plan"));
      const deniedCall = await rpc(asLeash(), "tools/call", { name: "leash_plan", arguments: { sentence: `send 50 USDC to ${PAYEE}` } });
      assert.equal(deniedCall.result?.isError, true);
      assert.match(deniedCall.result?.content?.[0]?.text ?? "", /LEASH_DENIED/u);
      const escape = await rpc(asLeash(), "tools/call", { name: "lykia_plan", arguments: { sentence: "send 5 USDC to 0x3333333333333333333333333333333333333333", owner: OWNER } });
      assert.ok(!escape.result || escape.result.isError, "a tool the leash does not have cannot be called");
      // A narrower leash: plan, submit and status only.
      const { body } = await create(payInvoices({ agent: { name: "Narrow", signer: AGENT_KEY }, budget: { perStepUsd: "5", perDayUsd: "5", totalUsd: "5" }, tools: ["plan", "submit", "status"] }));
      const narrow = (await rpc({ "lykia-key": body.apiKey.secret }, "tools/list")).result?.tools?.map((t) => t.name).sort();
      assert.deepEqual(narrow, ["leash_plan", "leash_status", "leash_submit"]);
      await leashService(ctx).revoke(await leashService(ctx).get(body.leash.id));
    });

    it("revoking disables the key at once and returns revokeSession", async () => {
      const res = await call(`/v1/leashes/${leashId}/revoke`, { headers: owner(), body: {} });
      const body = await json<Body>(res);
      assert.equal(res.status, 200);
      assert.equal(body.keyDisabled, true);
      const { functionName, args } = decodeFunctionData({ abi: ACCOUNT_ABI, data: body.transaction.data });
      assert.equal(functionName, "revokeSession");
      assert.equal(args[0], sessionId);
      assert.equal(body.transaction.from, OWNER);
      assert.equal((await call(`/v1/leashes/${leashId}`, { headers: asLeash() })).status, 401, "the key is dead on the very next request");
      assert.equal((await call(`/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `send 1 USDC to ${PAYEE}` } })).status, 401);
      assert.ok(hooks.some((h) => h.type === "leash.revoked" && h.data.keyDisabled === true));
      assert.equal((await agentServices(ctx).pack.get(body.leash.agentId)).status, "revoked");
    });
  });

  it("renews as a new carve with a new key; the old key stops", async () => {
    const first = await create(payInvoices({ agent: { name: "Renewer", signer: AGENT_KEY } }));
    const res = await call(`/v1/leashes/${first.body.leash.id}/renew`, { headers: owner(), body: { expiresAt: days(14), budget: { perStepUsd: "20", perDayUsd: "20", totalUsd: "280" } } });
    const renewed = await json<Body>(res);
    assert.equal(res.status, 201, JSON.stringify(renewed));
    assert.notEqual(renewed.leash.id, first.body.leash.id);
    assert.equal(renewed.leash.renewedFrom, first.body.leash.id);
    assert.notEqual(renewed.apiKey.secret, first.body.apiKey.secret);
    assert.equal((await leashService(ctx).get(first.body.leash.id)).status, "revoked");
    assert.equal((await call(`/v1/leashes/${first.body.leash.id}`, { headers: { "lykia-key": first.body.apiKey.secret } })).status, 401);
    await leashService(ctx).revoke(await leashService(ctx).get(renewed.leash.id));
  });

  it("warns a day before expiry and expires the key with the leash", async () => {
    const { body } = await create(payInvoices({ agent: { name: "Short", signer: AGENT_KEY }, expiresAt: new Date(clock.now() + 20 * 3_600_000).toISOString() }));
    await leashService(ctx).tick();
    assert.ok(hooks.some((h) => h.type === "leash.expiring" && h.data.leashId === body.leash.id));
    clock.advance(21 * 3_600_000);
    const res = await call(`/v1/leashes/${body.leash.id}`, { headers: { "lykia-key": body.apiKey.secret } });
    assert.equal(res.status, 403);
    assert.equal((await json<{ error: { code: string } }>(res)).error.code, "LEASH_EXPIRED");
    await leashService(ctx).tick();
    assert.equal((await leashService(ctx).get(body.leash.id)).status, "expired");
    clock.advance(-21 * 3_600_000);
  });

  it("wraps approvals into the call they were for and refuses a stray approval", () => {
    const sid = `0x${"ab".repeat(32)}` as Hex;
    const router = "0x4444444444444444444444444444444444444444" as Address;
    const approve = { to: USDC, data: "0x095ea7b3000000000000000000000000444444444444444444444444444444444444444400000000000000000000000000000000000000000000000000000000000f4240" as Hex, value: "0" };
    const swap = { to: router, data: "0x04e45aaf0000" as Hex, value: "0" };
    const wrapped = wrapForSession([approve, swap], { account: ACCOUNT, sessionId: sid, memo: "0x" });
    assert.equal(wrapped.length, 1);
    assert.equal(wrapped[0]!.kind, "agentExecute");
    assert.equal(wrapped[0]!.spendToken, USDC);
    assert.equal(wrapped[0]!.spendAmount, "1000000");
    assert.throws(() => wrapForSession([approve], { account: ACCOUNT, sessionId: sid, memo: "0x" }), /standing allowance/u);
  });
});
