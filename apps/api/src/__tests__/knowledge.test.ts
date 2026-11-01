import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FENCE, KNOWLEDGE_ROWS, tokenRoutes, validateKnowledge, venueKnowledge, type Fence, type PlanAction, type RiskTier } from "@lykia/core";
import { erc20Abi, parseAbiItem, toFunctionSelector, type Abi } from "viem";
import * as ABIS from "../engine/abis.js";
import { ADAPTER_VENUE, EXECUTABLE_VENUES, type AdapterId } from "../engine/adapters.js";
import { compileGoals } from "../engine/api.js";
import type { Planner, PlanResult } from "../engine/planner.js";
import type { VenueRouter } from "../engine/router.js";
import { externalInputs, RouteSearch, scoreGraph, staticPrune } from "../engine/search.js";
import { revertReason, type RouteSimulation } from "../engine/simulate.js";
import { ERC4626_ABI } from "../flock/flock.js";
import { METAROUTER_ABI } from "../engine/venues/aerodrome.js";
import { lykiaContracts } from "@lykia/core";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as const;
const PAYEE = "0x1111111111111111111111111111111111111111" as const;

/* ------------------------------------------------------------ knowledge */

describe("knowledge model", () => {
  it("describes every executable venue, with evidence, and validates clean", () => {
    assert.deepEqual(validateKnowledge(KNOWLEDGE_ROWS, { executableVenues: EXECUTABLE_VENUES.mainnet }), []);
    for (const row of KNOWLEDGE_ROWS.filter((r) => r.executable)) {
      assert.ok(row.capabilities.length > 0, `${row.venue} has capabilities`);
      assert.ok(row.risk.oracle && row.risk.admin && row.risk.tvlSource, `${row.venue} has risk facts`);
      for (const f of row.functions) assert.ok(f.evidence.length > 0 && f.purpose.length > 0, `${f.id} has evidence and purpose`);
    }
  });

  it("covers every mainnet engine adapter with a function and a capability", () => {
    // "manifest" encodes routable adapter manifests; their knowledge rows come from the manifests themselves.
    const adapters = Object.keys(ADAPTER_VENUE).filter((a) => !a.startsWith("practice-") && a !== "manifest") as AdapterId[];
    for (const adapter of adapters) {
      const row = venueKnowledge(ADAPTER_VENUE[adapter]);
      assert.ok(row, `${adapter}: venue ${ADAPTER_VENUE[adapter]} has a knowledge row`);
      assert.ok(row.functions.some((f) => f.adapters.includes(adapter)), `${adapter}: a function encodes it`);
    }
  });

  it("every function fragment is a call the engine actually encodes (selector match)", () => {
    const engine: Abi[] = [...(Object.values(ABIS) as unknown[]).filter((v): v is Abi => Array.isArray(v)), erc20Abi, ERC4626_ABI, METAROUTER_ABI, lykiaContracts.lykiaRouterArtifact.abi as Abi];
    const selectors = new Set(engine.flatMap((abi) => abi.filter((i) => i.type === "function").map((i) => toFunctionSelector(i as never))));
    for (const row of KNOWLEDGE_ROWS) {
      for (const f of [...row.functions, ...row.reads]) {
        if (["erc8004.register", "erc8004.validationRequest", "cctp.receiveMessage", "morpho-blue.withdrawCollateral", "erc8004.tokenURI", "arc-transfer.balanceOf"].includes(f.id)) continue;
        const sel = toFunctionSelector(parseAbiItem(f.abi) as never);
        assert.ok(selectors.has(sel), `${f.id} (${f.abi}) matches an engine ABI`);
      }
    }
  });

  it("builds multi-hop token routes from the capability graph", () => {
    assert.deepEqual(tokenRoutes(KNOWLEDGE_ROWS, "cirBTC", "EURC", 2), [["cirBTC", "USDC", "EURC"]]);
    assert.ok(tokenRoutes(KNOWLEDGE_ROWS, "WETH", "EURC", 3).some((r) => r.join(">") === "WETH>USDC>EURC"));
    assert.deepEqual(tokenRoutes(KNOWLEDGE_ROWS, "GBPA", "USDC", 3), []);
  });

  it("refuses rows that are not fully described", () => {
    const broken = [{ ...KNOWLEDGE_ROWS[0]!, evidence: "", capabilities: [{ ...KNOWLEDGE_ROWS[0]!.capabilities[0]!, adapter: "nope" }] }];
    const issues = validateKnowledge(broken, { executableVenues: new Set(["arc-transfer", "aave-v4"]) }).map((i) => i.message);
    assert.ok(issues.includes("Venue needs evidence."));
    assert.ok(issues.some((m) => m.includes("adapter nope")));
    assert.ok(issues.some((m) => m.includes("no knowledge entry")));
  });
});

