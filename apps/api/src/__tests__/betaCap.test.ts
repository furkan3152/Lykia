/**
 * Regression tests: every mainnet value-moving route that does not go
 * through the planner still runs the Fence and the beta cap (CCTP forward,
 * Gateway drafts and caller-drafted intents, StableFX tradable quotes and
 * trades, LykiaOrders drafts and signed orders).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getToken, tokenAddress } from "@lykia/core";
import { createApp } from "../app.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import type { PulseFeed } from "../arc/pulse.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "./support.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41";
const pad = (a: string) => `0x${"0".repeat(24)}${a.slice(2)}`;

describe("mainnet beta cap on routes outside the planner", () => {
  let ctx: AppContext;
  let served: Served;
  before(async () => {
    ctx = createContext(testConfig({ LYKIA_MODE: "mainnet", LYKIA_BETA_CAP_USD: "50", STABLEFX_API_KEY: "TEST_API_KEY:abc:def", LYKIA_RATE_LIMIT_HEAVY: "1000" }), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${served.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { error?: { code: string; details?: { verdict?: { reasons: { rule: string }[] } } } } };
  };
  const capped = (r: Awaited<ReturnType<typeof post>>) => r.status === 422 && r.body.error?.code === "FENCE_DENIED" && (r.body.error.details?.verdict?.reasons ?? []).some((x) => x.rule === "beta.cap");

  it("CCTP forward", async () => {
    assert.ok(capped(await post("/v1/circle/cctp/forward", { owner: OWNER, destination: "base", amount: "100", environment: "mainnet" })));
  });

  it("Gateway draft, server-kept draft and caller-drafted burn intents", async () => {
    assert.ok(capped(await post("/v1/circle/gateway/transfer/draft", { owner: OWNER, destination: "base", amount: "100", environment: "mainnet" })));
    assert.ok(capped(await post("/v1/circle/gateway/transfer", { owner: OWNER, destination: "base", amount: "100", environment: "mainnet" })));
    const intent = { maxBlockHeight: "1", maxFee: "1", spec: { sourceDepositor: pad(OWNER), destinationRecipient: pad(OWNER), sourceSigner: pad(OWNER), value: "100000000" } };
    assert.ok(capped(await post("/v1/circle/gateway/transfer", { destination: "base", environment: "mainnet", burnIntents: [intent], signatures: [`0x${"ab".repeat(65)}`] })));
    const unreadable = await post("/v1/circle/gateway/transfer", { destination: "base", environment: "mainnet", burnIntents: [{ spec: {} }], signatures: [`0x${"ab".repeat(65)}`] });
    assert.equal(unreadable.status, 400);
    // Under the cap, the Fence does not stand in the way (whatever Gateway answers next).
    const small = await post("/v1/circle/gateway/transfer/draft", { owner: OWNER, destination: "base", amount: "10", environment: "mainnet" });
    assert.notEqual(small.body.error?.code, "FENCE_DENIED");
  });

  it("StableFX: tradable quotes are judged, and a trade needs a quote judged for the same taker", async () => {
    assert.ok(capped(await post("/v1/circle/stablefx/quote", { from: "USDC", to: "EURC", amount: "100", recipientAddress: OWNER, environment: "mainnet" })));
    const trade = await post("/v1/circle/stablefx/trade", { quoteId: "q-unknown-123", address: OWNER, message: {}, signature: `0x${"ab".repeat(65)}`, environment: "mainnet" });
    assert.equal(trade.status, 404);
  });

  it("LykiaOrders drafts and signed orders", async () => {
    assert.ok(capped(await post("/v1/orders/draft", { owner: OWNER, environment: "mainnet", kind: "limit", sell: "USDC", buy: "EURC", amount: "100", triggerPrice: "1.2" })));
    const order = { maker: OWNER, tokenIn: tokenAddress(getToken("USDC")!, "mainnet")!, tokenOut: tokenAddress(getToken("EURC")!, "mainnet")!, amountIn: "100000000", minAmountOut: "1", maxTip: "0", maxFeeBps: 10, oracle: OWNER, triggerPrice: "0", triggerAbove: true, maxOracleAge: 0, kind: 0, executions: 1, interval: 0, startTime: 0, deadline: 0, nonce: "1" };
    const signed = await post("/v1/orders", { environment: "mainnet", kind: "limit", order, signature: `0x${"ab".repeat(65)}` });
    assert.ok(capped(signed), JSON.stringify(signed));
  });
});
