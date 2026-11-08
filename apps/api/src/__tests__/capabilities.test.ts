import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildCapabilityMap, capabilityVenueIds, CCTP_DESTINATIONS, readAssist, routableVenueIds, type CapabilityMap } from "@lykia/core";
import { createApp } from "../app.js";
import type { PulseFeed } from "../arc/pulse.js";
import { capabilityMap } from "../capabilities/map.js";
import { GATEWAY_CHAINS } from "../circle/chains.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { FakeArc, serve, testConfig, type Served } from "./support.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

describe("capability map: built from code", () => {
  for (const environment of ["mainnet", "testnet"] as const) {
    it(`lists every routable venue on ${environment}`, () => {
      const map = capabilityMap(environment);
      const listed = capabilityVenueIds(map);
      const missing = routableVenueIds(environment, EXECUTABLE_VENUES[environment]).filter((id) => !listed.has(id) && id !== "lykia-router" && id !== "arc-transfer");
      assert.deepEqual(missing, [], "every executable registry venue appears in an action or a bridge");
      // The send action routes through the direct transfer.
      assert.ok(map.actions.find((a) => a.id === "send")?.venues.some((v) => v.id === "arc-transfer"));
    });
  }

  it("follows the executable set: a venue added to it appears, one removed disappears", () => {
    const base = capabilityMap("mainnet");
    assert.ok(base.bridges.some((b) => b.id === "across"));
    const without = new Set([...EXECUTABLE_VENUES.mainnet].filter((v) => v !== "across"));
    const fewer: CapabilityMap = buildCapabilityMap({ environment: "mainnet", executable: without, gatewayChains: [] });
    assert.ok(!fewer.bridges.some((b) => b.id === "across"));
    const more: CapabilityMap = buildCapabilityMap({ environment: "mainnet", executable: EXECUTABLE_VENUES.mainnet, gatewayChains: [], manifests: [{ protocol: "new-dex", name: "New DEX", verbs: ["swap"] }] });
    assert.ok(more.actions.find((a) => a.id === "swap")?.venues.some((v) => v.id === "new-dex"), "a routable manifest joins its action");
  });

  it("lists bridge destinations from the CCTP and Gateway tables, EVM only for CCTP", () => {
    const map = capabilityMap("mainnet");
    const cctp = map.bridges.find((b) => b.id === "cctp")!;
    assert.deepEqual(cctp.destinations.map((d) => d.key), CCTP_DESTINATIONS.filter((d) => d.vm === "evm").map((d) => d.key));
    assert.ok(!cctp.destinations.some((d) => d.key === "solana"));
    assert.deepEqual(map.bridges.find((b) => b.id === "gateway")!.destinations.map((d) => d.key), GATEWAY_CHAINS.map((c) => c.key));
    assert.deepEqual(map.tokens.find((t) => t.symbol === "USDC")?.bridgeTo.length, cctp.destinations.length);
    // Testnet has no solver bridges.
    assert.ok(!capabilityMap("testnet").bridges.some((b) => b.id === "across" || b.id === "relay"));
  });

  it("never lists StableFX, USYC or x402 as a route", () => {
    for (const environment of ["mainnet", "testnet"] as const) {
      const ids = capabilityVenueIds(capabilityMap(environment));
      for (const id of ["stablefx", "circle-stablefx", "usyc", "x402"]) assert.ok(!ids.has(id), `${id} is not routable`);
      assert.doesNotMatch(JSON.stringify(capabilityMap(environment).actions), /StableFX|USYC/u);
    }
  });

  it("asks with options from the map instead of guessing a chain", () => {
    const map = capabilityMap("mainnet");
    const a = readAssist("Bridge 100 USDC", map);
    assert.equal(a?.kind, "clarify");
    assert.ok(a && a.kind === "clarify" && a.options.length === 4 && a.options[0] === "Bridge 100 USDC to Base");
    assert.equal(readAssist("Bridge 100 USDC to Arbitrum", map), null);
  });
});

describe("GET /v1/capabilities and Lyko's answers", () => {
  let ctx: AppContext;
  let served: Served;
  before(async () => {
    const arc = new FakeArc();
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: async () => new Response("offline", { status: 503 }) });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  it("serves the map per network", async () => {
    const r = await fetch(`${served.url}/v1/capabilities?environment=mainnet`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as CapabilityMap;
    assert.equal(body.schema, "lykia.capabilities/v1");
    assert.ok(body.actions.some((a) => a.id === "bridge"));
    assert.ok(body.features.some((f) => f.id === "leash" && f.href.startsWith("/app/")));
  });

  const chat = async (message: string) => {
    const r = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ message, environment: "mainnet" }) });
    return (await r.json()) as { reply: string; events: { event: string; data: Record<string, unknown> }[] };
  };

  it("answers where USDC can be bridged, with a card and chips", async () => {
    const body = await chat("Where can I bridge USDC to?");
    assert.match(body.reply, /USDC can go to \d+ chains/u);
    const block = body.events.find((e) => e.event === "block" && e.data.kind === "capabilities");
    assert.ok(block, "a capabilities card");
    const clarify = body.events.find((e) => e.event === "clarify");
    assert.ok((clarify?.data.options as string[]).includes("Bridge 100 USDC to Base"));
  });

  it("offers a Leash when a bot needs money, and asks how much", async () => {
    const body = await chat("My bot needs money to pay its API bills");
    assert.ok(body.events.some((e) => e.event === "block" && e.data.kind === "offer" && e.data.feature === "leash"));
    assert.ok(body.events.some((e) => e.event === "clarify" && (e.data.options as string[]).length >= 2));
  });

  it("asks which chain, never picks one", async () => {
    const body = await chat("Bridge 100 USDC");
    const clarify = body.events.find((e) => e.event === "clarify");
    assert.match(String(clarify?.data.question), /which chain/iu);
    assert.ok(!body.events.some((e) => e.event === "proposal"));
  });
});