/* ------------------------------------------------------------- language */

describe("goal sentences for the route search", () => {
  it("reads health floors in later clauses, medium risk, and 'it' as the previous output", () => {
    assert.deepEqual(compileGoals("earn the best yield on 1000 USDC with medium risk").actions, [{ verb: "earn", token: "USDC", amount: { exact: "1000" }, maxRisk: "medium" }]);
    assert.deepEqual(compileGoals("borrow 1000 USDC on my cirBTC and put it to work with health ≥ 1.8").actions, [
      { verb: "borrow", token: "USDC", amount: { exact: "1000" }, collateral: { token: "cirBTC" }, minHealth: "1.8" },
      { verb: "earn", token: "USDC", amount: { previous: true } },
    ]);
    assert.deepEqual(compileGoals(`convert 500 USDC to EURC and pay ${PAYEE} 200 EURC for invoice 7`).actions, [
      { verb: "fx", from: "USDC", to: "EURC", amount: { exact: "500" } },
      { verb: "send", token: "EURC", amount: { exact: "200" }, to: PAYEE, memo: "invoice 7" },
    ]);
    assert.deepEqual(compileGoals(`send 25 GBPA to ${PAYEE}`).actions, [{ verb: "send", token: "GBPA", amount: { exact: "25" }, to: PAYEE }]);
  });
});

/* --------------------------------------------------------------- search */

type Opt = { venue: string; label: string; apy: string; risk: RiskTier; vault?: string };

function stubRouter(rates: Record<string, Opt[]>): VenueRouter {
  return {
    earn: async (_env: string, symbol: string) =>
      (rates[symbol] ?? []).map((o) => ({ option: { venue: o.venue, label: o.label, apy: o.apy, risk: o.risk, executable: true, notes: [] }, adapter: o.vault ? "vault-deposit" : "aave-supply", params: o.vault ? { vault: o.vault } : {} })),
  } as unknown as VenueRouter;
}

