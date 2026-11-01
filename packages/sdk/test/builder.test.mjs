// The aggregator, build, integrations and data modules: paths, bodies and the modular subpaths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lykia } from "../dist/index.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const TAKER = "0x1111111111111111111111111111111111111111";

test("aggregator and build modules call the quote -> build routes", async () => {
  const seen = [];
  const lykia = new Lykia({ baseUrl: "https://api.test", environment: "mainnet", fetch: async (url, init) => {
    seen.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    return json(200, url.includes("/build") ? { transactions: [], calls: [], security: { decision: "pass" } } : { id: "q_abcdefghijkl" });
  } });
  const quote = await lykia.aggregator.quote("swap", { taker: TAKER, tokenIn: "USDC", tokenOut: "EURC", amount: "100", integratorFee: { bps: 20, recipient: TAKER } });
  assert.equal(quote.id, "q_abcdefghijkl");
  await lykia.aggregator.build(quote.id, { format: "eip5792" });
  await lykia.build.deposit({ taker: TAKER, token: "USDC", amount: "50" });
  await lykia.build.quote.bridge({ taker: TAKER, amount: "10", destination: "base" });
  await lykia.aggregator.swapQuote({ taker: TAKER, tokenIn: "USDC", tokenOut: "EURC", amount: "5" });
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url.replace("https://api.test", "").split("?")[0]}`), ["POST /v1/aggregator/quote", "POST /v1/aggregator/build", "POST /v1/build/deposit", "POST /v1/quote/bridge", "GET /v1/aggregator/quote"]);
  assert.equal(seen[0].body.kind, "swap");
  assert.equal(seen[0].body.environment, "mainnet");
  assert.equal(seen[1].body.format, "eip5792");
});

test("integrations and data modules, and their subpaths", async () => {
  const { createTransport } = await import("../dist/transport.js");
  const { integrationsApi } = await import("../dist/integrations.js");
  const { dataApi } = await import("../dist/data.js");
  const { buildApi } = await import("../dist/build.js");
  const { aggregatorApi } = await import("../dist/aggregator.js");
  const seen = [];
  const t = createTransport({ baseUrl: "https://api.test", fetch: async (url, init) => (seen.push(`${init.method} ${url.replace("https://api.test", "")}`), json(200, {})) });
  const i = integrationsApi(t);
  await i.adapters.submit({ schema: "lykia.adapter/v1" }, { validate: true });
  await i.adapters.review("my-vault", "approve");
  await i.contracts.encode({ abi: ["function f(uint256 a)"], function: "f", args: ["1"] });
  await i.ai.route({ text: "swap 5 USDC to EURC", owner: TAKER });
  await dataApi(t).prices(["EURC", "cirBTC"]);
  await dataApi(t).screenAddress(TAKER);
  assert.equal(typeof buildApi(t).swap, "function");
  assert.equal(typeof aggregatorApi(t).build, "function");
  assert.deepEqual(seen, ["POST /v1/integrations/adapters", "POST /v1/integrations/adapters/my-vault/review", "POST /v1/contracts/encode", "POST /v1/ai/route", "GET /v1/data/prices?symbols=EURC%2CcirBTC", `GET /v1/security/screen/address/${TAKER}`]);
});
