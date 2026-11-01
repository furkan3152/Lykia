/**
 * Dry-run UI checks for the Move page, at desktop and mobile widths.
 *
 * A mock EIP-1193 wallet (announced through EIP-6963 as "Mock Wallet")
 * answers eth_requestAccounts and eth_chainId, records every
 * eth_sendTransaction and wallet_switchEthereumChain, and returns a fake
 * hash. The API is mocked at the network layer with responses captured
 * from the real API (fixtures/send.json). Nothing reaches a chain.
 *
 * Run: node apps/web/e2e/move.e2e.mjs   (starts Vite on port 5199)
 * Uses the Playwright library and the Chromium build preinstalled in the
 * environment (PLAYWRIGHT_CHROMIUM overrides the executable).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const fx = JSON.parse(readFileSync(join(here, "fixtures/send.json"), "utf8"));
const PORT = 5199;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = "http://localhost:3002";
const MAINNET = "0x13b2"; // 5042

const results = [];
let current = null;
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}\n`);
};

/** Injected before any page script: the mock wallet. */
function walletScript({ owner, chainId }) {
  const state = { chainId, sent: [], switched: [], listeners: {} };
  const emit = (event, value) => (state.listeners[event] ?? []).forEach((fn) => fn(value));
  const provider = {
    isMetaMask: false,
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [owner];
        case "eth_chainId":
          return state.chainId;
        case "net_version":
          return String(parseInt(state.chainId, 16));
        case "wallet_switchEthereumChain":
          state.switched.push(params[0].chainId);
          state.chainId = params[0].chainId;
          emit("chainChanged", state.chainId);
          return null;
        case "wallet_addEthereumChain":
          return null;
        case "wallet_getPermissions":
        case "wallet_requestPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "eth_sendTransaction":
          state.sent.push(params[0]);
          return `0x${(state.sent.length).toString(16).padStart(64, "0")}`;
        case "eth_blockNumber":
          return "0x1";
        default:
          throw Object.assign(new Error(`mock wallet: ${method} not supported`), { code: 4200 });
      }
    },
    on(event, fn) {
      (state.listeners[event] ??= []).push(fn);
    },
    removeListener(event, fn) {
      state.listeners[event] = (state.listeners[event] ?? []).filter((f) => f !== fn);
    },
  };
  window.__wallet = state;
  window.ethereum = provider;
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "00000000-0000-4000-8000-000000000001", name: "Mock Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "app.lykia.mock" }, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}

async function mockApi(page, options = {}) {
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/v1/tokens") return json(fx.tokens);
    if (path === "/v1/contacts") return json({ contacts: [{ id: "c1", name: "Ayla", address: fx.payee }] });
    if (path.startsWith("/v1/flock/")) return json({ native: { usdc18: (options.native ?? 5n * 10n ** 18n).toString() }, holdings: [] });
    if (path === "/v1/routes/search") {
      if (options.searchError) return json({ error: { code: options.searchError.code, message: options.searchError.message } }, 422);
      return json(fx.search);
    }
    if (/^\/v1\/intents\/[^/]+$/u.test(path)) return json(fx.intent);
    if (/\/steps\/s1\/prepare$/u.test(path)) return json(fx.prepared);
    if (/\/steps\/s1\/submit$/u.test(path)) {
      const step = { ...fx.intent.intent.steps[0], status: "settled", references: ["0x1"] };
      return json({ step, outrun: fx.intent.outrun });
    }
    return json({ error: { code: "NOT_FOUND", message: "Not mocked in the dry run." } }, 404);
  });
  // No real RPC or third-party traffic in a dry run.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/u, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }) }));
}

/** The mock wallet is found through EIP-6963; wagmi may reconnect it on its own, otherwise connect through the modal. */
async function connect(page, ready = page.getByRole("button", { name: /FIND THE ROUTE/u })) {
  const connectButton = page.getByRole("button", { name: /^(CONNECT TO CONTINUE|CONNECT)$/u }).last();
  await Promise.race([ready.waitFor({ timeout: 20_000 }), connectButton.waitFor({ timeout: 20_000 })]);
  if (!(await ready.isVisible())) {
    await connectButton.click();
    await page.getByRole("button", { name: /Mock Wallet/u }).click();
  }
  await ready.waitFor({ timeout: 15_000 });
}