/** A planner that turns actions into a graph with fixed prices: USDC 1, EURC 1.1; fee 1%; earns at the pinned venue's APY. */
function stubPlanner(rates: Record<string, Opt[]>, options: { deny?: (actions: readonly PlanAction[]) => string | null } = {}): Planner {
  const price: Record<string, number> = { USDC: 1, EURC: 1.1 };
  return {
    plan: async (input: { id: string; actions: readonly PlanAction[] }) => {
      const steps: unknown[] = [];
      const plans: Record<string, unknown> = {};
      let last = 0;
      input.actions.forEach((a, i) => {
        const id = `s${i + 1}`;
        if (a.verb === "fx" || a.verb === "swap") {
          const amount = "exact" in a.amount ? Number(a.amount.exact) : last;
          const net = amount * 0.99;
          const out = (net * price[a.from]!) / price[a.to]! * 0.999; // 10 bps price impact
          last = out;
          steps.push({ id, kind: a.verb === "fx" ? "fx" : "swap", venue: "uniswap-v3", summary: `Convert ${amount} ${a.from} to ${a.to}`, inputs: [{ symbol: a.from, amount: String(Math.round(amount * 1e6)), usd: String(amount * price[a.from]!) }], outputs: [{ symbol: a.to, amount: String(Math.round(out * 1e6)), usd: (out * price[a.to]!).toFixed(6) }], fee: { usd: String(amount * 0.01 * price[a.from]!) }, settlement: { kind: "receipt" } });
          plans[id] = { adapter: "swap", params: {} };
        } else if (a.verb === "earn") {
          const amount = "exact" in a.amount ? Number(a.amount.exact) : last;
          const venue = a.venue?.split(":")[0] ?? rates[a.token]?.[0]?.venue ?? "aave-v4";
          const opt = (rates[a.token] ?? []).find((o) => (a.venue ? a.venue === o.venue || a.venue === `morpho-vaults:${o.vault}` : true))!;
          const net = amount * 0.99;
          steps.push({ id, kind: "deposit", venue, summary: `Deposit ${net} ${a.token} into ${opt.label}`, inputs: [{ symbol: a.token, amount: String(Math.round(amount * 1e6)), usd: String(amount * price[a.token]!) }], outputs: [{ symbol: `${a.token}@${venue}`, amount: String(Math.round(net * 1e6)), usd: (net * price[a.token]!).toFixed(6) }], fee: { usd: String(amount * 0.01 * price[a.token]!) }, route: { chosen: { venue, label: opt.label, apy: opt.apy, risk: opt.risk, executable: true, notes: [] }, alternatives: [], reason: `${opt.label} at ${opt.apy}` }, settlement: { kind: "receipt" } });
          plans[id] = { adapter: venue === "aave-v4" ? "aave-supply" : "vault-deposit", params: {} };
        } else if (a.verb === "send") {
          const amount = "exact" in a.amount ? Number(a.amount.exact) : last;
          steps.push({ id, kind: "transfer", venue: "arc-transfer", summary: `Send ${amount} ${a.token}`, inputs: [{ symbol: a.token, amount: String(Math.round(amount * 1e6)), usd: String(amount * price[a.token]!) }], outputs: [], settlement: { kind: "receipt" } });
          plans[id] = { adapter: "transfer", params: {} };
        }
      });
      const denied = options.deny?.(input.actions) ?? null;
      return { graph: { id: input.id, steps, warnings: [], verdict: { decision: denied ? "deny" : "allow", signable: !denied, digest: "sha256:00", reasons: denied ? [{ decision: "deny", message: denied, rule: "test" }] : [] } }, plans, facts: {}, fence: DEFAULT_FENCE } as unknown as PlanResult;
    },
  } as unknown as Planner;
}

const ok: RouteSimulation = { ok: true, mode: "batch", calls: [], funded: [], block: "1" };

function search(rates: Record<string, Opt[]>, extra: { simulate?: (label: string) => RouteSimulation; deny?: (a: readonly PlanAction[]) => string | null } = {}) {
  let calls = 0;
  const s = new RouteSearch({
    planner: stubPlanner(rates, extra.deny ? { deny: extra.deny } : {}),
    router: stubRouter(rates),
    chains: null as never,
    now: () => 1_000_000,
    simulate: async (_c, _e, _a, input) => {
      calls += 1;
      return extra.simulate ? extra.simulate(input.steps.map((st) => st.plan.adapter).join("+")) : ok;
    },
  });
  return { s, calls: () => calls };
}

const USDC_RATES: Opt[] = [
  { venue: "aave-v4", label: "Aave V4 Main Spoke USDC", apy: "0.03", risk: "low" },
  { venue: "morpho-vaults", label: "Morpho Galaxy USDC", apy: "0.025", risk: "low", vault: "0x8E357432CC12ff425c36432F312968aEb16112AF" },
  { venue: "morpho-vaults", label: "Morpho Degen USDC", apy: "0.20", risk: "high", vault: "0x10AF7238C6355Aa8dDB5eD60E2e9b55a72827B51" },
];

