import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FENCE, effectiveFeeSchedule, evaluateFence, FENCE_TEMPLATES, feeBpsFor, FEE_SCHEDULE_KINDS, parseFeeSchedule, RECOMMENDED_B2B_FEE_SCHEDULE, type Fence } from "@lykia/core";
import { recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../app.js";
import type { PulseFeed } from "../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { ARC_MANDATE_ADAPTER } from "../circle/mandates.js";
import { applyCirclePolicy, compileFenceToCirclePolicy } from "../circle/policy.js";
import { circleProviders, registerCircleProviders } from "../circle/providers.js";
import { isCircleFacilitator, sellerProofEnvelope, sellerRequestTypedData } from "../circle/sellerProof.js";
import { arcEcosystemUrl } from "../ecosystem/ecosystem.js";
import { EXTRA_PROVIDERS } from "../engine/providers.js";
import { bpsForPlan, scheduleForPlan } from "../fees/schedule.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "./support.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const WALLET = "0x3333333333333333333333333333333333333333" as const;
const PAYEE = "0x2222222222222222222222222222222222222222" as const;
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

describe("Fence -> Circle policy compiler", () => {
  it("maps caps and recipient lists, and reports who enforces what", () => {
    const fence: Fence = { ...FENCE_TEMPLATES.caravan, recipients: { mode: "allowlist", allow: [PAYEE], deny: ["0x4444444444444444444444444444444444444444"] } };
    const c = compileFenceToCirclePolicy(fence, { wallet: WALLET, owner: OWNER });
    assert.equal(c.policy.policyType, "stablecoin");
    assert.equal(c.policy.chain, "ARC");
    assert.deepEqual(c.policy.limits, { perTx: "50", daily: "250", weekly: "1000", monthly: null });
    const allow = c.policy.rules.find((r) => r.ruleType === "recipient-allowlist")!;
    assert.deepEqual([...allow.targets].sort(), [OWNER, PAYEE].sort());
    assert.ok(c.policy.rules.some((r) => r.ruleType === "recipient-blocklist"));
    const by = (rule: string) => c.coverage.find((r) => r.rule === rule)?.enforcedBy;
    assert.equal(by("caps.perStepUsd"), "both");
    assert.equal(by("caps.perIntentUsd"), "lykia");
    assert.equal(by("limits.maxSlippageBps"), "lykia");
    assert.equal(by("scent.require"), "lykia");
    assert.equal(by("kinds.allow"), "lykia");
    assert.equal(by("circle.sanctions-screening"), "circle");
    assert.ok(c.commands[0]!.includes("--per-tx 50") && c.commands[0]!.includes(`--address ${WALLET}`));
    assert.ok(c.commands.at(-1)!.startsWith("circle wallet limit --address"));
    assert.equal(c.poweredBy, "Circle");
  });

  it("keeps Circle's monotonic tiers and never exceeds the beta cap", () => {
    const c = compileFenceToCirclePolicy({ ...DEFAULT_FENCE, caps: { perStepUsd: "9000", dailyUsd: "20000", weeklyUsd: "10000" } }, { betaCap: { perStepUsd: "1000", perDayUsd: "5000" } });
    assert.deepEqual(c.policy.limits, { perTx: "1000", daily: "5000", weekly: "10000", monthly: null });
    const d = compileFenceToCirclePolicy({ ...DEFAULT_FENCE, caps: { perStepUsd: "500", dailyUsd: "300" } });
    assert.equal(d.policy.limits.perTx, "300");
    assert.ok(d.warnings.some((w) => w.includes("lowered")));
  });

  it("own-only recipients compile to an owner allowlist; venues to contract lists", () => {
    const c = compileFenceToCirclePolicy({ ...DEFAULT_FENCE, venues: { allow: ["morpho-vaults"], deny: ["uniswap-v2"] } }, { owner: OWNER });
    assert.deepEqual(c.policy.rules.find((r) => r.ruleType === "recipient-allowlist")!.targets, [OWNER]);
    assert.ok(c.policy.rules.some((r) => r.ruleType === "contract-allowlist" && r.targets.length > 0));
    assert.equal(c.coverage.find((r) => r.rule === "venues.allow")!.enforcedBy, "both");
  });

  it("apply never applies: owner OTP for agent wallets, not yet available for developer wallets", () => {
    const c = compileFenceToCirclePolicy(DEFAULT_FENCE, { wallet: WALLET });
    const a = applyCirclePolicy(c, "agent-wallet");
    assert.equal(a.status, "requires-owner-otp");
    assert.equal(a.applied, false);
    const d = applyCirclePolicy(c, "developer-controlled");
    assert.equal(d.status, "not-yet-available");
    assert.deepEqual(d.commands, []);
  });
});

describe("fee schedule", () => {
  it("defaults to the base fee everywhere, so nothing changes until the owner sets it", () => {
    for (const kind of FEE_SCHEDULE_KINDS) assert.equal(feeBpsFor(kind, 100, null), 100);
    assert.equal(feeBpsFor("repay", 100, { swap: 50 }), 0);
    assert.equal(feeBpsFor("withdraw", 100, null), 0);
    assert.deepEqual(new Set(Object.values(effectiveFeeSchedule(100))), new Set([100]));
    assert.equal(testConfig().fee.schedule, null);
  });

  it("parses LYKIA_FEE_SCHEDULE and refuses bad input", () => {
    const ok = parseFeeSchedule('{"transfer":0,"swap":30}');
    assert.ok(ok.ok && ok.schedule.transfer === 0 && ok.schedule.swap === 30);
    assert.equal(parseFeeSchedule('{"repay":10}').ok, false);
    assert.equal(parseFeeSchedule('{"swap":301}').ok, false);
    assert.equal(parseFeeSchedule("nope").ok, false);
    assert.throws(() => testConfig({ LYKIA_FEE_SCHEDULE: '{"swap":-1}' }));
    const config = testConfig({ LYKIA_FEE_SCHEDULE: '{"transfer":0}', LYKIA_FEE_SCHEDULE_PLANS: '{"scale":{"swap":20}}' });
    assert.equal(bpsForPlan(config.fee, "transfer"), 0);
    assert.equal(bpsForPlan(config.fee, "swap"), 100);
    assert.equal(bpsForPlan(config.fee, "swap", "scale"), 20);
    assert.deepEqual(scheduleForPlan(config.fee, "scale"), { transfer: 0, swap: 20 });
    assert.equal(RECOMMENDED_B2B_FEE_SCHEDULE.transfer, 0);
  });
});

describe("Circle providers, mandates and seller proofs", () => {
  it("registers Circle providers with the aggregator, labelled Powered by Circle", () => {
    registerCircleProviders();
    for (const p of circleProviders) {
      assert.equal(p.poweredBy, "Circle");
      assert.ok(EXTRA_PROVIDERS.some((x) => x.id === p.id));
    }
    const ctx = { config: testConfig() } as unknown as AppContext;
    assert.equal(circleProviders.find((p) => p.id === "circle-app-kit")!.available(ctx), false);
    assert.equal(circleProviders.find((p) => p.id === "circle-wallets")!.available(ctx), false);
    assert.equal(circleProviders.find((p) => p.id === "circle-cctp")!.available(ctx), true);
  });

  it("drafts Arc mandates and execution proofs with status pending, leaving the verdict as is", () => {
    const mandate = ARC_MANDATE_ADAPTER.toMandate(FENCE_TEMPLATES.caravan, { principal: OWNER, agent: WALLET, environment: "mainnet" });
    assert.equal(mandate.status, "pending");
    assert.equal(mandate.limits.dailyUsd, "250");
    const verdict = evaluateFence(DEFAULT_FENCE, { environment: "mainnet", signer: "wallet", owner: OWNER, steps: [{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "10", tokens: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000000", listed: true, acquired: false }], recipient: OWNER }], now: 0 });
    const proof = ARC_MANDATE_ADAPTER.toExecutionProof(verdict);
    assert.equal(proof.verdict.digest, verdict.digest);
    assert.equal(proof.verdict.schema, "lykia.verdict/v1");
  });

  it("builds a seller proof that recovers to the payTo signer", async () => {
    const seller = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const typed = sellerRequestTypedData({ purpose: "settle", method: "post", body: "{}", network: "eip155:5042002", payTo: seller.address, nowSeconds: 1_000 });
    assert.equal(typed.message.method, "POST");
    assert.equal(typed.message.expiresAt, "1300");
    const signature = await seller.signTypedData({ domain: typed.domain, types: { SellerRequest: typed.types.SellerRequest }, primaryType: "SellerRequest", message: { ...typed.message, payTo: typed.message.payTo as Hex, issuedAt: 1000n, expiresAt: 1300n } });
    const envelope = JSON.parse(Buffer.from(sellerProofEnvelope(typed, signature), "base64url").toString()) as { version: number; payTo: string };
    assert.equal(envelope.version, 1);
    const signer = await recoverTypedDataAddress({ domain: typed.domain, types: { SellerRequest: typed.types.SellerRequest }, primaryType: "SellerRequest", message: { ...typed.message, payTo: typed.message.payTo as Hex, issuedAt: 1000n, expiresAt: 1300n }, signature });
    assert.equal(signer, seller.address);
    assert.equal(isCircleFacilitator("https://api.circle.com/v1/facilitator/x402"), true);
    assert.equal(isCircleFacilitator("https://x402.org/facilitator"), false);
  });

  it("links registry protocols to their official Arc ecosystem entries", () => {
    assert.equal(arcEcosystemUrl("morpho-vaults"), "https://www.arc.io/ecosystem/morpho");
    assert.equal(arcEcosystemUrl("synthra"), null);
  });
});

describe("Circle stack routes", () => {
  let ctx: AppContext;
  let served: Served;
  const arc = new FakeArc();
  before(async () => {
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch({}) });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });
  const post = (path: string, body: unknown) => fetch(`${served.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST /v1/circle/policies/compile", async () => {
    const r = await post("/v1/circle/policies/compile", { template: "caravan", wallet: WALLET, owner: OWNER });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { label: string; policy: { limits: { perTx: string } }; coverage: unknown[] };
    assert.equal(body.label, "Powered by Circle");
    assert.equal(body.policy.limits.perTx, "50");
    assert.ok(body.coverage.length > 5);
    const bad = await post("/v1/circle/policies/compile", { fence: { schema: "nope" } });
    assert.equal(bad.status, 400);
  });

  it("listing, health, providers, stats and mandate drafts answer", async () => {
    const listing = (await (await fetch(`${served.url}/v1/circle/marketplace/listing`)).json()) as { submit: { form: string }; fields: { healthUrl: string } };
    assert.match(listing.submit.form, /^https:\/\/forms\.gle\//u);
    assert.ok(listing.fields.healthUrl.endsWith("/v1/x402/health"));
    const health = await fetch(`${served.url}/v1/x402/health`);
    assert.ok(health.status === 200 || health.status === 503);
    const providers = (await (await fetch(`${served.url}/v1/circle/providers`)).json()) as { providers: { id: string; registered: boolean }[] };
    assert.ok(providers.providers.every((p) => p.registered));
    const stats = (await (await fetch(`${served.url}/v1/stats`)).json()) as { ecosystem: { protocols: number }; routed: { usd: string } };
    assert.ok(stats.ecosystem.protocols > 0);
    assert.equal(stats.routed.usd, "0.00");
    const draft = (await (await post("/v1/circle/mandates/draft", { template: "treasury", principal: OWNER })).json()) as { adapter: { status: string } };
    assert.equal(draft.adapter.status, "pending");
    const manifest = (await (await fetch(`${served.url}/.well-known/x402`)).json()) as { services: { metadata: { input: unknown; supportsVanillax402: boolean } }[]; health: string };
    assert.ok(manifest.services.every((s) => s.metadata.input && s.metadata.supportsVanillax402));
    assert.ok(manifest.health.endsWith("/v1/x402/health"));
  });
});
