/**
 * Gateway leashes (Stile) end to end over HTTP, against a fake Arc with a
 * modelled LykiaStile and a fake Gateway API: the feature flag, creation
 * (the Stile's creation from the owner's wallet, addDelegate, createSession
 * with the beta ceilings), binding, denials with reason codes, the plan's
 * burn intents and reserve transaction, submission to Gateway with the
 * contract signer, the three-source trail and revocation.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FEE_RECIPIENT, lykiaContracts, type Address } from "@lykia/core";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getContractAddress, keccak256, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { ManualClock } from "../../clock.js";
import { FakeArc, serve, testConfig, type Served } from "../../__tests__/support.js";
import { setLlmClient } from "../../agents/index.js";
import { issueToken } from "../../platform/session.js";
import { GATEWAY_MINTER, GATEWAY_WALLET } from "../../circle/chains.js";
import { attestationUsedIn, GATEWAY_MINTER_EVENTS, GATEWAY_WALLET_ABI, intentsDigest, sessionIdOf, STILE_ABI, transferSpecHashOf, type BurnIntentMessage } from "../stile.js";
import { gatewayRequest } from "../gateway.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const OWNER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d").address.toLowerCase() as Address;
const AGENT_KEY = "0x7777777777777777777777777777777777777777" as Address;
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const STRANGER = "0x3333333333333333333333333333333333333333" as Address;
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const OWNER_NONCE = 7;
const STILE = getContractAddress({ from: OWNER, nonce: BigInt(OWNER_NONCE) }).toLowerCase() as Address;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

/** The parts of LykiaStile and Gateway Wallet a leash reads, as a model. */
class FakeStile {
  nonce = 0n;
  paused = false;
  delegated = false;
  sessions = new Map<string, { key: Address; validUntil: bigint; revoked: boolean; perTransfer: bigint; daily: bigint; lifetime: bigint; maxGatewayFee: bigint; anyRecipient: boolean; policyHash: Hex; consumed: bigint }>();
  constructor(private readonly clock: ManualClock) {}

  install(arc: FakeArc): void {
    const sid = (c: { args?: readonly unknown[] }) => String(c.args?.[0]).toLowerCase();
    const imm: Record<string, unknown> = {
      owner: OWNER,
      gatewayWallet: GATEWAY_WALLET.mainnet,
      gatewayMinter: `0x${"0".repeat(24)}${GATEWAY_MINTER.mainnet.slice(2).toLowerCase()}`,
      token: USDC,
      sourceDomain: 26,
      ceilingPerTransfer: 100_000_000n,
      ceilingDaily: 300_000_000n,
      feeBps: 100,
      feeRecipient: `0x${"0".repeat(24)}${DEFAULT_FEE_RECIPIENT.slice(2)}`,
    };
    for (const [name, value] of Object.entries(imm)) arc.extraReads.set(name, () => value);
    arc.extraReads.set("sessionNonce", () => this.nonce);
    arc.extraReads.set("paused", () => this.paused);
    arc.extraReads.set("isAuthorizedForBalance", () => this.delegated);
    arc.extraReads.set("getSession", (c) => this.sessions.get(sid(c)) ?? { key: "0x0000000000000000000000000000000000000000", validUntil: 0n, revoked: false, anyRecipient: false, perTransfer: 0n, daily: 0n, lifetime: 0n, maxGatewayFee: 0n, policyHash: ZERO32 });
    arc.extraReads.set("isSessionValid", (c) => this.valid(sid(c)));
    arc.extraReads.set("getUsage", (c) => [this.sessions.get(sid(c))?.consumed ?? 0n, this.sessions.get(sid(c))?.consumed ?? 0n]);
    arc.extraReads.set("spendable", (c) => {
      const s = this.sessions.get(sid(c));
      if (!s || !this.valid(sid(c))) return 0n;
      return [s.perTransfer, s.daily - s.consumed, s.lifetime - s.consumed].reduce((a, b) => (a < b ? a : b));
    });
  }