describe("route search", () => {
  const earn: PlanAction[] = [{ verb: "earn", token: "USDC", amount: { exact: "10000" } }];

  it("finds a known-better composite route (convert then earn) and explains it", async () => {
    const rates = { USDC: USDC_RATES, EURC: [{ venue: "morpho-vaults", label: "Morpho Prime EURC", apy: "0.09", risk: "low" as const, vault: "0x05863F54B05e96092069eF30c9Ca6060336e50B9" }] };
    const { s } = search(rates);
    const r = await s.search({ environment: "mainnet", owner: OWNER, actions: earn, horizonDays: 365, spent: { dayUsd: "0", weekUsd: "0" } });
    assert.equal(r.best?.strategy, "convert-then-earn");
    assert.deepEqual(r.best?.actions.map((a) => a.verb), ["fx", "earn"]);
    assert.deepEqual((r.best?.actions[1] as { amount: unknown }).amount, { previous: true });
    assert.match(r.best!.explanation.why, /Beats/u);
    assert.equal(r.best?.simulation?.ok, true);
    assert.ok(r.alternatives.some((a) => a.strategy === "as-asked"));
  });

  it("prunes conversions that cannot win and venues above the appetite", async () => {
    const rates = { USDC: USDC_RATES, EURC: [{ venue: "morpho-vaults", label: "Morpho Prime EURC", apy: "0.01", risk: "low" as const, vault: "0x05863F54B05e96092069eF30c9Ca6060336e50B9" }] };
    const { s } = search(rates);
    const r = await s.search({ environment: "mainnet", owner: OWNER, actions: earn, appetite: "low", spent: { dayUsd: "0", weekUsd: "0" } });
    assert.ok(r.pruned.some((p) => p.label.startsWith("Convert USDC to EURC") && /cannot win/u.test(p.reason)));
    assert.ok(r.pruned.some((p) => p.label.includes("Degen") && /appetite/u.test(p.reason)));
    assert.equal(r.best?.steps[0]?.venue, "aave-v4");
  });

  it("drops routes the Fence denies, statically and from the verdict", async () => {
    const noSwaps: Fence = { ...DEFAULT_FENCE, kinds: { allow: ["deposit", "transfer"] } };
    assert.match(staticPrune({ label: "x", strategy: "multi-hop", actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "1" } }] }, noSwaps, "mainnet") ?? "", /does not allow fx/u);
    assert.match(staticPrune({ label: "x", strategy: "venue", actions: [{ verb: "earn", token: "USDC", amount: { exact: "1" }, venue: "aave-v4" }] }, { ...DEFAULT_FENCE, venues: { deny: ["aave-v4"] } }, "mainnet") ?? "", /denies aave-v4/u);
    assert.match(staticPrune({ label: "x", strategy: "venue", actions: [{ verb: "earn", token: "USDC", amount: { exact: "1" }, venue: "aave-v4" }] }, DEFAULT_FENCE, "testnet") ?? "", /cannot execute/u);
    const rates = { USDC: USDC_RATES, EURC: [{ venue: "morpho-vaults", label: "Morpho Prime EURC", apy: "0.09", risk: "low" as const, vault: "0x05863F54B05e96092069eF30c9Ca6060336e50B9" }] };
    const { s } = search(rates, { deny: (a) => (a.some((x) => x.verb === "fx") ? "Beta cap: $100 per step." : null) });
    const r = await s.search({ environment: "mainnet", owner: OWNER, actions: earn, fence: noSwaps, spent: { dayUsd: "0", weekUsd: "0" } });
    assert.notEqual(r.best?.strategy, "convert-then-earn");
    assert.ok(r.pruned.some((p) => /does not allow fx/u.test(p.reason)));
  });

  it("falls back to the next route when the self-check fails", async () => {
    const rates = { USDC: USDC_RATES, EURC: [] };
    const { s, calls } = search(rates, { simulate: (adapters) => (adapters === "aave-supply" ? { ...ok, ok: false, failedStep: "s1", reason: "Supply to Aave: custom error 0x1234" } : ok) });
    const r = await s.search({ environment: "mainnet", owner: OWNER, actions: earn, spent: { dayUsd: "0", weekUsd: "0" } });
    assert.equal(calls(), 2);
    assert.equal(r.failedChecks.length, 1);
    assert.match(r.failedChecks[0]!.reason, /custom error/u);
    assert.equal(r.best?.steps[0]?.venue, "morpho-vaults");
  });

  it("is deterministic for the same quotes", async () => {
    const rates = { USDC: USDC_RATES, EURC: [] };
    const a = await search(rates).s.search({ environment: "mainnet", owner: OWNER, actions: earn, spent: { dayUsd: "0", weekUsd: "0" } });
    const b = await search(rates).s.search({ environment: "mainnet", owner: OWNER, actions: earn, spent: { dayUsd: "0", weekUsd: "0" } });
    assert.deepEqual([a.best?.label, ...a.alternatives.map((x) => x.label)], [b.best?.label, ...b.alternatives.map((x) => x.label)]);
  });
});

