/**
 * The builder surface, offline: aggregator quote -> build, AI routing,
 * adapter manifests (submit, validate, review, route), generic contracts,
 * data and security endpoints, and the MCP tools. The chain is a fake that
 * answers reads, Multicall3From eth_calls and code lookups.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FENCE, validateAdapterManifest } from "@lykia/core";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, erc20Abi, type Hex } from "viem";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import type { ArcChains } from "../../chains/arc.js";
import { MULTICALL3_FROM_ABI } from "../../engine/abis.js";
import { setLlmClient } from "../../agents/index.js";
import { issueToken } from "../../platform/session.js";
import { EXAMPLE_MANIFEST } from "../../integrations/example.js";
import { registerBuilderTools } from "../mcpTools.js";
import { constrainedFence, understand } from "../ai.js";
import { actionsOf } from "../service.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "../../__tests__/support.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41";
const ADMIN = "0x9999999999999999999999999999999999999999";
const PAYEE = "0x1111111111111111111111111111111111111111";
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1";
const VAULT = EXAMPLE_MANIFEST.contracts.mainnet!.vault!.toLowerCase();
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

/** FakeArc plus eth_call (Multicall3From batches), code, gas price and balances. */
class BuilderArc extends FakeArc {
  failCalls = false;
  calls: { to: string; data: Hex }[] = [];