async function run(browser, viewport, label) {
  // 1. Send: token picker, contacts, plan, sign: the wallet receives exactly the prepared transaction.
  {
    const context = await browser.newContext({ viewport, ...(label === "mobile" ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    current = page;
    page.on("pageerror", (e) => process.stderr.write(`pageerror: ${e.message.split("\n")[0]}\n`));
    await page.addInitScript(walletScript, { owner: fx.owner, chainId: MAINNET });
    await mockApi(page);
    await page.goto(`${ORIGIN}/app/move/send`);
    await connect(page);
    const options = await page.getByLabel("Token").locator("option").allTextContents();
    check(`${label}: token picker lists every registry token`, options.length === fx.tokens.tokens.length && options.some((o) => o.startsWith("GBPA")) && options.some((o) => o.startsWith("WETH")), `${options.length} tokens`);
    await page.getByLabel("Contact").selectOption(fx.payee);
    check(`${label}: picking a contact fills the address`, (await page.getByPlaceholder("0x…").first().inputValue()).toLowerCase() === fx.payee);
    await page.getByPlaceholder("25").fill("25");
    await page.getByPlaceholder("invoice 7").fill("invoice 7");
    await page.getByRole("button", { name: /FIND THE ROUTE/u }).click();
    await page.getByRole("button", { name: /SIGN ONCE/u }).first().click();
    await page.waitForFunction(() => window.__wallet.sent.length > 0, null, { timeout: 15_000 });
    const sent = await page.evaluate(() => window.__wallet.sent);
    const want = fx.prepared.transactions[0];
    const same = sent.length === fx.prepared.transactions.length && sent[0].to.toLowerCase() === want.to.toLowerCase() && sent[0].data === want.data && parseInt(sent[0].chainId ?? MAINNET, 16) === want.chainId;
    check(`${label}: the wallet gets exactly the prepared transaction (eth_sendTransaction)`, same, `to ${sent[0]?.to} data ${sent[0]?.data?.slice(0, 10)}…`);
    await context.close();
  }
  // 2. Receive: link and QR.
  {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    current = page;
    page.on("pageerror", (e) => process.stderr.write(`pageerror: ${e.message.split("\n")[0]}\n`));
    await page.addInitScript(walletScript, { owner: fx.owner, chainId: MAINNET });
    await mockApi(page);
    await page.goto(`${ORIGIN}/app/move/receive`);
    await connect(page, page.getByRole("img", { name: "Payment QR code" }));
    await page.getByPlaceholder("25").fill("12.5");
    const uri = await page.locator("span.num").filter({ hasText: "ethereum:" }).first().textContent();
    check(`${label}: receive shows an EIP-681 link and its QR code`, (uri ?? "").toLowerCase() === `ethereum:0x3600000000000000000000000000000000000000@5042/transfer?address=${fx.owner}&uint256=12500000`.toLowerCase(), uri ?? "");
    await context.close();
  }
  // 3. Wrong network: the banner, then the switch to Arc mainnet.
  {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    current = page;
    page.on("pageerror", (e) => process.stderr.write(`pageerror: ${e.message.split("\n")[0]}\n`));
    await page.addInitScript(walletScript, { owner: fx.owner, chainId: "0x1" });
    await mockApi(page);
    await page.goto(`${ORIGIN}/app/move/send`);
    await connect(page);
    const banner = page.getByText(/Your wallet is on another network/u);
    await banner.waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: /SWITCH TO ARC MAINNET/u }).click();
    await page.waitForFunction(() => window.__wallet.switched.length > 0, null, { timeout: 10_000 });
    const switched = await page.evaluate(() => window.__wallet.switched);
    check(`${label}: wrong network shows a banner and switches to chain 5042`, switched[0] === MAINNET, `switched to ${switched.join(",")}`);
    await context.close();
  }
  // 4. Clear errors: beta cap and too little USDC for gas.
  {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    current = page;
    page.on("pageerror", (e) => process.stderr.write(`pageerror: ${e.message.split("\n")[0]}\n`));
    await page.addInitScript(walletScript, { owner: fx.owner, chainId: MAINNET });
    await mockApi(page, { native: 10n ** 15n, searchError: { code: "NOT_SIGNABLE", message: "Beta: $1515 is above the $1000 per-step cap that applies to everyone while Lykia's contracts are unaudited." } });
    await page.goto(`${ORIGIN}/app/move/send`);
    await connect(page);
    await page.getByText(/keep at least 0.02 USDC/u).waitFor({ timeout: 10_000 });
    await page.getByPlaceholder("0x…").first().fill(fx.payee);
    await page.getByPlaceholder("25").fill("1500");
    await page.getByRole("button", { name: /FIND THE ROUTE/u }).click();
    const alert = page.getByRole("alert").filter({ hasText: /capped per step and per day/u });
    await alert.waitFor({ timeout: 10_000 });
    check(`${label}: low gas and the beta cap are explained`, true);
    await context.close();
  }
}

const viteBin = join(dirname(createRequire(join(web, "package.json")).resolve("vite/package.json")), "bin/vite.js");
const vite = spawn(process.execPath, [viteBin, "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: web, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VITE_API_URL: API } });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Vite did not start")), 60_000);
  vite.stderr.on("data", (d) => process.stderr.write(d));
  vite.stdout.on("data", (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(timer);
      resolve();
    }
  });
});
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
try {
  for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    try {
      await run(browser, viewport, label);
    } catch (error) {
      check(`${label}: run`, false, error instanceof Error ? error.message.split("\n")[0] : String(error));
      if (process.env.E2E_SHOTS && current) await current.screenshot({ path: join(process.env.E2E_SHOTS, `fail-${label}.png`) }).catch(() => undefined);
    }
  }
} finally {
  await browser.close();
  vite.kill();
}
const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length > 0 ? 1 : 0);
