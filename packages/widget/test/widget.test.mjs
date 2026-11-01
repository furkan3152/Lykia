import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { createTransport } from "@lykia/sdk";
import {
  LykiaProvider, LykiaChat, Send, Swap, Earn, Bridge, Fence, Scent, Flock, Pack, Outrun,
  WIDGET_CSS, arcPoints, createChatController, createFenceController, createPlanController, createQuery, resolveSigner, themeFromBrand, themeVars,
  useLykiaPlan, useLykiaChat, useFence, useScent, useFlock, usePack, useOutrun,
} from "../dist/index.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function intent(decision = "allow", signable = true) {
  return { id: "out_abc123", steps: [{ id: "s1", summary: "Send 5 USDC", fee: { bps: 100, recipient: OWNER, symbol: "USDC", token: OWNER, decimals: 6, amount: "50000", usd: "0.05", basis: "on-top" } }], verdict: { decision, signable, reasons: [] } };
}

function fakeApi(routes) {
  const calls = [];
  const transport = createTransport({ baseUrl: "https://api.test", apiKey: "lk_pk_x", fetch: async (url, init) => {
    const path = url.replace("https://api.test", "");
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    for (const [pattern, reply] of routes) if (path.match(pattern)) return typeof reply === "function" ? reply(path, init) : json(200, reply);
    return json(404, { error: { code: "NOT_FOUND", message: "no route" } });
  } });
  return { transport, calls };
}

test("plan controller: plan, then prepare, sign and submit every step, with typed events", async () => {
  const sent = [];
  const signer = { source: "provider", address: async () => OWNER, send: async (tx) => (sent.push(tx), "0x" + "b".repeat(64)) };
  const { transport, calls } = fakeApi([
    [/^\/v1\/intents$/u, json.bind(null, 201, { intent: intent(), outrun: { waypoints: [] }, stored: true })],
    [/prepare$/u, { stepId: "s1", transactions: [{ chainId: 5042002, from: OWNER, to: OWNER, data: "0x", value: "0" }], binding: "sha256:x", memo: "m" }],
    [/submit$/u, { step: { id: "s1", status: "settled" }, outrun: { progress: 1, waypoints: [] } }],
  ]);
  const events = [];
  transport.on("plan-created", (e) => events.push(["plan", e.intentId]));
  transport.on("settled", (e) => events.push(["settled", e.stepId]));
  const plan = createPlanController({ transport, signer: async () => signer, environment: "testnet" });
  const seen = [];
  plan.subscribe(() => seen.push(plan.get().status));
  await plan.plan({ text: "send 5 USDC to me" });
  assert.equal(plan.get().status, "planned");
  assert.equal(calls[0].body.owner, OWNER, "owner comes from the wallet");
  assert.equal(calls[0].body.environment, "testnet");
  assert.equal(await plan.run(), true);
  assert.equal(plan.get().status, "settled");
  assert.equal(sent.length, 1);
  assert.deepEqual(calls.find((c) => c.path.endsWith("/submit")).body, { hashes: ["0x" + "b".repeat(64)] });
  assert.deepEqual(events, [["plan", "out_abc123"], ["settled", "s1"]]);
  assert.deepEqual([...new Set(seen)], ["planning", "planned", "signing", "settled"]);
});

test("plan controller refuses to sign a denied or dry-run plan, and reports errors", async () => {
  const { transport } = fakeApi([[/^\/v1\/intents$/u, { intent: intent("deny", false), outrun: {}, stored: false }]]);
  const plan = createPlanController({ transport, signer: async () => ({ address: async () => OWNER, send: async () => { throw new Error("must not sign"); } }) });
  await plan.plan({ owner: OWNER, text: "x" });
  assert.equal(await plan.run(), false);
  assert.match(plan.get().error, /denied/u);
  const none = createPlanController({ transport, signer: async () => null });
  await none.plan({ text: "x" });
  assert.equal(none.get().status, "error");
  assert.match(none.get().error, /Connect a wallet/u);
});

test("chat controller keeps the thread and the proposals", async () => {
  const { transport, calls } = fakeApi([[/agent\/chat$/u, { threadId: "th_1", mode: "reader", reply: "Here is a plan.", proposals: [{ intentId: "out_1", title: "Send", steps: ["Send 5 USDC"], decision: "allow", reasons: [], warnings: [], attribution: [], rationale: "" }], stopReason: "done", events: [] }]]);
  const chat = createChatController({ transport, owner: async () => OWNER });
  await chat.send("send 5 usdc to bob");
  await chat.send("again");
  assert.equal(chat.get().messages.length, 4);
  assert.equal(chat.get().proposals[0].intentId, "out_1");
  assert.equal(calls[1].body.threadId, "th_1");
  await chat.send("   ");
  assert.equal(calls.length, 2);
});

