import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// A minimal DOM: enough for custom elements, iframes, attributes and events.
class FakeNode extends EventTarget {
  constructor(tag = "div") { super(); this.localName = tag; this.attrs = new Map(); this.children = []; this.style = { cssText: "" }; this.textContent = ""; this.isConnected = false; }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  hasAttribute(n) { return this.attrs.has(n); }
  setAttribute(n, v) { const prev = this.getAttribute(n); this.attrs.set(n, String(v)); this.attributeChangedCallback?.(n, prev, String(v)); }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
}
const registry = new Map();
function installDom() {
  globalThis.HTMLElement = FakeNode;
  globalThis.customElements = { get: (t) => registry.get(t), define: (t, c) => registry.set(t, c) };
  globalThis.document = { createElement: (tag) => {
    const el = new FakeNode(tag);
    if (tag === "iframe") el.contentWindow = { posted: [], postMessage(msg, origin, ports) { this.posted.push({ msg, origin, ports }); } };
    return el;
  } };
  globalThis.window = globalThis;
}
installDom();
const mod = await import("../dist/index.js");

function mount(tag, attrs) {
  const Ctor = customElements.get(tag);
  const el = new Ctor();
  el.localName = tag;
  for (const [k, v] of Object.entries(attrs)) el.attrs.set(k, v);
  el.isConnected = true;
  el.connectedCallback();
  return el;
}
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const KEY = "lk_pk_abcdefabcdef_" + "A".repeat(32);

test("protocol helpers check every attribute and keep the key out of the URL", () => {
  assert.deepEqual(mod.appearanceParams((n) => ({ primary: "#0f766e", accent: "red", scheme: "dark", radius: "99", environment: "testnet", mosaic: "off" })[n] ?? null), { primary: "#0f766e", scheme: "dark", environment: "testnet", mosaic: "off" });
  const url = mod.frameUrl("https://lykia.xyz", "swap", "prj_aaaaaaaaaaaa", { primary: "#0f766e" });
  assert.equal(url, "https://lykia.xyz/embed/swap?project=prj_aaaaaaaaaaaa&v=1&primary=%230f766e");
  assert.equal(mod.clampHeight(5), mod.MIN_FRAME_HEIGHT);
  assert.equal(mod.clampHeight(99999), mod.MAX_FRAME_HEIGHT);
  assert.equal(mod.clampHeight("x"), null);
  assert.equal(mod.EMBED_ROUTES["lykia-assistant"], "chat");
});

test("every element is defined and refuses a missing project or a secret key", () => {
  for (const tag of Object.keys(mod.EMBED_ROUTES)) assert.ok(customElements.get(tag), tag);
  const errors = [];
  const bad = mount("lykia-swap", { project: "nope" });
  assert.equal(bad.children[0].localName, "p");
  const secret = new (customElements.get("lykia-swap"))();
  secret.addEventListener("lykia:error", (e) => errors.push(e.detail.message));
  secret.attrs.set("project", "prj_aaaaaaaaaaaa");
  secret.attrs.set("key", "lk_sk_abcdefabcdef_" + "A".repeat(32));
  secret.isConnected = true;
  secret.connectedCallback();
  assert.match(errors[0], /publishable/u);
});

test("a sandboxed frame connects over a private port, resizes and re-dispatches events", async () => {
  const el = mount("lykia-swap", { project: "prj_aaaaaaaaaaaa", key: KEY, primary: "#0f766e", host: "https://lykia.example", owner: "0x1111111111111111111111111111111111111111" });
  const frame = el.children[0];
  assert.equal(frame.localName, "iframe");
  assert.equal(frame.src, "https://lykia.example/embed/swap?project=prj_aaaaaaaaaaaa&v=1&primary=%230f766e");
  assert.equal(frame.getAttribute("sandbox"), mod.FRAME_SANDBOX);
  assert.ok(!frame.src.includes("lk_pk"));
  frame.dispatchEvent(new Event("load"));
  await tick();
  const { msg, origin, ports } = frame.contentWindow.posted[0];
  assert.equal(origin, "https://lykia.example", "only Lykia's origin may read the connect message");
  assert.deepEqual({ type: msg.type, v: msg.v, key: msg.key, owner: msg.owner, hostWallet: msg.hostWallet }, { type: "lykia:connect", v: 1, key: KEY, owner: "0x1111111111111111111111111111111111111111", hostWallet: false });
  const port = ports[0];
  const seen = [];
  for (const name of ["ready", "resize", "plan-created", "settled", "error"]) el.addEventListener(`lykia:${name}`, (e) => seen.push([name, e.detail]));
  port.postMessage({ type: "ready", v: 1 });
  port.postMessage({ type: "resize", height: 512 });
  port.postMessage({ type: "event", name: "plan-created", detail: { intentId: "out_1" } });
  port.postMessage({ type: "event", name: "settled", detail: { intentId: "out_1" } });
  port.postMessage({ type: "event", name: "unknown", detail: {} });
  await tick(20);
  assert.deepEqual(seen.map((s) => s[0]), ["ready", "resize", "plan-created", "settled"]);
  assert.equal(frame.style.height, "512px");
  await tick(2000);
  assert.equal(frame.contentWindow.posted.length, 1, "no reconnects after ready");
  port.close();
  el.disconnectedCallback();
});

test("the host wallet answers only allow-listed methods, and only with wallet=\"host\"", async () => {
  const el = mount("lykia-assistant", { project: "prj_aaaaaaaaaaaa", key: KEY, wallet: "host" });
  const calls = [];
  el.provider = { request: async ({ method }) => (calls.push(method), method === "eth_accounts" ? ["0x1111111111111111111111111111111111111111"] : "0xok") };
  const frame = el.children[0];
  frame.dispatchEvent(new Event("load"));
  await tick();
  const port = frame.contentWindow.posted[0].ports[0];
  assert.equal(frame.contentWindow.posted[0].msg.hostWallet, true);
  const replies = [];
  port.onmessage = (e) => replies.push(e.data);
  port.postMessage({ type: "ready", v: 1 });
  port.postMessage({ type: "wallet:request", id: 1, method: "eth_accounts" });
  port.postMessage({ type: "wallet:request", id: 2, method: "eth_sign", params: ["0x"] });
  await tick(30);
  assert.deepEqual(replies.find((r) => r.id === 1).result, ["0x1111111111111111111111111111111111111111"]);
  assert.match(replies.find((r) => r.id === 2).error, /not allowed/u);
  assert.deepEqual(calls, ["eth_accounts"]);
  port.close();
  el.disconnectedCallback();
});

test("the script-tag bundle defines the same elements without imports", () => {
  registry.clear();
  const code = readFileSync(new URL("../dist/lykia-embed.js", import.meta.url), "utf8");
  vm.runInThisContext(code);
  assert.ok(customElements.get("lykia-assistant"));
  assert.ok(customElements.get("lykia-outrun"));
});
