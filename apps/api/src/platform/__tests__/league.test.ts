import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { FakeArc, serve, testConfig, type Served } from "../../__tests__/support.js";
import { OFFICIAL_CITIES, seedLeague, seedProjectId, seedStatus } from "../league.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
// Throwaway test keys (well-known local development keys), never real funds.
const admin = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const dev = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");
const stranger = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

describe("the League", () => {
  let ctx: AppContext;
  let served: Served;

  before(async () => {
    ctx = createContext(testConfig({ LYKIA_SESSION_SECRET: "l".repeat(40), LYKIA_ADMIN_ADDRESSES: admin.address, LYKIA_RATE_LIMIT_AUTH: "500", LYKIA_ROOT_DOMAIN: "lykiaai.com" }), { chains: new FakeArc().asChains(), pulse: idlePulse });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(`${served.url}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });

  async function signIn(account: typeof dev, register = false): Promise<string> {
    const once = async () => {
      const nonce = (await (await call("/v1/auth/nonce", { body: { address: account.address, chainId: 5042002 } })).json()) as { message: string };
      const signature = await account.signMessage({ message: nonce.message });
      return ((await (await call("/v1/auth/verify", { body: { message: nonce.message, signature } })).json()) as { token: string }).token;
    };
    const token = await once();
    if (!register) return token;
    assert.equal((await call("/v1/developers/register", { body: { name: "Builder" }, headers: { "lykia-session": token } })).status, 201);
    return once();
  }

  it("seeds the official cities idempotently, owned by the first admin address", async () => {
    const before = await seedStatus(ctx);
    assert.ok(before.cities.every((c) => c.outcome === "missing"));
    const first = await seedLeague(ctx);
    assert.equal(first.owner, admin.address.toLowerCase());
    assert.deepEqual(first.cities.map((c) => c.outcome), ["created", "created", "created"]);
    const [second, third] = await Promise.all([seedLeague(ctx), seedLeague(ctx)]);
    assert.ok([...second!.cities, ...third!.cities].every((c) => c.outcome === "present"));
    const all = await ctx.store.collection("projects").list({ limit: 100 });
    assert.equal(all.length, OFFICIAL_CITIES.length, "no duplicates");
    assert.equal(seedProjectId("pay"), seedProjectId("pay"));
    assert.match(seedProjectId("pay"), /^prj_[a-z0-9]{12}$/u);
  });

  it("lists cities publicly with their public project view and usage, and hides private fields", async () => {
    const res = (await (await call("/v1/league")).json()) as { cities: { slug: string; league: { status: string; state: string; codename: string | null }; project: Record<string, unknown>; usage: { last7Days: { requests: number } } }[] };
    assert.deepEqual(res.cities.map((c) => c.slug), ["agents", "pay", "perps"]);
    assert.deepEqual(res.cities.map((c) => c.league.codename), ["Xanthos", "Patara", "Phaselis"]);
    assert.equal(res.cities[2]!.league.state, "coming");
    for (const c of res.cities) {
      for (const hidden of ["owner", "prompt", "webhookUrl", "origins", "league"]) assert.ok(!(hidden in c.project), hidden);
      assert.equal(c.usage.last7Days.requests, 0);
    }
    const agents = (await (await call("/v1/league/agents")).json()) as { project: { modules: string[]; fence: { caps: { perStepUsd: string } } } };
    assert.deepEqual(agents.project.modules, ["chat", "pack", "fence"]);
    assert.equal(agents.project.fence.caps.perStepUsd, "50");
    assert.equal((await call("/v1/league/nowhere")).status, 404);
  });

  it("lets a developer request a listing and only an admin decide it", async () => {
    const devToken = await signIn(dev, true);
    const h = { "lykia-session": devToken };
    const project = (await (await call("/v1/projects", { headers: h, body: { name: "Acme Treasury", origins: ["http://localhost:5173"] } })).json()) as { id: string };
    assert.equal((await call(`/v1/projects/${project.id}/league/request`, { headers: h, body: { tagline: "short", category: "treasury" } })).status, 400);
    assert.equal((await call(`/v1/projects/${project.id}/league/request`, { headers: h, body: { tagline: "A treasury that keeps its own rules", category: "treasury", slug: "pay" } })).status, 409, "slug taken");
    const requested = await call(`/v1/projects/${project.id}/league/request`, { headers: h, body: { tagline: "A treasury that keeps its own rules", category: "treasury", emblem: "lyre" } });
    assert.equal(requested.status, 201);
    assert.equal(((await requested.json()) as { league: { review: string; slug: string } }).league.slug, "acme-treasury");
    const strangerToken = await signIn(stranger, true);
    assert.equal((await call(`/v1/projects/${project.id}/league/request`, { headers: { "lykia-session": strangerToken }, body: { tagline: "Not my project at all", category: "tools" } })).status, 404);
    const official = seedProjectId("pay");
    assert.equal((await call(`/v1/projects/${official}/league/request`, { headers: h, body: { tagline: "Trying to take a city", category: "payments" } })).status, 404, "not the owner");

    // Not listed until approved; a PATCH cannot smuggle a listing in.
    assert.equal((await call("/v1/league/acme-treasury")).status, 404);
    assert.equal((await call(`/v1/projects/${project.id}`, { method: "PATCH", headers: h, body: { league: { listed: true } } })).status, 400);

    // Developers and strangers are refused by the server, whatever the client shows.
    assert.equal((await call(`/v1/league/${project.id}`, { method: "PUT", headers: h, body: { action: "approve" } })).status, 403);
    assert.equal((await call("/v1/admin/league", { headers: h })).status, 403);
    assert.equal((await call("/v1/admin/league/seed", { method: "POST", headers: h, body: {} })).status, 403);
    assert.equal((await call("/v1/admin/league")).status, 401);

    const adminToken = await signIn(admin);
    const a = { "lykia-session": adminToken };
    const council = (await (await call("/v1/admin/league", { headers: a })).json()) as { cities: { id: string; league: { review: string } }[]; seed: { cities: { outcome: string }[] } };
    assert.equal(council.cities[0]!.id, project.id, "requests come first");
    assert.ok(council.seed.cities.every((c) => c.outcome === "present"));
    assert.equal((await call(`/v1/league/${project.id}`, { method: "PUT", headers: a, body: { action: "feature" } })).status, 409, "list before featuring");
    assert.equal((await call(`/v1/league/${project.id}`, { method: "PUT", headers: a, body: { action: "approve", note: "Looks good" } })).status, 200);
    assert.equal((await call("/v1/league/acme-treasury")).status, 200);

    // A paused city answers reads only, even through its own browser key.
    const key = (await (await call(`/v1/projects/${project.id}/keys`, { headers: h, body: { label: "site" } })).json()) as { secret: string };
    assert.equal((await call(`/v1/league/${project.id}`, { method: "PUT", headers: a, body: { action: "pause" } })).status, 200);
    const paused = await call("/v1/language/parse", { headers: { "lykia-key": key.secret, origin: "http://localhost:5173" }, body: { text: "send 5 USDC to 0x1111111111111111111111111111111111111111" } });
    assert.equal(paused.status, 423);
    assert.equal(((await paused.json()) as { error: { code: string } }).error.code, "CITY_PAUSED");
    const listed = (await (await call("/v1/league")).json()) as { cities: { slug: string; league: { state: string } }[] };
    assert.equal(listed.cities.find((c) => c.slug === "acme-treasury")?.league.state, "paused");

    const audit = (await (await call("/v1/security/audit?chain=platform", { headers: a })).json()) as { entries: { kind: string; data: { action?: string } }[]; verified: { ok: boolean } };
    assert.ok(audit.verified.ok);
    assert.deepEqual(audit.entries.filter((e) => e.kind === "league" && e.data.action).map((e) => e.data.action), ["approve", "pause"]);
  });

  it("gives every project a unique slug and serves cities by slug, host and subdomain", async () => {
    const token = await signIn(dev, true);
    const h = { "lykia-session": token };
    const a = (await (await call("/v1/projects", { headers: h, body: { name: "Shop Front" } })).json()) as { id: string; slug: string };
    const b = (await (await call("/v1/projects", { headers: h, body: { name: "Shop Front" } })).json()) as { slug: string };
    assert.equal(a.slug, "shop-front");
    assert.equal(b.slug, "shop-front-2", "a second project with the same name gets the next free slug");
    for (const slug of ["www", "api", "app", "admin", "letoon", "mint", "ab", "Bad", "x".repeat(25)]) assert.equal((await call("/v1/projects", { headers: h, body: { name: "Reserved", slug } })).status, 400, slug);
    assert.equal((await call("/v1/projects", { headers: h, body: { name: "Copy", slug: "pay" } })).status, 409, "an official city's slug is taken");
    assert.equal((await call(`/v1/projects/${a.id}`, { method: "PATCH", headers: h, body: { slug: "agents" } })).status, 409);

    const pay = (await (await call("/v1/league/by-slug/pay")).json()) as { project: { name: string; slug: string } };
    assert.deepEqual([pay.project.name, pay.project.slug], ["Lykia Pay", "pay"]);
    assert.equal((await call("/v1/league/by-slug/shop-front")).status, 404, "unlisted projects are not cities");
    assert.equal((await call("/v1/league/by-host?host=nowhere.example")).status, 404);

    // CORS admits https://<listed slug>.lykiaai.com only.
    const cors = async (origin: string) => (await call("/v1/league", { headers: { origin } })).headers.get("access-control-allow-origin");
    assert.equal(await cors("https://pay.lykiaai.com"), "https://pay.lykiaai.com");
    assert.equal(await cors("https://agents.lykiaai.com"), "https://agents.lykiaai.com");
    assert.equal(await cors("https://shop-front.lykiaai.com"), null, "not listed");
    assert.equal(await cors("http://pay.lykiaai.com"), null, "https only");
    assert.equal(await cors("https://a.pay.lykiaai.com"), null);
    assert.equal(await cors("https://pay.lykiaai.com.evil.example"), null);

    // Sign-in from a city names the city's own host.
    const nonce = (await (await call("/v1/auth/nonce", { headers: { origin: "https://pay.lykiaai.com" }, body: { address: dev.address, chainId: 5042002 } })).json()) as { message: string };
    assert.match(nonce.message, /^pay\.lykiaai\.com wants you to sign in/u);
    const signature = await dev.signMessage({ message: nonce.message });
    assert.equal((await call("/v1/auth/verify", { body: { message: nonce.message, signature } })).status, 200);
  });

  it("documents every League route", async () => {
    const spec = (await (await call("/v1/openapi.json")).json()) as { paths: Record<string, Record<string, unknown>> };
    for (const [path, method] of [["/v1/league", "get"], ["/v1/league/{slug}", "get"], ["/v1/projects/{id}/league/request", "post"], ["/v1/league/{id}", "put"], ["/v1/admin/league", "get"], ["/v1/admin/league/seed", "post"], ["/v1/league/by-slug/{slug}", "get"], ["/v1/league/by-host", "get"]] as const) assert.ok(spec.paths[path]?.[method], `${method} ${path}`);
  });
});