test("fence controller shows loosened rules from the server; queries ignore stale answers", async () => {
  const { transport } = fakeApi([[/fence\/validate$/u, (_p, init) => json(200, { ok: true, loosened: JSON.parse(init.body).fence.caps.perStepUsd === "99999" ? ["Per-step cap raised to $99999"] : [] })]]);
  const fence = createFenceController(transport, { template: "shepherd" });
  fence.setCap("perStepUsd", "99999");
  assert.equal(await fence.validate(), true);
  assert.deepEqual(fence.get().loosened, ["Per-step cap raised to $99999"]);
  fence.pickTemplate("lamb");
  assert.equal(fence.get().fence.label, "Lamb");

  let release;
  const slow = new Promise((r) => (release = r));
  const q = createQuery(async (n) => (n === 1 ? slow : n));
  const first = q.load(1);
  await q.load(2);
  release(1);
  await first;
  assert.equal(q.get().data, 2);
});

test("themes come from the brand, stay sanitised and every CSS rule is scoped", () => {
  const theme = themeFromBrand({ colors: { primary: "#0f766e", accent: "red;}body{x" }, font: "Acme; } *{", scheme: "dark", radius: 40 });
  assert.equal(theme.primary, "#0f766e");
  assert.equal(theme.accent, "#d9a441");
  assert.equal(theme.scheme, "dark");
  assert.ok(!theme.font.includes(";"));
  assert.equal(themeVars(theme)["--lykia-primary"], "#0f766e");
  for (const rule of WIDGET_CSS.split("}").map((r) => r.trim()).filter(Boolean)) {
    for (const selector of rule.split("{")[0].split(",")) assert.match(selector.trim(), /^\[data-lykia\]/u, selector);
  }
});

test("EIP-1193 signer switches to the step's chain before sending", async () => {
  const requests = [];
  const provider = { request: async ({ method, params }) => {
    requests.push(method);
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [OWNER];
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_sendTransaction") return "0x" + "c".repeat(64);
    return null;
  } };
  const signer = await resolveSigner({ provider });
  assert.equal(await signer.address(), OWNER);
  assert.equal(await signer.send({ chainId: 5042002, from: OWNER, to: OWNER, data: "0x", value: "0" }), "0x" + "c".repeat(64));
  assert.deepEqual(requests.slice(1), ["eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain", "eth_sendTransaction"]);
  const wc = await resolveSigner({ walletClient: { account: { address: OWNER }, request: provider.request } });
  assert.equal(wc.source, "walletClient");
  const wagmi = await resolveSigner({ wagmiConfig: { state: { current: "c1", connections: new Map([["c1", { accounts: [OWNER], connector: { getProvider: async () => provider } }]]) } } });
  assert.equal(wagmi.source, "wagmi");
  assert.equal(await resolveSigner({}), null, "no wallet on the server");
});

test("every component and hook renders on the server without a window", () => {
  assert.equal(typeof globalThis.window, "undefined");
  const { transport } = fakeApi([]);
  let hookState;
  function Headless() {
    hookState = { plan: useLykiaPlan(), chat: useLykiaChat(), fence: useFence(), scent: useScent(), flock: useFlock(), pack: usePack(), outrun: useOutrun() };
    return null;
  }
  const html = renderToString(h(LykiaProvider, { transport, brand: { mascot: "custom", assistant: { name: "Penny" }, colors: { primary: "#0f766e" } }, owner: OWNER }, h(LykiaChat), h(Send), h(Swap), h(Earn), h(Bridge), h(Fence), h(Scent), h(Flock), h(Pack), h(Outrun), h(Headless)));
  for (const name of ["chat", "send", "swap", "earn", "bridge", "fence", "scent", "flock", "pack", "outrun"]) assert.ok(html.includes(`data-lykia="${name}"`), name);
  assert.ok(html.includes("Penny"));
  assert.ok(html.includes("--lykia-primary:#0f766e"));
  assert.equal(hookState.plan.status, "idle");
  assert.equal(hookState.chat.assistantName, "Penny");
  assert.equal(hookState.fence.template, "shepherd");
  assert.equal(hookState.scent.loading, false);

  const gated = renderToString(h(LykiaProvider, { transport, modules: ["chat"] }, h(Swap), h(LykiaChat)));
  assert.ok(gated.includes('data-lykia="swap-off"'));
  assert.ok(gated.includes('data-lykia="chat"'));
  assert.throws(() => renderToString(h(Swap)), /LykiaProvider/u);
});

test("the outrun arc places waypoints left to right", () => {
  const pts = arcPoints(3);
  assert.equal(pts.length, 3);
  assert.ok(pts[0].x < pts[1].x && pts[1].x < pts[2].x);
  assert.ok(pts[1].y < pts[0].y, "the middle is the top of the arc");
  assert.deepEqual(arcPoints(0), []);
});