  valid(id: string): boolean {
    const s = this.sessions.get(id);
    return Boolean(s && !this.paused && !s.revoked && Number(s.validUntil) * 1000 >= this.clock.now());
  }

  /** What the owner's createSession does once signed. */
  land(data: Hex): Hex {
    const { args } = decodeFunctionData({ abi: STILE_ABI, data });
    const [key, limits, , , policyHash] = args as unknown as [Address, { validUntil: bigint; perTransfer: bigint; daily: bigint; lifetime: bigint; maxGatewayFee: bigint; anyRecipient: boolean }, readonly number[], readonly Hex[], Hex];
    this.nonce += 1n;
    const id = sessionIdOf(STILE, key, this.nonce).toLowerCase() as Hex;
    this.sessions.set(id, { key, ...limits, revoked: false, policyHash, consumed: 0n });
    return id;
  }
}

describe("gateway leashes (Stile)", () => {
  let ctx: AppContext;
  let off: AppContext;
  let served: Served;
  let servedOff: Served;
  let arc: FakeArc;
  let stile: FakeStile;
  const clock = new ManualClock(Date.UTC(2026, 10, 8, 10, 0, 0));
  const gatewayCalls: { url: string; body: unknown }[] = [];
  let transferAnswer: { status: number; body: unknown } = { status: 201, body: {} };
  let arcBalance = "250";

  const fakeFetch = async (input: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    gatewayCalls.push({ url: input, body });
    const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (input.includes("/v1/balances")) return reply(200, { token: "USDC", balances: [{ domain: 26, depositor: OWNER, balance: arcBalance }, { domain: 6, depositor: OWNER, balance: "40" }] });
    if (input.includes("/v1/estimate")) return reply(200, { body: (body as { spec: unknown }[]).map((row) => ({ burnIntent: { maxBlockHeight: "99999999", maxFee: "8000", spec: row.spec } })), fees: { total: "0.016" } });
    if (input.includes("/v1/transfer/")) return reply(200, { status: "confirmed", transactionHash: `0x${"ab".repeat(32)}` });
    if (input.includes("/v1/transfer")) return reply(transferAnswer.status, transferAnswer.body);
    return reply(404, {});
  };

  const call = (url: string, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(`${url}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  const json = async <T = Body>(res: Response) => (await res.json()) as T;
  const owner = (c: AppContext = ctx) => ({ "lykia-session": issueToken(c, OWNER).token });
  const days = (n: number) => new Date(clock.now() + n * 86_400_000).toISOString();
  const gatewayLeash = (over: Record<string, unknown> = {}) => ({ agent: { name: "Gateway payer", signer: AGENT_KEY }, spendFrom: "gateway", destinations: ["base", "arc"], budget: { perStepUsd: "20", perDayUsd: "40", totalUsd: "200" }, expiresAt: days(7), recipients: [PAYEE], ...over });

  before(async () => {
    arc = new FakeArc();
    arc.now = () => Math.floor(clock.now() / 1000);
    stile = new FakeStile(clock);
    stile.install(arc);
    const base = arc.client.bind(arc);
    arc.client = (() => ({ ...base(), getTransactionCount: async () => OWNER_NONCE })) as never;
    const cfg = { LYKIA_SESSION_SECRET: "l".repeat(40), LYKIA_MODE: "mainnet", LYKIA_RATE_LIMIT_HEAVY: "1000" };
    ctx = createContext(testConfig({ ...cfg, LYKIA_STILE: "mainnet", LYKIA_STILE_REFERENCE_MAINNET: "0x5711e00000000000000000000000000000000001" }), { chains: arc.asChains(), pulse: idlePulse, clock, fetch: fakeFetch as never });
    off = createContext(testConfig(cfg), { chains: arc.asChains(), pulse: idlePulse, clock, fetch: fakeFetch as never });
    setLlmClient(ctx, null);
    setLlmClient(off, null);
    served = await serve(createApp(ctx));
    servedOff = await serve(createApp(off));
  });
  after(async () => {
    await served.close();
    await servedOff.close();
    await closeContext(ctx);
    await closeContext(off);
  });

  it("is hidden while LYKIA_STILE is off", async () => {
    const t = await json(await call(servedOff.url, "/v1/leashes/templates"));
    assert.deepEqual(t.gateway.available, { testnet: false, mainnet: false });
    assert.match(t.gateway.reasons.mainnet, /not switched on/u);
    const res = await call(servedOff.url, "/v1/leashes", { headers: owner(off), body: gatewayLeash() });
    assert.equal(res.status, 409);
    assert.equal((await json(res)).error.code, "NOT_AVAILABLE");
    const on = await json(await call(served.url, "/v1/leashes/templates"));
    assert.equal(on.gateway.available.mainnet, true);
    assert.equal(on.gateway.available.testnet, false, "testnet is off until named");
    assert.deepEqual(on.gateway.ceilings, { perStepUsd: "100", perDayUsd: "300" });
    assert.ok(on.gateway.destinations.some((d: { key: string; domain: number }) => d.key === "base" && d.domain === 6));
  });

  it("refuses budgets above the Stile ceilings, other templates, unknown chains and sub-agents", async () => {
    const bad = async (over: Record<string, unknown>) => {
      const res = await call(served.url, "/v1/leashes", { headers: owner(), body: gatewayLeash(over) });
      return { status: res.status, body: await json(res) };
    };
    const big = await bad({ budget: { perStepUsd: "150", perDayUsd: "150", totalUsd: "300" } });
    assert.equal(big.status, 400);
    assert.match(JSON.stringify(big.body.error.details.issues), /at most \$100 per transfer/u);
    const day = await bad({ budget: { perStepUsd: "100", perDayUsd: "301", totalUsd: "900" } });
    assert.match(JSON.stringify(day.body.error.details.issues), /\$300 a day/u);
    const trade = await bad({ template: "trade-small" });
    assert.equal(trade.status, 400);
    assert.match(JSON.stringify(trade.body.error.details.issues), /pay-invoices/u);
    const nowhere = await bad({ destinations: ["solana"] });
    assert.equal(nowhere.status, 400);
    assert.match(JSON.stringify(nowhere.body.error.details.issues), /does not reach solana/u);
    const none = await bad({ destinations: undefined });
    assert.equal(none.status, 400);
    const arcOnly = await call(served.url, "/v1/leashes", { headers: owner(), body: { ...gatewayLeash(), spendFrom: undefined } });
    assert.equal(arcOnly.status, 400, "destinations go with spendFrom gateway");
  });

  describe("a live Gateway leash", () => {
    let leashId = "";
    let key = "";
    let sessionId: Hex;
    let created: Body;
    const asLeash = () => ({ "lykia-key": key });

    before(async () => {
      const res = await call(served.url, "/v1/leashes", { headers: owner(), body: gatewayLeash() });
      created = await json(res);
      assert.equal(res.status, 201, JSON.stringify(created));
      leashId = created.leash.id;
      key = created.apiKey.secret;
    });

    it("creates the Stile from the owner's wallet, adds it as a Gateway delegate and issues the session", async () => {
      const l = created.leash;
      assert.equal(l.spendFrom, "gateway");
      assert.equal(l.session, null);
      assert.equal(l.status, "pending");
      assert.equal(l.stile.address, STILE);
      assert.deepEqual(l.stile.destinations, ["base", "arc"]);
      assert.deepEqual(l.fence.venues.allow, ["gateway"]);
      assert.equal(created.session, null);
      // The creation: no `to`, from the owner, at the address the owner's nonce predicts, with Lykia's expected immutables.
      const d = created.stile.deployment;
      assert.equal(d.from, OWNER);
      assert.equal(d.predictedAddress, STILE);
      assert.equal(d.nonce, OWNER_NONCE);
      assert.ok(d.data.startsWith(lykiaContracts.lykiaStileArtifact.bytecode));
      const ctor = `0x${d.data.slice(lykiaContracts.lykiaStileArtifact.bytecode.length)}` as Hex;
      assert.equal(ctor.length, 2 + 9 * 64);
      assert.ok(ctor.includes(OWNER.slice(2)) && ctor.includes(GATEWAY_WALLET.mainnet.slice(2).toLowerCase()) && ctor.includes(DEFAULT_FEE_RECIPIENT.slice(2)));
      // Then addDelegate(USDC, stile) on Gateway Wallet and createSession on the Stile.
      assert.equal(created.transactions.length, 2);
      const [delegate, sessionTx] = created.transactions;
      assert.equal(delegate.to, GATEWAY_WALLET.mainnet);
      const dd = decodeFunctionData({ abi: GATEWAY_WALLET_ABI, data: delegate.data });
      assert.equal(dd.functionName, "addDelegate");
      assert.deepEqual((dd.args as readonly string[]).map((a) => a.toLowerCase()), [USDC, STILE]);
      assert.equal(sessionTx.to, STILE);
      const sd = decodeFunctionData({ abi: STILE_ABI, data: sessionTx.data });
      assert.equal(sd.functionName, "createSession");
      const [k, limits, domains, recipients, policyHash] = sd.args as unknown as [Address, { perTransfer: bigint; daily: bigint; lifetime: bigint; maxGatewayFee: bigint; anyRecipient: boolean; validUntil: bigint }, readonly number[], readonly Hex[], Hex];
      assert.equal(k.toLowerCase(), AGENT_KEY);
      assert.deepEqual([limits.perTransfer, limits.daily, limits.lifetime, limits.maxGatewayFee, limits.anyRecipient], [20_000_000n, 40_000_000n, 200_000_000n, 100_000n, false]);
      assert.equal(Number(limits.validUntil), Math.floor(Date.parse(l.expiresAt) / 1000));
      assert.deepEqual([...domains], [6, 26]);
      assert.deepEqual(recipients.map((r) => r.toLowerCase()), [`0x${"0".repeat(24)}${PAYEE.slice(2)}`]);
      assert.equal(policyHash, `0x${l.fenceHash.slice(7)}`);
      assert.ok(created.enforcement.some((e: { limit: string }) => e.limit === "Lykia fee"));
      assert.ok(created.notes.some((n: string) => /deposited on Arc/u.test(n)));
    });

    it("stays pending until the Stile is there, then binds the session", async () => {
      const pending = await json(await call(served.url, `/v1/leashes/${leashId}`, { headers: asLeash() }));
      assert.equal(pending.status, "pending");
      const plan = await call(served.url, `/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `send 5 USDC to ${PAYEE} on base` } });
      assert.equal(plan.status, 422);
      assert.equal((await json(plan)).error.details.reasons[0].code, "leash.session.pending");
      // The owner's three transactions land.
      arc.code.set(STILE, lykiaContracts.lykiaStileArtifact.deployedBytecode as Hex);
      stile.delegated = true;
      sessionId = stile.land(created.transactions[1].data);
      const view = await json(await call(served.url, `/v1/leashes/${leashId}`, { headers: asLeash() }));
      assert.equal(view.status, "active");
      assert.equal(view.stile.sessionId, sessionId);
      assert.equal(view.usage.source, "chain");
      assert.equal(view.usage.stile.spendable, "20000000");
      assert.equal(view.usage.stile.arcBalanceUsdc, "250");
      assert.equal(view.usage.stile.delegated, true);
    });

    it("refuses what the leash does not allow, with reason codes", async () => {
      const deny = async (text: string) => {
        const res = await call(served.url, `/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text } });
        assert.equal(res.status, 422, text);
        return (await json(res)).error.details.reasons.map((r: { code: string }) => r.code) as string[];
      };
      assert.ok((await deny(`send 5 USDC to ${PAYEE} on ethereum`)).includes("leash.gateway.destination"));
      assert.ok((await deny(`send 5 USDC to ${STRANGER} on base`)).includes("leash.gateway.recipient"));
      const over = await deny(`send 20 USDC to ${PAYEE} on base`);
      assert.ok(over.includes("fence.caps.step"), "20 + 1% fee is above the $20 step cap");
      assert.ok(over.includes("leash.chain.spendable"));
      assert.ok((await deny("swap 10 USDC to EURC")).includes("leash.not-understood"));
      arcBalance = "3";
      assert.ok((await deny(`send 5 USDC to ${PAYEE} on base`)).includes("leash.gateway.balance"));
      arcBalance = "250";
      stile.paused = true;
      assert.ok((await deny(`send 5 USDC to ${PAYEE} on base`)).includes("leash.stile.paused"));
      stile.paused = false;
      stile.delegated = false;
      assert.ok((await deny(`send 5 USDC to ${PAYEE} on base`)).includes("leash.stile.delegate"));
      stile.delegated = true;
    });

    it("plans one transfer: burn intents [payment, Lykia fee], the digest and the reserve transaction for the session key", async () => {
      const calls: { account?: unknown; to?: string; data?: string }[] = [];
      arc.onCall = async (r) => {
        calls.push(r);
        return { data: "0x" };
      };
      const res = await call(served.url, `/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `send 10 USDC to ${PAYEE} on base` } });
      const plan = await json(res);
      assert.equal(res.status, 200, JSON.stringify(plan));
      assert.equal(plan.intent, null);
      const g = plan.prepared.gateway;
      assert.equal(g.destination, "base");
      assert.equal(g.amountUsdc, "10");
      assert.equal(g.lykiaFeeUsdc, "0.1");
      const [pay, fee] = g.burnIntents as BurnIntentMessage[];
      assert.equal(pay!.spec.value, "10000000");
      assert.equal(pay!.spec.destinationDomain, 6);
      assert.equal(pay!.spec.sourceDomain, 26);
      assert.equal(pay!.spec.sourceSigner, `0x${"0".repeat(24)}${STILE.slice(2)}`);
      assert.equal(pay!.spec.sourceDepositor, `0x${"0".repeat(24)}${OWNER.slice(2)}`);
      assert.equal(pay!.spec.hookData, "0x");
      assert.equal(fee!.spec.value, "100000");
      assert.equal(fee!.spec.destinationRecipient, `0x${"0".repeat(24)}${DEFAULT_FEE_RECIPIENT.slice(2)}`);
      assert.equal(fee!.spec.destinationDomain, 6);
      assert.equal(pay!.maxFee, "8000", "Gateway's estimate");
      assert.equal(g.digest, intentsDigest([pay!, fee!]));
      assert.equal(g.transferSpecHash, transferSpecHashOf(pay!.spec));
      assert.equal(g.signature, encodeAbiParameters([{ type: "bytes32" }], [sessionId]));
      const tx = plan.prepared.transaction;
      assert.equal(tx.from, AGENT_KEY);
      assert.equal(tx.to, STILE);
      const r = decodeFunctionData({ abi: STILE_ABI, data: tx.data });
      assert.equal(r.functionName, "reserve");
      assert.equal((r.args as readonly unknown[])[0], sessionId);
      assert.match(Buffer.from(String((r.args as readonly unknown[])[2]).slice(2), "hex").toString(), new RegExp(`^lykia:1:${plan.prepared.intentId}:s1:[0-9a-f]{16}$`, "u"));
      assert.ok(calls.some((c) => c.to === STILE && c.data === tx.data && c.account === AGENT_KEY), "simulated from the session key");
      // A simulated revert is a refusal with the Stile's own error.
      arc.onCall = async () => {
        throw Object.assign(new Error("execution reverted"), { data: "0x8baa579f" });
      };
      const reverted = await call(served.url, `/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `send 10 USDC to ${PAYEE} on base` } });
      assert.equal((await json(reverted)).error.details.reasons[0].code, "leash.chain.revert");
      arc.onCall = async () => ({ data: "0x" });
    });

    it("submits: proves the reservation from its receipt, then posts the set to Gateway with the contract signer", async () => {
      const plan = await json(await call(served.url, `/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `pay 12 USDC to ${PAYEE} on base` } }));
      const p = plan.prepared;
      const hash = `0x${"5a".repeat(32)}` as Hex;
      arc.transactions.set(hash, { from: p.transaction.from, to: p.transaction.to, input: p.transaction.data, value: 0n, chainId: 5042 });
      const reservedTopics = encodeEventTopics({ abi: STILE_ABI, eventName: "Reserved", args: { sessionId, digest: p.gateway.digest, transferSpecHash: p.gateway.transferSpecHash } } as never);
      const reservedData = encodeAbiParameters([{ type: "uint32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint64" }], [6, `0x${"0".repeat(24)}${PAYEE.slice(2)}`, 12_000_000n, 120_000n, ZERO32, 1n]);
      const memoTopics = encodeEventTopics({ abi: STILE_ABI, eventName: "StileMemo", args: { sessionId, digest: p.gateway.digest } } as never);
      const memoData = encodeAbiParameters([{ type: "bytes" }], [toHex(p.memo)]);
      const logs = [
        { address: STILE, topics: reservedTopics, data: reservedData, transactionHash: hash, blockNumber: 990n, logIndex: 0, blockHash: ZERO32, transactionIndex: 0, removed: false },
        { address: STILE, topics: memoTopics, data: memoData, transactionHash: hash, blockNumber: 990n, logIndex: 1, blockHash: ZERO32, transactionIndex: 0, removed: false },
      ];
      arc.receipts.set(hash, { status: "success", logs, blockNumber: 990n });
      // Gateway cannot see the reservation yet: pending, retry the same hash.
      transferAnswer = { status: 400, body: { message: "Invalid signature" } };
      const first = await json(await call(served.url, `/v1/leashes/${leashId}/submit`, { headers: asLeash(), body: { intentId: p.intentId, stepId: "s1", hash } }));
      assert.equal(first.status, "pending", JSON.stringify(first));
      assert.equal(first.chainProven, true);
      assert.match(first.gateway.note, /about 5 minutes/u);
      stile.sessions.get(sessionId.toLowerCase())!.consumed = 12_120_000n;
      transferAnswer = { status: 201, body: { transferId: "d4e5f6a7-b8c9-0123-def0-234567890123", attestation: "0xaa11", signature: "0xbb22" } };
      gatewayCalls.length = 0;
      const second = await json(await call(served.url, `/v1/leashes/${leashId}/submit`, { headers: asLeash(), body: { intentId: p.intentId, stepId: "s1", hash } }));
      assert.equal(second.status, "settled", JSON.stringify(second));
      assert.equal(second.gateway.transferId, "d4e5f6a7-b8c9-0123-def0-234567890123");
      assert.equal(second.gateway.mint.to, GATEWAY_MINTER.mainnet);
      assert.equal(second.gateway.mint.chainId, 8453);
      const sent = gatewayCalls.find((c) => c.url.endsWith("/v1/transfer"))!.body as { burnIntentSet: { intents: unknown[] }; signature: Hex; contractSigner: boolean }[];
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.contractSigner, true);
      assert.equal(sent[0]!.burnIntentSet.intents.length, 2);
      assert.equal(sent[0]!.signature, p.gateway.signature);
      // Counted once, against the leash's day.
      const view = await json(await call(served.url, `/v1/leashes/${leashId}`, { headers: asLeash() }));
      assert.equal(view.usage.day.spentUsd, "12.12");
      // Settled steps cannot be submitted again.
      assert.equal((await call(served.url, `/v1/leashes/${leashId}/submit`, { headers: asLeash(), body: { intentId: p.intentId, stepId: "s1", hash } })).status, 409);
    });

    it("joins the trail: Reserved and StileMemo on Arc, Gateway's record, the destination mint", async () => {
      const trail = await json(await call(served.url, `/v1/leashes/${leashId}/trail`, { headers: asLeash() }));
      const settled = trail.items.find((i: { kind: string }) => i.kind === "settled");
      assert.ok(settled, JSON.stringify(trail.items.map((i: { kind: string }) => i.kind)));
      assert.equal(settled.chainProven, true);
      assert.deepEqual(settled.chain.events.map((e: { name: string }) => e.name), ["Reserved", "StileMemo"]);
      assert.equal(settled.gateway.status, "confirmed");
      assert.equal(settled.gateway.mintTxHash, `0x${"ab".repeat(32)}`);
      assert.equal(settled.gateway.attestationUsed, null, "Base is not read without LYKIA_GATEWAY_RPC_BASE");
      assert.ok(trail.items.some((i: { kind: string }) => i.kind === "denied"));
    });

    it("revokes: the key dies at once and revokeSession, pause and removeDelegate come back", async () => {
      const res = await json(await call(served.url, `/v1/leashes/${leashId}/revoke`, { headers: owner(), body: {} }));
      assert.equal(res.keyDisabled, true);
      assert.equal(res.transaction.to, STILE);
      assert.equal(decodeFunctionData({ abi: STILE_ABI, data: res.transaction.data }).functionName, "revokeSession");
      assert.deepEqual(res.more.map((t: { data: Hex; to: string }) => (t.to === STILE ? decodeFunctionData({ abi: STILE_ABI, data: t.data }).functionName : decodeFunctionData({ abi: GATEWAY_WALLET_ABI, data: t.data }).functionName)), ["setPaused", "removeDelegate"]);
      assert.match(res.note, /about 5 minutes/u);
      const after = await call(served.url, `/v1/leashes/${leashId}/plan`, { headers: asLeash(), body: { text: `send 1 USDC to ${PAYEE} on base` } });
      assert.ok([401, 403].includes(after.status), String(after.status));
    });

    it("a second Gateway leash reuses the owner's Stile and needs no delegation", async () => {
      const res = await call(served.url, "/v1/leashes", { headers: owner(), body: gatewayLeash({ agent: { name: "Second", signer: "0x8888888888888888888888888888888888888888" } }) });
      const body = await json(res);
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.stile.deployment, null);
      assert.equal(body.stile.address, STILE);
      assert.equal(body.transactions.length, 1);
      assert.equal(body.leash.stile.nonceAtCreation, "1");
      await call(served.url, `/v1/leashes/${body.leash.id}/revoke`, { headers: owner(), body: {} });
    });
  });

  it("reads one transfer request from text or actions, with the chain", () => {
    const l = { stile: { destinations: ["base", "arc"] } } as never;
    assert.deepEqual(gatewayRequest({ text: `send 10 USDC to ${PAYEE} on Base` }, l), { to: PAYEE, amount: "10", destination: "base" });
    assert.deepEqual(gatewayRequest({ text: `pay 2.5 USDC to ${PAYEE} via op mainnet` }, l), { to: PAYEE, amount: "2.5", destination: "optimism" });
    assert.deepEqual(gatewayRequest({ actions: [{ verb: "bridge", token: "USDC", amount: { exact: "3" }, destination: "base", recipient: PAYEE }] }, l), { to: PAYEE, amount: "3", destination: "base" });
    assert.deepEqual(gatewayRequest({ text: `send 4 USDC to ${PAYEE}` }, { stile: { destinations: ["arc"] } } as never), { to: PAYEE, amount: "4", destination: "arc" });
    assert.ok("error" in gatewayRequest({ text: `send all my USDC to ${PAYEE}` }, l));
    assert.ok("error" in gatewayRequest({ text: `send 4 EURC to ${PAYEE}` }, l));
  });

  it("hashes burn intents as Gateway does (EIP-712, independent of viem's typed-data encoder)", () => {
    const spec = { version: 1, sourceDomain: 26, destinationDomain: 6, sourceContract: `0x${"0".repeat(24)}${"11".repeat(20)}` as Hex, destinationContract: `0x${"0".repeat(24)}${"22".repeat(20)}` as Hex, sourceToken: `0x${"0".repeat(24)}${"33".repeat(20)}` as Hex, destinationToken: `0x${"0".repeat(24)}${"44".repeat(20)}` as Hex, sourceDepositor: `0x${"0".repeat(24)}${"55".repeat(20)}` as Hex, destinationRecipient: `0x${"0".repeat(24)}${"66".repeat(20)}` as Hex, sourceSigner: `0x${"0".repeat(24)}${"77".repeat(20)}` as Hex, destinationCaller: ZERO32, value: "1000000", salt: `0x${"99".repeat(32)}` as Hex, hookData: "0x" as Hex };
    const intent = { maxBlockHeight: "123", maxFee: "456", spec };
    const enc = (types: string[], values: unknown[]) => keccak256(encodeAbiParameters(types.map((type) => ({ type })), values as never));
    // Circle's constants (circlefin/evm-gateway-contracts, src/lib/TransferSpec.sol, BurnIntents.sol).
    const SPEC_TH = "0x44409c7ba8872720f5fc290d2788c2d70a3905b7ca1cdb2ffa152791a69e089b";
    const INTENT_TH = "0x8b99d17a83a2dd1add9fc2a450e22732c7e8564aa110ab99c20485a7a10ba37c";
    const SET_TH = "0xe30760cf7d79e3521ad1553a73a6c6f8d33226ea613eaa29ceda6de148fbd07a";
    const specHash = enc(["bytes32", "uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"], [SPEC_TH, 1, 26, 6, spec.sourceContract, spec.destinationContract, spec.sourceToken, spec.destinationToken, spec.sourceDepositor, spec.destinationRecipient, spec.sourceSigner, spec.destinationCaller, 1_000_000n, spec.salt, keccak256("0x")]);
    const intentHash = enc(["bytes32", "uint256", "uint256", "bytes32"], [INTENT_TH, 123n, 456n, specHash]);
    const domain = enc(["bytes32", "bytes32", "bytes32"], [keccak256(toHex("EIP712Domain(string name,string version)")), keccak256(toHex("GatewayWallet")), keccak256(toHex("1"))]);
    const digest = (struct: Hex) => keccak256(`0x1901${domain.slice(2)}${struct.slice(2)}`);
    assert.equal(intentsDigest([intent]), digest(intentHash));
    const setHash = enc(["bytes32", "bytes32"], [SET_TH, keccak256(`0x${intentHash.slice(2)}${intentHash.slice(2)}`)]);
    assert.equal(intentsDigest([intent, intent]), digest(setHash));
  });

  it("recognises GatewayMinter's AttestationUsed for a transferSpecHash", () => {
    const tsh = `0x${"cd".repeat(32)}` as Hex;
    const topics = encodeEventTopics({ abi: GATEWAY_MINTER_EVENTS, eventName: "AttestationUsed", args: { token: USDC, recipient: PAYEE, transferSpecHash: tsh } } as never);
    const data = encodeAbiParameters(parseAbi(["function f(uint32,bytes32,bytes32,uint256)"])[0]!.inputs, [26, ZERO32, ZERO32, 5n]);
    const log = { address: GATEWAY_MINTER.mainnet, topics, data } as never;
    assert.equal(attestationUsedIn([log], GATEWAY_MINTER.mainnet, tsh), true);
    assert.equal(attestationUsedIn([log], GATEWAY_MINTER.mainnet, ZERO32), false);
    assert.equal(attestationUsedIn([log], STRANGER, tsh), false);
  });
});
