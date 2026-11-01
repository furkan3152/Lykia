import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FEE_BPS, ORDER_EIP712_TYPES, type SignedOrderStruct } from "@lykia/core";
import { concat, hashDomain, hashTypedData, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../app.js";
import type { PulseFeed } from "../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { orderHash } from "../orders/service.js";
import { issueToken } from "../platform/session.js";
import { FakeArc, serve, testConfig, type Served } from "./support.js";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const BOT_TOKEN = "123456:test-token";

const sampleOrder: SignedOrderStruct = {
  maker: account.address,
  tokenIn: "0x3600000000000000000000000000000000000000",
  tokenOut: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  amountIn: "1000000",
  minAmountOut: "850000",
  maxTip: "1000",
  maxFeeBps: 100,
  oracle: "0x361b95c10b76Ca3f35C686d423e43A951755Bf23",
  triggerPrice: "110000000",
  triggerAbove: false,
  maxOracleAge: 93_600,
  kind: 0,
  executions: 1,
  interval: 0,
  startTime: 1_700_000_000,
  deadline: 1_800_000_000,
  nonce: "7",
};

describe("orders: hashing matches EIP-712", () => {
  it("orderHash is the struct hash inside the EIP-712 digest a wallet signs", () => {
    const domain = { name: "LykiaOrders", version: "1", chainId: 5042, verifyingContract: "0x1111111111111111111111111111111111111111" as const };
    const message = { ...sampleOrder, amountIn: 1_000_000n, minAmountOut: 850_000n, maxTip: 1000n, triggerPrice: 110_000_000n, startTime: 1_700_000_000n, deadline: 1_800_000_000n, nonce: 7n };
    const digest = hashTypedData({ domain, types: ORDER_EIP712_TYPES, primaryType: "Order", message });
    const separator = hashDomain({ domain: domain as never, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } });
    assert.equal(keccak256(concat(["0x1901", separator, orderHash(sampleOrder)])), digest);
    assert.notEqual(orderHash({ ...sampleOrder, nonce: "8" }), orderHash(sampleOrder));
  });
});