  override client() {
    const base = super.client();
    const balance = (token: string, holder: string) => this.balances.get(`${token.toLowerCase()}:${holder.toLowerCase()}`) ?? 0n;
    return {
      ...base,
      readContract: async (call: { address: string; functionName: string; args?: readonly unknown[] }) => {
        if (call.functionName === "maxWithdraw") return 0n;
        if (call.functionName === "convertToAssets") return 1_020_000n;
        return base.readContract(call as never);
      },
      getBlockNumber: async () => 1000n,
      getGasPrice: async () => 20_000_000_000n,
      getBalance: async () => 10n ** 18n,
      getCode: async ({ address }: { address: string }) => (address.toLowerCase() === VAULT ? "0x6080604052636e553f6563b460af94" : "0x60806040"),
      getStorageAt: async () => "0x",
      getLogs: async () => [],
      call: async ({ to, data }: { to: string; data: Hex }) => {
        this.calls.push({ to, data });
        const decoded = decodeFunctionData({ abi: MULTICALL3_FROM_ABI, data });
        const inner = decoded.args[0] as readonly { target: string; callData: Hex }[];
        const results = inner.map((c) => {
          if (this.failCalls && !c.callData.startsWith("0x70a08231")) return { success: false, returnData: "0x" as Hex };
          if (c.callData.startsWith("0x70a08231")) {
            const holder = `0x${c.callData.slice(34, 74)}`;
            return { success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [balance(c.target, holder)]) };
          }
          return { success: true, returnData: "0x" as Hex };
        });
        return { data: encodeFunctionResult({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", result: results }) };
      },
    };
  }

  override asChains(): ArcChains {
    const chains = super.asChains() as unknown as Record<string, unknown>;
    return { ...chains, client: () => this.client(), getBalances: async (_e: string, owner: string, tokens: readonly string[]) => ({ balances: tokens.map((t) => ({ token: t, balance: t === "native" ? 10n ** 18n : (this.balances.get(`${t.toLowerCase()}:${owner.toLowerCase()}`) ?? 0n) })), block: 1000n }) } as unknown as ArcChains;
  }
}

describe("builder API", () => {
  let ctx: AppContext;
  let served: Served;
  const arc = new BuilderArc();

  before(async () => {
    arc.setBalance(USDC, OWNER, 5_000_000_000n);
    arc.setBalance(EURC, OWNER, 1_000_000_000n);
    arc.vaultAssets.set("0x8e357432cc12ff425c36432f312968aeb16112af", 80_000_000_000_000n);
    ctx = createContext(testConfig({ LYKIA_MODE: "mainnet", LYKIA_ADMIN_ADDRESSES: ADMIN }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    setLlmClient(ctx, null);
    served = await serve(createApp(ctx));
  });

  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${served.url}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are read loosely
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  /* ------------------------------------------------------------ aggregator */

  it("quotes a swap from query params with route, fees, gas and a quote id", async () => {
    const { status, body } = await call("GET", `/v1/aggregator/quote?tokenIn=USDC&tokenOut=EURC&amount=100&taker=${OWNER}&environment=mainnet`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.match(body.id, /^q_/u);
    assert.equal(body.best.venue, "uniswap-v3");
    assert.equal(body.route.steps[0].kind, "fx");
    assert.equal(body.fees.lykiaBps, 100);
    assert.equal(body.fees.lines[0].lykia, "1");
    assert.ok(Number(body.gas.usdc) > 0);
    assert.equal(body.buy[0].symbol, "EURC");
    assert.equal(typeof body.priceImpactBps, "number");
    assert.equal(body.fence.decision, "allow");
  });

  it("builds from a quote id: simulated, security-checked, Lykia's fee in the batch", async () => {
    const quote = await call("POST", "/v1/quote/swap", { taker: OWNER, tokenIn: "USDC", tokenOut: "EURC", amount: "100", environment: "mainnet" });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    const built = await call("POST", "/v1/aggregator/build", { quoteId: quote.body.id });
    assert.equal(built.status, 200, JSON.stringify(built.body));
    assert.equal(built.body.simulation.ok, true);
    assert.equal(built.body.transactions.length, 1);
    assert.notEqual(built.body.security.decision, "block");
    assert.equal(built.body.steps[0].security.schema, "lykia.security/v1");
    // The fee transfer (1 USDC to the fee recipient) is one of the plain calls.
    const fee = built.body.calls.find((c: { to: string; data: string }) => c.to.toLowerCase() === USDC && c.data.startsWith("0xa9059cbb"));
    assert.ok(fee, "fee transfer present");
    assert.equal(decodeFunctionData({ abi: erc20Abi, data: fee.data }).args[1], 1_000_000n);
  });

  it("returns plain calls and EIP-5792 wallet_sendCalls for smart accounts", async () => {
    const calls = await call("POST", "/v1/build/deposit", { taker: OWNER, token: "USDC", amount: "50", environment: "mainnet", format: "calls" });
    assert.equal(calls.status, 200, JSON.stringify(calls.body));
    assert.equal(calls.body.transactions.length, 0);
    assert.ok(calls.body.calls.length >= 3, "approve + fee + deposit");
    const wallet = await call("POST", "/v1/build/deposit", { taker: OWNER, token: "USDC", amount: "50", environment: "mainnet", format: "eip5792" });
    assert.equal(wallet.body.walletSendCalls.version, "2.0.0");
    assert.equal(wallet.body.walletSendCalls.chainId, "0x13b2");
    assert.equal(wallet.body.walletSendCalls.atomicRequired, true);
  });

  it("can shape a whole route as one Multicall3From transaction", async () => {
    const built = await call("POST", "/v1/build/batch", { taker: OWNER, environment: "mainnet", batch: "single", actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "50" } }, { verb: "earn", token: "USDC", amount: { exact: "20" } }] });
    assert.equal(built.status, 200, JSON.stringify(built.body));
    assert.equal(built.body.transactions.length, 1);
    assert.equal(built.body.steps.length, 2);
  });

  it("fails closed: Fence deny, confirm, security block, invalid fees and expired quotes", async () => {
    const denied = await call("POST", "/v1/build/swap", { taker: OWNER, tokenIn: "USDC", tokenOut: "EURC", amount: "10", environment: "mainnet", fence: { ...DEFAULT_FENCE, kinds: { allow: ["transfer"] } } });
    assert.equal(denied.status, 422);
    assert.equal(denied.body.error.code, "FENCE_DENIED");
    const confirm = await call("POST", "/v1/build/bridge", { taker: OWNER, amount: "20", destination: "base", environment: "mainnet" });
    assert.equal(confirm.status, 409);
    assert.equal(confirm.body.error.code, "CONFIRMATION_REQUIRED");
    const cap = await call("POST", "/v1/aggregator/quote", { kind: "swap", taker: OWNER, tokenIn: "USDC", tokenOut: "EURC", amount: "10", integratorFee: { bps: 51, recipient: PAYEE } });
    assert.equal(cap.status, 400);
    arc.failCalls = true;
    try {
      const blocked = await call("POST", "/v1/build/deposit", { taker: OWNER, token: "USDC", amount: "10", environment: "mainnet" });
      assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
      assert.equal(blocked.body.error.code, "SECURITY_BLOCKED");
      assert.ok(blocked.body.error.details.security.findings.some((f: { rule: string }) => f.rule === "simulation.reverts"));
    } finally {
      arc.failCalls = false;
    }
    const unknown = await call("POST", "/v1/aggregator/build", { quoteId: "q_doesnotexist0000" });
    assert.equal(unknown.status, 404);
  });

  it("charges the integrator fee beside Lykia's fee", async () => {
    const quote = await call("POST", "/v1/aggregator/quote", { kind: "swap", taker: OWNER, tokenIn: "USDC", tokenOut: "EURC", amount: "100", integratorFee: { bps: 25, recipient: PAYEE } });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.fees.integrator.bps, 25);
    assert.equal(quote.body.fees.lines[0].integrator, "0.25");
  });

  it("maps every action kind to plan actions", () => {
    const taker = OWNER as `0x${string}`;
    assert.equal(actionsOf({ kind: "transfer", taker, token: "USDC", amount: "5", to: PAYEE as `0x${string}` })[0]!.verb, "send");
    assert.equal(actionsOf({ kind: "withdraw", taker, token: "USDC", amount: "all" })[0]!.verb, "withdraw");
    assert.deepEqual(actionsOf({ kind: "repay", taker, token: "USDC", amount: "all" })[0], { verb: "repay", token: "USDC", amount: { all: true } });
    assert.throws(() => actionsOf({ kind: "fx", taker, tokenIn: "USDC", tokenOut: "cirBTC", amount: "5" }), /fx converts/u);
  });

  /* -------------------------------------------------------------------- AI */

  it("routes a sentence without a model, with constraints that only tighten", async () => {
    const routed = await call("POST", "/v1/ai/route", { text: "swap 100 USDC to EURC", owner: OWNER, environment: "mainnet", constraints: { maxSteps: 2, venues: { deny: ["uniswap-v4"] } } });
    assert.equal(routed.status, 200, JSON.stringify(routed.body));
    assert.equal(routed.body.understood.source, "deterministic");
    assert.equal(routed.body.status, "routed");
    assert.ok(routed.body.explain.why.length > 10);
    assert.equal(routed.body.fence.maxSteps, 2);
    const unclear = await call("POST", "/v1/ai/route", { text: "convert 100", owner: OWNER });
    assert.equal(unclear.body.status, "clarify");
    assert.ok(constrainedFence({ ...DEFAULT_FENCE, venues: { allow: ["aave-v4"] } }, { venues: { allow: ["aave-v4", "uniswap-v3"] } }).venues?.allow?.length === 1);
  });

  it("reads any language through the model's tool call, and falls back when it is wrong", async () => {
    const scripted = (input: unknown) => ({ model: "test", turn: async () => ({ content: [{ type: "tool_use", id: "t1", name: "propose_actions", input }], stop_reason: "tool_use" }) }) as never;
    const ok = await understand(scripted({ actions: [{ verb: "swap", from: "USDC", to: "EURC", amount: { exact: "100" } }], language: "es" }), "cambia 100 USDC a EURC");
    assert.equal(ok.source, "llm");
    assert.equal(ok.language, "es");
    const bad = await understand(scripted({ actions: [{ verb: "teleport" }] }), "swap 5 USDC to EURC");
    assert.equal(bad.source, "deterministic");
    assert.equal(bad.actions[0]?.verb, "fx");
    const explained = await call("POST", "/v1/ai/explain-route", { route: { route: { steps: [{ summary: "Convert 99 USDC to EURC", reason: "best output" }] }, fees: { totalUsd: "1.00" } } });
    assert.equal(explained.body.source, "deterministic");
    assert.match(explained.body.text, /Convert 99 USDC/u);
  });

  /* ---------------------------------------------------------- integrations */

  it("takes an adapter manifest through submit -> validate -> approve -> routable, and routes through it", async () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../../../examples/adapter-manifest/manifest.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest, JSON.parse(JSON.stringify(EXAMPLE_MANIFEST)), "the example file and the served example agree");
    assert.equal((await call("POST", "/v1/integrations/adapters", { manifest })).status, 401);
    const dev = { "Lykia-Session": issueToken(ctx, OWNER).token };
    const admin = { "Lykia-Session": issueToken(ctx, ADMIN).token };
    const invalid = await call("POST", "/v1/integrations/adapters", { manifest: { ...manifest, protocol: { ...manifest.protocol, id: "aave-v4" } } }, dev);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "INVALID_MANIFEST");
    const submitted = await call("POST", "/v1/integrations/adapters", { manifest }, dev);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    assert.equal(submitted.body.status, "submitted");
    assert.equal((await call("GET", "/v1/integrations/adapters/example-usdc-vault")).status, 404, "hidden until approved");
    const validated = await call("POST", "/v1/integrations/adapters/example-usdc-vault/validate", { environment: "mainnet" }, dev);
    assert.equal(validated.status, 200, JSON.stringify(validated.body));
    assert.equal(validated.body.status, "validated", JSON.stringify(validated.body.validation));
    assert.ok(validated.body.validation.checks.some((c: { id: string; ok: boolean }) => c.id === "simulate:deposit-usdc" && c.ok));
    assert.equal((await call("POST", "/v1/integrations/adapters/example-usdc-vault/review", { decision: "approve" }, dev)).status, 403);
    assert.equal((await call("POST", "/v1/integrations/adapters/example-usdc-vault/review", { decision: "route" }, admin)).status, 409, "approve first");
    assert.equal((await call("POST", "/v1/integrations/adapters/example-usdc-vault/review", { decision: "approve" }, admin)).body.status, "approved");
    const routable = await call("POST", "/v1/integrations/adapters/example-usdc-vault/review", { decision: "route", note: "checked" }, admin);
    assert.equal(routable.body.status, "routable");
    const knowledge = await call("GET", "/v1/knowledge?environment=mainnet");
    assert.ok(knowledge.body.venues.some((v: { venue: string; executableHere: boolean }) => v.venue === "example-usdc-vault" && v.executableHere));
    const venue = await call("GET", "/v1/knowledge/venues/example-usdc-vault?environment=mainnet");
    assert.equal(venue.status, 200);
    assert.equal(venue.body.contracts[0].address.toLowerCase(), VAULT);
    const status = await call("GET", "/v1/integrations/adapters/example-usdc-vault/status");
    assert.deepEqual(status.body.history.map((h: { status: string }) => h.status), ["submitted", "validated", "approved", "routable"]);
    const listed = await call("GET", "/v1/integrations/adapters");
    assert.equal(listed.body.adapters.length, 1);
    // The router caches earn options for 15 s; a fresh token keeps this test independent of earlier quotes.
    const built = await call("POST", "/v1/build/deposit", { taker: OWNER, token: "EURC", amount: "10", environment: "mainnet", venue: "example-usdc-vault" });
    assert.ok(built.status === 200 || built.status === 422, JSON.stringify(built.body));
    const spec = await call("GET", "/v1/integrations/manifest");
    assert.equal(spec.body.schema, "lykia.adapter/v1");
    assert.deepEqual(validateAdapterManifest(spec.body.example), []);
  });

  /* ------------------------------------------------------------- contracts */

  it("encodes, decodes, reads and simulates any call", async () => {
    const encoded = await call("POST", "/v1/contracts/encode", { abi: ["function transfer(address to, uint256 amount) returns (bool)"], function: "transfer", args: [PAYEE, "2500000"] });
    assert.equal(encoded.status, 200);
    assert.equal(encoded.body.data, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [PAYEE, 2_500_000n] }));
    assert.equal(encoded.body.selector, "0xa9059cbb");
    assert.equal((await call("POST", "/v1/contracts/encode", { abi: ["function transfer(address to, uint256 amount)"], function: "transfer", args: [PAYEE, 1.5] })).status, 400);
    const decoded = await call("POST", "/v1/contracts/decode", { environment: "mainnet", to: USDC, data: encoded.body.data, logs: [{ address: USDC, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x000000000000000000000000${OWNER.slice(2)}`, `0x000000000000000000000000${PAYEE.slice(2)}`], data: encodeAbiParameters([{ type: "uint256" }], [2_500_000n]) }] });
    assert.equal(decoded.status, 200, JSON.stringify(decoded.body));
    assert.ok(decoded.body.lines.some((l: string) => l.includes("USDC")));
    assert.ok(decoded.body.lines.some((l: string) => l.startsWith("2.5 USDC moved")));
    const read = await call("POST", "/v1/contracts/read", { environment: "mainnet", calls: [{ address: USDC, abi: ["function balanceOf(address) view returns (uint256)"], function: "balanceOf", args: [OWNER] }] });
    assert.equal(read.body.results[0].result, "5000000000");
    const simulated = await call("POST", "/v1/contracts/simulate", { environment: "mainnet", from: OWNER, calls: [{ to: USDC, abi: ["function approve(address spender, uint256 amount) returns (bool)"], function: "approve", args: [PAYEE, (2n ** 256n - 1n).toString()] }] });
    assert.equal(simulated.status, 200, JSON.stringify(simulated.body));
    assert.equal(simulated.body.ok, true);
    assert.equal(simulated.body.security.decision, "block", "an unlimited approval is a block");
  });

  /* ------------------------------------------------------- data, security */

  it("serves tokens, prices, protocols, portfolios, screening and explanations", async () => {
    const tokens = await call("GET", "/v1/data/tokens?environment=mainnet");
    assert.equal(tokens.status, 200);
    assert.equal(tokens.body.tokens.find((t: { symbol: string }) => t.symbol === "USDC").priceUsd, "1");
    const prices = await call("GET", "/v1/data/prices?symbols=EURC,GBPA&environment=mainnet");
    assert.equal(prices.body.prices[0].usd, "1.115403");
    assert.equal(prices.body.prices[1].usd, null, "unpriced, never zero");
    assert.equal((await call("GET", "/v1/data/prices?symbols=NOPE")).status, 400);
    const protocols = await call("GET", "/v1/data/protocols?environment=mainnet");
    assert.equal(protocols.status, 200, JSON.stringify(protocols.body));
    assert.ok(protocols.body.protocols.some((p: { id: string }) => p.id === "aave-v4"));
    const portfolio = await call("GET", `/v1/data/portfolio/${OWNER}?environment=mainnet`);
    assert.equal(portfolio.status, 200, JSON.stringify(portfolio.body));
    assert.ok(portfolio.body.venues.some((v: { venue: string }) => v.venue === "wallet"));
    const screened = await call("GET", `/v1/security/screen/address/${PAYEE}?environment=mainnet`);
    assert.equal(screened.status, 200, JSON.stringify(screened.body));
    assert.ok(["pass", "warn", "block"].includes(screened.body.decision));
    const explained = await call("POST", "/v1/tx/explain", { environment: "mainnet", transaction: { from: OWNER, to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [PAYEE, 1_000_000n] }) } });
    assert.equal(explained.status, 200, JSON.stringify(explained.body));
    assert.match(explained.body.summary, /Transfer 1 USDC/u);
  });

  /* ------------------------------------------------------------------- MCP */

  it("registers the builder tools on the MCP server", () => {
    const names: string[] = [];
    registerBuilderTools({ registerTool: (name: string) => names.push(name) } as never, ctx);
    for (const n of ["lykia_aggregator_quote", "lykia_build", "lykia_ai_route", "lykia_contract_simulate", "lykia_data_prices", "lykia_portfolio", "lykia_screen_address", "lykia_tx_explain", "lykia_adapters"]) assert.ok(names.includes(n), n);
  });
});
