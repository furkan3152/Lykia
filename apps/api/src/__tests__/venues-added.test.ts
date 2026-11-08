/**
 * The venues added on 2026-11-08: curators' Morpho vaults, Archery,
 * Unitflow V3, Sushi (RedSnwapper), Relay and the keyed 0x adapter. The
 * registry facts, the Fence and profile rules through `via`, route search
 * picking a new venue only when it nets more, the calldata checks on API
 * routes, and that every routable venue has a position reader.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FENCE, evaluateFence, getProtocol, isLive, POSITION_VENUES, registryCoverage, venueFamily, type Address, type FenceFacts } from "@lykia/core";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import { EXECUTABLE_VENUES, stepVenue } from "../engine/adapters.js";
import { RED_SNWAPPER_ABI, RELAY_DEPOSITORY_ABI } from "../engine/abis.js";
import { VenueRouter, type Candidate } from "../engine/router.js";
import { checkSnwap, quoteZeroX, sushiCall } from "../engine/venues/aggregators.js";
import { quoteRelay } from "../engine/venues/relay.js";
import { morphoVaults, vaultVenue } from "../flock/flock.js";
import { READERS } from "../positions/service.js";
import { FakeArc } from "./support.js";

const USDC = "0x3600000000000000000000000000000000000000" as Address;
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as Address;
const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const ADDED = ["galaxy-curation", "keyrock", "steakhouse-financial", "gauntlet", "bitwise", "archery", "unitflow-finance-v3", "sushiswap", "relay"];

describe("added venues: registry", () => {
  it("are live, executable and carry on-chain evidence with a simulation block", () => {
    for (const id of ADDED) {
      const p = getProtocol(id);
      assert.ok(p && isLive(p, "mainnet"), `${id} is live`);
      assert.ok(EXECUTABLE_VENUES.mainnet.has(id), `${id} is executable`);
      assert.match(p!.deployments.mainnet!.evidence, /block 30,13\d,\d{3}/u, `${id} names the simulation block`);
    }
  });

  it("counts routable venues from the registry and the executable set, never by hand", () => {
    const counts = registryCoverage("mainnet", EXECUTABLE_VENUES.mainnet);
    const live = [...EXECUTABLE_VENUES.mainnet].filter((id) => getProtocol(id)?.deployments.mainnet && isLive(getProtocol(id)!, "mainnet"));
    const curated = live.filter((id) => { const via = getProtocol(id)?.via; return via !== undefined && via !== id; });
    // Curators whose vaults are Morpho vaults are counted apart, never as extra protocols.
    assert.equal(counts.routable, live.length - curated.length);
    assert.equal(counts.routableVia, curated.length);
    assert.ok(counts.routable >= 13);
    assert.equal(counts.protocols, counts.routable + counts.routableVia + counts.readOnly + counts.mapped);
  });

  it("keeps 0x off until its key is set, and records why rejected entries do not route", () => {
    if (!process.env.ZEROX_API_KEY) assert.equal(EXECUTABLE_VENUES.mainnet.has("zerox"), false);
    for (const id of ["uniswap-v2", "synthra", "usyc-teller", "stablefx", "zerox", "extended-perps", "symbiosis", "beefy", "kpk"]) assert.ok((getProtocol(id)?.notes ?? []).length > 0, `${id} has notes`);
  });

  it("gives every routable venue a position reader (the Fold shows each one)", () => {
    for (const id of EXECUTABLE_VENUES.mainnet) {
      if (id === "lykia-router") continue; // holds nothing between transactions
      assert.ok(POSITION_VENUES.mainnet.some((v) => v.id === id), `${id} is a position venue`);
      assert.ok(READERS[id], `${id} has a reader`);
    }
  });

  it("files each Morpho vault under exactly one venue", () => {
    const vaults = morphoVaults("mainnet");
    const galaxy = vaults.find((v) => v.id === "galaxyUsdc")!;
    assert.equal(vaultVenue(galaxy), "galaxy-curation");
    assert.deepEqual(venueFamily("galaxy-curation"), ["galaxy-curation", "morpho-vaults"]);
    assert.equal(stepVenue("vault-deposit", { venue: "galaxy-curation" }), "galaxy-curation");
    // A params.venue that does not route through morpho-vaults never renames the step.
    assert.equal(stepVenue("vault-deposit", { venue: "aave-v4" }), "morpho-vaults");
    assert.equal(stepVenue("swap-archery", {}), "archery");
  });
});

describe("added venues: Fence and profile rules through via", () => {
  const facts = (venue: string): FenceFacts => ({ environment: "mainnet", signer: "wallet", owner: OWNER, now: Date.UTC(2026, 10, 8), spent: { dayUsd: "0", weekUsd: "0" }, steps: [{ id: "s1", kind: "deposit", venue, usd: "100", tokens: [] }] });

  it("a deny on morpho-vaults also denies a curator's vault, and an allow on it admits one", () => {
    assert.equal(evaluateFence({ ...DEFAULT_FENCE, venues: { deny: ["morpho-vaults"] } }, facts("gauntlet")).decision, "deny");
    assert.equal(evaluateFence({ ...DEFAULT_FENCE, venues: { deny: ["gauntlet"] } }, facts("gauntlet")).decision, "deny");
    assert.notEqual(evaluateFence({ ...DEFAULT_FENCE, venues: { allow: ["morpho-vaults"] } }, facts("gauntlet")).decision, "deny");
    assert.equal(evaluateFence({ ...DEFAULT_FENCE, venues: { allow: ["aave-v4"] } }, facts("gauntlet")).decision, "deny");
  });

  it("a blocked morpho-vaults in the profile drops curator options from earn", () => {
    const opt = (venue: string, apy: number) => ({ option: { venue, label: venue, apy: String(apy), risk: "low", executable: true, notes: [] }, adapter: "vault-deposit", params: {} }) as unknown as Candidate;
    const router = new VenueRouter({ chains: new FakeArc().asChains(), prices: {} as never, yields: {} as never });
    const pool = [opt("galaxy-curation", 6.1), opt("aave-v4", 5.8)];
    assert.equal(router.chooseEarn(pool, "high")?.candidate.option.venue, "galaxy-curation");
    assert.equal(router.chooseEarn(pool, "high", undefined, { blocked: ["morpho-vaults"] })?.candidate.option.venue, "aave-v4");
    // "morpho-vaults:galaxy" still names Galaxy's vault.
    assert.equal(router.chooseEarn(pool, "high", "morpho-vaults")?.candidate.option.venue, "galaxy-curation");
  });
});

describe("added venues: route search", () => {
  /** Uniswap v3 (fee 500) quotes 0.890; Archery (tick spacing 1) `archeryRate`; Unitflow (fee 100) 0.86. */
  function chains(archeryRate: bigint) {
    const archeryPool = "0xb88C08E31C1bC7d41f2cFc4FbAfAD5B3B0a5eAe9";
    const unitflowPool = "0x99a0505D58cC5d7bf3513Cc75F2A605A23F0F79F";
    const client = {
      readContract: async (call: { address: string; functionName: string; args?: readonly unknown[] }) => {
        if (call.functionName === "getPool" && call.address.toLowerCase() === "0xc481038c013fe96f38ce7a2dc417b2b1b78b16a4") return call.args?.[2] === 1 ? archeryPool : "0x0000000000000000000000000000000000000000";
        if (call.functionName === "getPool") return call.args?.[2] === 100 ? unitflowPool : "0x0000000000000000000000000000000000000000";
        throw new Error("no read");
      },
      simulateContract: async (call: { address: string; args: readonly unknown[] }) => {
        const quoter = call.address.toLowerCase();
        const first = call.args[0] as { amountIn?: bigint; fee?: number; tickSpacing?: number };
        if (quoter === "0xc6b5c6056c4be2de1c014695a7ccb75087a1c574") return { result: [(first.amountIn! * archeryRate) / 1000n, 0n, 0, 120_000n] };
        if (quoter === "0x5af6e89f0960ff375af84d9911d8153ef6240e34") return { result: ((call.args[3] as bigint) * 860n) / 1000n };
        if (first.fee === 500) return { result: [(first.amountIn! * 890n) / 1000n, 0n, 0, 120_000n] };
        throw new Error("no pool");
      },
      call: async () => {
        throw new Error("no override");
      },
      multicall: async () => [],
    };
    return { client: () => client } as never;
  }
  const prices = { price: async (symbol: string) => ({ symbol, usd: symbol === "EURC" ? "1.115" : "1", source: "test", updatedAt: null }) } as never;

  it("swaps through Archery when it nets more, and never through the thinner Unitflow pool", async () => {
    const router = new VenueRouter({ chains: chains(897n), prices, yields: {} as never });
    const best = await router.bestSwap("mainnet", "USDC", "EURC", 1000_000000n, { noSplit: true });
    assert.equal(best?.legs[0]?.candidate.option.venue, "archery");
    assert.equal(best?.legs[0]?.candidate.adapter, "swap-archery");
    assert.equal(best?.legs[0]?.candidate.params.tickSpacing, "1");
    const venues = [best!.route.chosen, ...best!.route.alternatives].map((o) => o.venue);
    assert.ok(venues.includes("unitflow-finance-v3") && venues.includes("uniswap-v3"), venues.join(","));
  });

  it("keeps Uniswap when Archery quotes less", async () => {
    const router = new VenueRouter({ chains: chains(880n), prices, yields: {} as never });
    const best = await router.bestSwap("mainnet", "USDC", "EURC", 1000_000000n, { noSplit: true });
    assert.equal(best?.legs[0]?.candidate.option.venue, "uniswap-v3");
  });
});