describe("desk routes", () => {
  let ctx: AppContext;
  let served: Served;
  let token: string;
  const telegram: { url: string; body: Record<string, unknown> }[] = [];

  before(async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://api.telegram.org/")) {
        telegram.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("extended.exchange/api/v1/info/markets")) {
        return new Response(JSON.stringify({ status: "OK", data: [
          { name: "BTC-USD", category: "Crypto", status: "ACTIVE", visibleOnUi: true, marketStats: { lastPrice: "78000", markPrice: "78001", dailyVolume: "5000000", fundingRate: "0.00001", openInterest: "40000000", dailyPriceChangePercentage: "0.01" }, tradingConfig: { maxLeverage: "50" } },
          { name: "OLD-USD", category: "Crypto", status: "DELISTED", visibleOnUi: false },
        ] }), { status: 200 });
      }
      throw new TypeError(`offline: ${url}`);
    };
    ctx = createContext(testConfig({ TELEGRAM_BOT_TOKEN: BOT_TOKEN, LYKIA_MODE: "testnet" }), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: fetchImpl });
    served = await serve(createApp(ctx));
    token = issueToken(ctx, account.address).token;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`${served.url}${path}`, { method, headers: { "content-type": "application/json", "Lykia-Session": token, accept: "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  it("orders config names the fee and says when the contract is not deployed", async () => {
    const r = await call("GET", "/v1/orders/config?environment=testnet");
    assert.equal(r.status, 200);
    assert.equal(r.body.feeBps, DEFAULT_FEE_BPS);
    assert.equal(r.body.address, null);
    assert.ok((r.body.notes as string[]).some((n) => /not deployed/u.test(n)));
  });

  it("orders reject a bad draft and refuse to submit before deployment", async () => {
    const bad = await call("POST", "/v1/orders/draft", { owner: account.address, kind: "limit", sell: "USDC", buy: "USDC", amount: "-1" });
    assert.equal(bad.status, 400);
    const submit = await call("POST", "/v1/orders", { environment: "testnet", kind: "limit", summary: "x", order: sampleOrder, signature: `0x${"11".repeat(65)}` });
    assert.notEqual(submit.status, 201);
  });

  it("alerts validate, list, pause and delete", async () => {
    assert.equal((await call("POST", "/v1/alerts", { kind: "price-above", token: "USDC", threshold: "1" })).status, 400);
    assert.equal((await call("POST", "/v1/alerts", { kind: "price-above", token: "WOLF", threshold: "1" })).status, 400);
    const created = await call("POST", "/v1/alerts", { kind: "health-below", threshold: "1.2", channels: ["inbox", "telegram"] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id as string;
    const list = await call("GET", "/v1/alerts");
    assert.equal((list.body.alerts as unknown[]).length, 1);
    assert.equal((await call("PATCH", `/v1/alerts/${id}`, { paused: true })).body.paused, true);
    assert.equal((await call("DELETE", `/v1/alerts/${id}`)).body.deleted, true);
    const anonymous = await fetch(`${served.url}/v1/alerts`);
    assert.equal(anonymous.status, 401);
  });

  it("links Telegram with a one-time /start code behind the webhook secret", async () => {
    const code = (await call("POST", "/v1/telegram/link-code", {})).body.code as string;
    assert.match(code, /^LYK-[0-9A-F]{8}$/u);
    const secret = createHash("sha256").update(`lykia-telegram:${BOT_TOKEN}`).digest("hex").slice(0, 48);
    const update = { message: { chat: { id: 42 }, text: `/start ${code}` } };
    assert.equal((await call("POST", "/v1/telegram/webhook", update, { "x-telegram-bot-api-secret-token": "wrong" })).status, 404);
    assert.equal((await call("POST", "/v1/telegram/webhook", update, { "x-telegram-bot-api-secret-token": secret })).status, 200);
    assert.equal((await call("GET", "/v1/telegram/status")).body.linked, true);
    assert.equal(telegram.at(-1)?.body.chat_id, 42);
    assert.ok(!JSON.stringify(telegram.at(-1)?.body).includes(BOT_TOKEN));
    // A used code does not link twice.
    await call("POST", "/v1/telegram/webhook", { message: { chat: { id: 99 }, text: `/start ${code}` } }, { "x-telegram-bot-api-secret-token": secret });
    assert.match(String(telegram.at(-1)?.body.text), /expired/u);
  });

  it("serves perps markets read-only and validates market names", async () => {
    const m = await call("GET", "/v1/perps/markets");
    assert.equal(m.status, 200);
    const markets = m.body.markets as { market: string }[];
    assert.deepEqual(markets.map((x) => x.market), ["BTC-USD"]);
    assert.equal((await call("GET", "/v1/perps/markets/not$valid")).status, 400);
  });

  it("launch radar on testnet lists launchpads without scanning", async () => {
    const r = await call("GET", "/v1/discover/launches?environment=testnet");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.pools, []);
    assert.ok((r.body.launchpads as unknown[]).length >= 1);
  });

  it("activity needs a session and returns one feed", async () => {
    const r = await call("GET", "/v1/activity?environment=testnet");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.items));
    assert.equal((await fetch(`${served.url}/v1/activity`)).status, 401);
  });
  it("tracks a transaction hash and keeps a per-owner watchlist", async () => {
    const t = await call("GET", `/v1/track/0x${"ab".repeat(32)}?environment=testnet`);
    assert.equal(t.status, 200);
    assert.equal(t.body.status, "not-found");
    assert.equal((await call("GET", "/v1/track/0x12")).status, 400);
    const added = await call("POST", "/v1/watch", { address: "0x2222222222222222222222222222222222222222", label: "Treasury" });
    assert.equal(added.status, 201);
    assert.equal(((await call("GET", "/v1/watch")).body.items as unknown[]).length, 1);
    assert.equal((await call("DELETE", "/v1/watch/0x2222222222222222222222222222222222222222")).body.removed, true);
  });
});
