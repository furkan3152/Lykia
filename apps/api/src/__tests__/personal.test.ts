import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { IntentGraph } from "@lykia/core";
import { createApp } from "../app.js";
import type { PulseFeed } from "../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { issueToken } from "../platform/session.js";
import { VenueRouter, type Candidate } from "../engine/router.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "./support.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as const;
const AHMET = "0x1111111111111111111111111111111111111111";
const USDC = "0x3600000000000000000000000000000000000000";
const GALAXY = "0x8E357432CC12ff425c36432F312968aEb16112AF";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

describe("profile, memory and contacts", () => {
  let ctx: AppContext;
  let served: Served;
  let token: string;
  const arc = new FakeArc();

  before(async () => {
    arc.setBalance(USDC, OWNER, 1_000_000_000n);
    arc.vaultAssets.set(GALAXY.toLowerCase(), 80_000_000_000_000n);
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
    token = issueToken(ctx, OWNER).token;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = async (method: string, path: string, body?: unknown, auth = true) => {
    const response = await fetch(`${served.url}${path}`, { method, headers: { "content-type": "application/json", ...(auth ? { "Lykia-Session": token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it("needs a session and validates the profile", async () => {
    assert.equal((await call("GET", "/v1/profile", undefined, false)).status, 401);
    const fresh = await call("GET", "/v1/profile");
    assert.equal((fresh.body.profile as { risk: string }).risk, "medium");
    const bad = await call("PUT", "/v1/profile", { risk: "yolo" });
    assert.equal(bad.status, 400);
    const ok = await call("PUT", "/v1/profile", { risk: "low", language: "tr", persona: { tone: "playful" }, look: { collar: "#1E8FA3" }, venues: { favorites: [], blocked: ["synthra"] } });
    assert.equal(ok.status, 200);
    const profile = ok.body.profile as { risk: string; version: number; persona: { tone: string; verbosity: string }; look: { coat: string } };
    assert.equal(profile.persona.verbosity, "normal");
    assert.equal(profile.look.coat, "cream");
    assert.ok((ok.body.effects as string[]).some((e) => e.includes("30 bps")));
    assert.ok((ok.body.effects as string[]).some((e) => e.includes("synthra")));
  });

  it("resolves contacts by name and flags unconfirmed ones", async () => {
    const added = await call("POST", "/v1/contacts", { name: "Ahmet", address: AHMET });
    assert.equal(added.status, 201);
    const dup = await call("POST", "/v1/contacts", { name: "ahmet", address: "0x2222222222222222222222222222222222222222" });
    assert.equal(dup.status, 400);
    const parsed = await call("POST", "/v1/language/parse", { text: "send Ahmet 5 USDC" });
    const actions = parsed.body.actions as { verb: string; to: string }[];
    assert.equal(actions[0]?.verb, "send");
    assert.equal(actions[0]?.to.toLowerCase(), AHMET);
    assert.equal((parsed.body.memory as { kind: string }).kind, "contacts");
    assert.equal((parsed.body.confirmContacts as unknown[]).length, 0, "a manual contact is the owner's own entry");
    const anonymous = await call("POST", "/v1/language/parse", { text: "send Ahmet 5 USDC" }, false);
    assert.equal((anonymous.body.actions as unknown[]).length, 0, "memory is personal: no session, no contacts");
  });

  it("remembers plans, learns outcomes, repeats and undoes them, and forgets on request", async () => {
    await call("PUT", "/v1/profile", { risk: "medium" });
    const planned = await call("POST", "/v1/intents", { text: "deposit 100 USDC into morpho", owner: OWNER, environment: "mainnet" });
    assert.equal(planned.status, 201, JSON.stringify(planned.body).slice(0, 300));
    const graph = planned.body.intent as IntentGraph;
    let memory = await call("GET", "/v1/memory");
    assert.equal((memory.body.recent as { outcome: string }[])[0]?.outcome, "planned");
    // The engine reports the settlement; memory follows it.
    ctx.bus.emit("intent.updated", { id: graph.id, intent: { ...graph, steps: graph.steps.map((s) => ({ ...s, status: "settled" })) }, outrun: {} as never });
    await new Promise((r) => setTimeout(r, 50));
    memory = await call("GET", "/v1/memory");
    assert.equal((memory.body.recent as { outcome: string }[])[0]?.outcome, "settled");
    assert.equal((memory.body.learned as { venues: Record<string, string> }).venues.deposit, "morpho-vaults", JSON.stringify(memory.body).slice(0, 1500));
    assert.match(memory.body.summary as string, /preferred_venues=deposit:morpho-vaults/u);

    const again = await call("POST", "/v1/language/parse", { text: "again" });
    assert.equal((again.body.memory as { kind: string }).kind, "repeat");
    assert.deepEqual((again.body.actions as { amount: unknown }[])[0]?.amount, { exact: "100" });
    const undo = await call("POST", "/v1/language/parse", { text: "undo the last deposit" });
    assert.equal((undo.body.memory as { kind: string }).kind, "undo");
    assert.equal((undo.body.actions as { verb: string }[])[0]?.verb, "withdraw");
    const usual = await call("POST", "/v1/language/parse", { text: "put 20 USDC in my usual vault" });
    assert.equal((usual.body.actions as { venue?: string }[])[0]?.venue, "morpho-vaults");

    const exported = await call("GET", "/v1/memory/export");
    assert.equal(exported.body.schema, "lykia.memory/v1");
    assert.equal((exported.body.intents as unknown[]).length, 1);
    const forgot = await call("POST", "/v1/memory/forget", { what: "intents" });
    assert.deepEqual(forgot.body.forgotten, { intents: 1, contacts: 0 });
    assert.equal(((await call("GET", "/v1/memory")).body.recent as unknown[]).length, 0);
  });

  it("memory off: nothing new is remembered", async () => {
    await call("PUT", "/v1/profile", { memory: { enabled: false } });
    await call("POST", "/v1/intents", { text: "deposit 10 USDC into morpho", owner: OWNER, environment: "mainnet" });
    assert.equal(((await call("GET", "/v1/memory/intents")).body.intents as unknown[]).length, 0);
    await call("PUT", "/v1/profile", { memory: { enabled: true } });
  });
});

describe("venue preferences in routing", () => {
  const opt = (venue: string, apy: number) => ({ option: { venue, label: venue, apy: String(apy), risk: "low", executable: true, notes: [] }, adapter: "vault", params: {} }) as unknown as Candidate;
  const router = new VenueRouter({ chains: new FakeArc().asChains(), prices: {} as never, yields: {} as never });

  it("blocked venues are never chosen; favourites win near-ties only", () => {
    const pool = [opt("morpho-vaults", 6.1), opt("aave-v4", 5.8)];
    assert.equal(router.chooseEarn(pool, "high")?.candidate.option.venue, "morpho-vaults");
    assert.equal(router.chooseEarn(pool, "high", undefined, { blocked: ["morpho-vaults"] })?.candidate.option.venue, "aave-v4");
    const fav = router.chooseEarn(pool, "high", undefined, { favorites: ["aave-v4"] });
    assert.equal(fav?.candidate.option.venue, "aave-v4");
    assert.match(fav?.route.reason ?? "", /favourite/u);
    assert.equal(router.chooseEarn([opt("morpho-vaults", 9), opt("aave-v4", 5)], "high", undefined, { favorites: ["aave-v4"] })?.candidate.option.venue, "morpho-vaults");
  });
});