describe("route objective", () => {
  const result = (apy: string, risk: RiskTier) =>
    ({
      graph: {
        steps: [{ id: "s1", kind: "deposit", venue: "aave-v4", inputs: [{ symbol: "USDC", amount: "1000000000", usd: "1000" }], outputs: [{ symbol: "USDC@aave-v4", amount: "990000000", usd: "990" }], fee: { usd: "10" }, route: { chosen: { venue: "aave-v4", label: "x", apy, risk, executable: true, notes: [] }, alternatives: [], reason: "" }, settlement: { kind: "receipt" } }],
      },
      plans: { s1: { adapter: "aave-supply", params: {} } },
    }) as unknown as PlanResult;

  it("scores yield minus fee, gas and risk over the horizon", () => {
    const s = scoreGraph(result("0.10", "low"), { horizonDays: 365, appetite: "medium", gasPrice: 20_000_000_000n });
    assert.equal(s.yieldUsd, "99.00");
    assert.equal(s.feeUsd, "10.00");
    assert.equal(s.riskUsd, "0.00");
    assert.equal(s.unpriced, false);
    const risky = scoreGraph(result("0.10", "high"), { horizonDays: 365, appetite: "low", gasPrice: 20_000_000_000n });
    assert.equal(risky.riskUsd, "59.40"); // 200 bps × 3 (low appetite) on $990
    assert.ok(Number(risky.totalUsd) < Number(s.totalUsd));
  });

  it("reports unpriced routes instead of scoring them as zero", () => {
    const r = result("0.05", "low");
    (r.graph.steps[0]!.outputs[0] as { usd: string | null }).usd = null;
    assert.equal(scoreGraph(r, { horizonDays: 30, appetite: "medium", gasPrice: 1n }).totalUsd, null);
  });
});

describe("self-check helpers", () => {
  it("decodes revert reasons", () => {
    assert.equal(revertReason("0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000013546f6f206c6974746c6520726563656976656400000000000000000000000000"), "Too little received");
    assert.equal(revertReason("0x"), "reverted without a reason");
    assert.match(revertReason("0xdeadbeef"), /custom error 0xdeadbeef/u);
  });

  it("funds only what no earlier step produces", () => {
    const steps = [
      { inputs: [{ symbol: "USDC", amount: "500" }], outputs: [{ symbol: "EURC", amount: "440", minimum: "438" }] },
      { inputs: [{ symbol: "EURC", amount: "200" }], outputs: [] },
      { inputs: [{ symbol: "EURC", amount: "300" }], outputs: [] },
    ] as never;
    assert.deepEqual(externalInputs(steps), [{ symbol: "USDC", units: 500n }, { symbol: "EURC", units: 62n }]);
  });
});
