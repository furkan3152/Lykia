import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../app.js";
import type { PulseFeed } from "../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { readSentence } from "../language/reader.js";
import { SAMPLE_OWNER } from "../modules/agent.js";
import { issueToken } from "../platform/session.js";
import { FakeArc, serve, testConfig, type Served } from "./support.js";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

describe("reader: Lykia's own words and safe numbers", () => {
  it("reads pastures as the best yield", () => {
    assert.deepEqual(readSentence("put 100 USDC on the greenest pasture").actions, [{ verb: "earn", token: "USDC", amount: { exact: "100" } }]);
    assert.deepEqual(readSentence("lead the flock to greener pastures with 100 USDC").actions.map((a) => a.verb), ["earn"]);
    const complex = readSentence("Keep 5,000 USDC for payroll, put the rest on the greenest pasture and hedge 20% into EURC").actions.map((a) => a.verb);
    assert.deepEqual(complex, ["reserve", "earn", "fx"]);
  });
  it("never guesses a decimal comma", () => {
    const r = readSentence("send 1,5 USDC to 0x1111111111111111111111111111111111111111");
    assert.equal(r.actions.length, 0);
    assert.match(r.clarify[0] ?? "", /dot for decimals/u);
  });
});

describe("web-facing routes", () => {
  let ctx: AppContext;
  let served: Served;
  let token: string;
  const gatewayCalls: unknown[] = [];

  before(async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/transfer")) {
        gatewayCalls.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ transferId: "t-9", attestation: "0xaa", signature: "0xbb" }), { status: 200 });
      }
      if (url.endsWith("/v1/balances")) return new Response(JSON.stringify({ balances: [{ domain: 26, balance: "12.5" }, { domain: 6, balance: "0.5" }] }), { status: 200 });
      throw new TypeError(`offline: ${url}`);
    };
    ctx = createContext(testConfig(), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: fetchImpl });
    served = await serve(createApp(ctx));
    token = issueToken(ctx, account.address).token;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${served.url}${path}`, { method, headers: { "content-type": "application/json", "Lykia-Session": token, accept: "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  it("accepts the web's flat profile and answers in both shapes", async () => {
    const put = await call("PUT", "/v1/profile", { language: "tr", currency: "EUR", network: "testnet", theme: "night", risk: "low", slippageBps: 40, favoriteVenues: ["aave-v4"], blockedVenues: [], tone: "playful", verbosity: "short", look: { collar: "#B8442B", coat: "fawn", tag: "LYKO" }, quietHours: { on: false, from: "22:00", to: "08:00" }, notify: { webhook: "", telegram: "" }, widgets: ["flock", "pack"], confirm: "above-cap", explainLikeNew: true, retentionDays: 90 });
    assert.equal(put.status, 200, JSON.stringify(put.body).slice(0, 300));
    assert.equal(put.body.currency, "EUR");
    assert.equal((put.body.profile as { displayCurrency: string }).displayCurrency, "EUR");
    assert.equal((put.body.look as { coat: string }).coat, "fawn");
  });

  it("Gateway: draft, sign, attest, mint (the web flow) and the unified balance", async () => {
    const draft = await call("POST", "/v1/circle/gateway/transfer", { owner: account.address, environment: "testnet", amount: "5", destination: "base" });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    const signature = await account.signTypedData(draft.body.typedData as Parameters<typeof account.signTypedData>[0]);
    const minted = await call("POST", "/v1/circle/gateway/transfer/attest", { owner: account.address, environment: "testnet", signature, transferId: draft.body.transferId });
    assert.equal(minted.status, 200);
    assert.equal((minted.body.transaction as { chainId: number }).chainId, 84532);
    assert.equal(gatewayCalls.length, 1);
    const again = await call("POST", "/v1/circle/gateway/transfer/attest", { owner: account.address, environment: "testnet", signature, transferId: draft.body.transferId });
    assert.equal(again.status, 404, "a draft is used once");
    const balance = await call("GET", `/v1/circle/gateway/balance?owner=${account.address}&environment=testnet`);
    assert.equal(balance.body.total, "13");
    const screening = await call("GET", `/v1/circle/compliance/${account.address}`);
    assert.equal(screening.body.result, "not-configured");
  });

  it("chat without a wallet plans a labelled dry run for a sample address", async () => {
    const r = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ message: "send 5 USDC to 0x1111111111111111111111111111111111111111", environment: "mainnet" }) });
    const body = (await r.json()) as { reply: string; events: { event: string; data: { kind?: string; text?: string } }[] };
    assert.ok(body.events.some((e) => e.event === "notice" && e.data.kind === "sample" && (e.data.text ?? "").includes(SAMPLE_OWNER)));
    assert.doesNotMatch(body.reply, /^\*\*Sample address/u, "the app shows the one sample notice");
    assert.ok(body.events.some((e) => e.event === "block" && e.data.kind === "sample"), "a sample card with the Connect action");
  });
});
