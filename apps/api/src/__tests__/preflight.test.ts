/**
 * Preflight through the API: findings ride on the planned intent and on
 * the chat's proposal, a warning needs `acknowledge: true` at prepare, a
 * block refuses prepare, a fix re-plans clean, and GET .../preflight reads
 * it again. The owner's own case first: 2 of 2.01 USDC to EURC on Arc.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FENCE, type Finding } from "@lykia/core";
import { createApp } from "../app.js";
import type { PulseFeed } from "../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { issueToken } from "../platform/session.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "./support.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41";
const OTHER = "0x5555555555555555555555555555555555555501";
const FRIEND = "0xabcd1111111111111111111111111111111b1234";
const LOOKALIKE = "0xabcd9999999999999999999999999999999b1234";
const USDC = "0x3600000000000000000000000000000000000000";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

describe("preflight: API", () => {
  let ctx: AppContext;
  let served: Served;
  const arc = new FakeArc();

  before(async () => {
    arc.setBalance(USDC, OWNER, 2_010_000n);
    arc.setBalance(USDC, OTHER, 100_000_000n);
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const post = (path: string, body: unknown, session?: string) => fetch(`${served.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(session ? { "lykia-session": issueToken(ctx, session).token } : {}) }, body: JSON.stringify(body) });
  const plan = async (text: string, owner = OWNER, fence: unknown = DEFAULT_FENCE) => {
    const res = await post("/v1/intents", { text, owner, environment: "mainnet", fence });
    assert.equal(res.status, 201, await res.clone().text());
    return (await res.json()) as { intent: { id: string; preflight?: Finding[] } };
  };

  it("the owner's case: buying EURC with 2 of 2.01 USDC warns about gas, with a computed fix near 1.50", async () => {
    const { intent } = await plan("buy EURC with 2 USDC");
    const gas = intent.preflight?.find((f) => f.check === "gas-reserve");
    assert.ok(gas, JSON.stringify(intent.preflight?.map((f) => f.id)));
    assert.equal(gas.severity, "warn");
    assert.match(gas.why, /gas is paid in USDC/u);
    const fix = gas.fixes.find((f) => f.kind === "replan")!;
    const amount = Number((fix.actions![0] as { amount: { exact: string } }).amount.exact);
    assert.ok(amount >= 1.49 && amount <= 1.5, String(amount));
    assert.ok(gas.figures.every((f) => f.source.length > 0));

    // A warning needs the owner's acknowledgement before anything is prepared.
    const bare = await post(`/v1/intents/${intent.id}/steps/s1/prepare`, { stage: true });
    assert.equal(bare.status, 409);
    const err = (await bare.json()) as { error: { code: string; details: { findings: Finding[] } } };
    assert.equal(err.error.code, "PREFLIGHT_ACK_REQUIRED");
    assert.ok(err.error.details.findings.some((f) => f.check === "gas-reserve"));
    const acked = await post(`/v1/intents/${intent.id}/steps/s1/prepare`, { stage: true, acknowledge: true });
    assert.equal(acked.status, 200, await acked.clone().text());
    const body = (await acked.json()) as { preflight: Finding[]; transactions: unknown[] };
    assert.ok(body.transactions.length > 0);
    assert.ok(body.preflight.some((f) => f.check === "gas-reserve"));

    // The fix re-plans through the same reader: nothing left to warn about the gas.
    const again = await plan(fix.sentence!);
    assert.equal(again.intent.preflight?.find((f) => f.check === "gas-reserve"), undefined, JSON.stringify(again.intent.preflight?.map((f) => f.title)));
  });

  it("a poisoned address blocks prepare, with a 'Did you mean' fix; GET .../preflight reads it again", async () => {
    await ctx.store.collection("security_recipients").put(`${OTHER}:${FRIEND}`, { address: FRIEND, count: 2, lastAt: "2026-11-01T00:00:00.000Z" });
    const fence = { ...DEFAULT_FENCE, recipients: { mode: "allowlist", allow: [LOOKALIKE, FRIEND] } };
    const { intent } = await plan(`send 5 USDC to ${LOOKALIKE}`, OTHER, fence);
    const f = intent.preflight?.find((x) => x.check === "recipient");
    assert.equal(f?.severity, "block");
    assert.equal((f!.fixes[0]!.actions![0] as { to: string }).to.toLowerCase(), FRIEND);
    const res = await post(`/v1/intents/${intent.id}/steps/s1/prepare`, { confirm: true, acknowledge: true });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "PREFLIGHT_BLOCKED");
    const read = (await (await fetch(`${served.url}/v1/intents/${intent.id}/preflight`)).json()) as { gate: { blocked: boolean }; findings: Finding[] };
    assert.equal(read.gate.blocked, true);
    assert.ok(read.findings.some((x) => x.check === "recipient"));
  });

  it("the chat leads with the warning and carries the findings on the proposal", async () => {
    const res = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "lykia-session": issueToken(ctx, OWNER).token }, body: JSON.stringify({ message: "buy EURC with 2 USDC", owner: OWNER, environment: "mainnet" }) });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { reply: string; events: { event: string; data: { preflight?: Finding[] } }[] };
    const proposal = json.events.find((e) => e.event === "proposal")?.data;
    assert.ok(proposal?.preflight?.some((f) => f.check === "gas-reserve"), JSON.stringify(proposal));
    assert.match(json.reply, /^That would leave [\d.]+ USDC for gas: on Arc, gas is paid in USDC/u);
    assert.match(json.reply, /Use 1\.5\d? USDC and keep 0\.5 for gas\?/u);
  });

  it("an amount the wallet cannot cover becomes a plan that names what is missing", async () => {
    const res = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "lykia-session": issueToken(ctx, OWNER).token }, body: JSON.stringify({ message: "buy EURC with 5 USDC", owner: OWNER, environment: "mainnet" }) });
    const json = (await res.json()) as { reply: string; events: { event: string; data: { preflight?: Finding[]; intentId?: string | null } }[] };
    const proposal = json.events.find((e) => e.event === "proposal")?.data;
    const short = proposal?.preflight?.find((f) => f.check === "insufficient");
    assert.equal(short?.severity, "block", JSON.stringify(proposal));
    assert.match(short!.why, /4\.95 to move \+ 0\.05 Lykia fee \+ up to [\d.]+ network fee; the wallet has 2\.01 USDC/u);
    assert.equal(proposal?.intentId, null);
    assert.match(json.reply, /short/u);
  });
});