describe("added venues: API calldata is checked, never trusted", () => {
  const SNWAPPER = "0xE52abd50ad151ecDf56427effD715E703696a6B1" as Address;
  const executor = "0x7906320f8247e36dd9b7b005c8dc740ed4ecc29d" as Address;
  const snwap = (recipient: Address, amountIn: bigint) => encodeFunctionData({ abi: RED_SNWAPPER_ABI, functionName: "snwap", args: [USDC, amountIn, recipient, EURC, 1n, executor, "0xabcd"] });
  const sushiFetch = (to: string, data: Hex) => async () => new Response(JSON.stringify({ status: "Success", assumedAmountOut: "896000000", gasSpent: 30000, tx: { to, data, value: 0 } }), { status: 200 });

  it("re-encodes Sushi's snwap with Lykia's minimum, and refuses another recipient, amount or contract", async () => {
    const ok = await sushiCall(sushiFetch(SNWAPPER, snwap(OWNER, 1000n)) as never, "mainnet", USDC, EURC, 1000n, OWNER, 891_000_000n, "x");
    assert.ok(ok);
    const decoded = decodeFunctionData({ abi: RED_SNWAPPER_ABI, data: ok!.call.data });
    assert.equal(decoded.args[4], 891_000_000n);
    assert.equal(await sushiCall(sushiFetch(SNWAPPER, snwap("0x00000000000000000000000000000000000000bb", 1000n)) as never, "mainnet", USDC, EURC, 1000n, OWNER, 1n, "x"), null);
    assert.equal(await sushiCall(sushiFetch(SNWAPPER, snwap(OWNER, 999n)) as never, "mainnet", USDC, EURC, 1000n, OWNER, 1n, "x"), null);
    assert.equal(await sushiCall(sushiFetch("0x0000000000000000000000000000000000000001", snwap(OWNER, 1000n)) as never, "mainnet", USDC, EURC, 1000n, OWNER, 1n, "x"), null);
    assert.equal(checkSnwap("0x12345678", { tokenIn: USDC, tokenOut: EURC, amountIn: 1n, recipient: OWNER }), null);
  });

  it("asks nothing of 0x without a key", async () => {
    let called = false;
    const fetchSpy = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };
    assert.equal(await quoteZeroX(fetchSpy as never, null, "mainnet", USDC, EURC, 1000n), null);
    assert.equal(called, false);
  });

  it("accepts a Relay quote only for the registry depository, the account, the amount and USDC on the asked chain", async () => {
    const depository = "0x4cD00E387622C35bDDB9b4c962C136462338BC31";
    const baseUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const relayFetch = (over: { to?: string; depositor?: Address; amount?: bigint; recipient?: string }) => async (url: string) => {
      if (url.endsWith("/chains")) return new Response(JSON.stringify({ chains: [{ id: 8453, erc20Currencies: [{ id: "usdc", symbol: "USDC", address: baseUsdc, supportsBridging: true }] }] }), { status: 200 });
      const data = encodeFunctionData({ abi: RELAY_DEPOSITORY_ABI, functionName: "depositErc20", args: [over.depositor ?? OWNER, USDC, over.amount ?? 100_000000n, `0x${"11".repeat(32)}`] });
      return new Response(JSON.stringify({ requestId: `0x${"22".repeat(32)}`, steps: [{ id: "deposit", items: [{ data: { to: over.to ?? depository, data, value: "0", chainId: 5042 } }] }], fees: { relayer: { amount: "71211", currency: { chainId: 5042, address: USDC } } }, details: { recipient: over.recipient ?? OWNER, currencyOut: { amount: "99928789", currency: { chainId: 8453, address: baseUsdc } }, timeEstimate: 2 } }), { status: 200 });
    };
    const input = { user: OWNER, recipient: OWNER, usdc: USDC, amount: 100_000000n, destinationChainId: 8453 };
    const good = await quoteRelay(relayFetch({}) as never, "mainnet", input);
    assert.equal(good?.amountOut, 99_928_789n);
    assert.equal(good?.feeUnits, 71_211n);
    assert.equal(await quoteRelay(relayFetch({ to: "0x0000000000000000000000000000000000000001" }) as never, "mainnet", input), null);
    assert.equal(await quoteRelay(relayFetch({ depositor: "0x00000000000000000000000000000000000000bb" }) as never, "mainnet", input), null);
    assert.equal(await quoteRelay(relayFetch({ amount: 99_000000n }) as never, "mainnet", input), null);
    assert.equal(await quoteRelay(relayFetch({ recipient: "0x00000000000000000000000000000000000000bb" }) as never, "mainnet", input), null);
    assert.equal(await quoteRelay(relayFetch({}) as never, "testnet", input), null);
  });
});
