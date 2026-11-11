/**
 * The contrast check. It starts the web app on a local dev server, answers
 * the API from fixtures (api.json, and the kit's sample plans for Ask), and
 * renders Lykia's main screens in day and in night, 1440 and 390 wide:
 * landing, Ask (empty, a question, a plan with a warning, the route panel,
 * the review modal), every Fold tab, Your Lyko, The Forge and the kits.
 * In each it measures every visible text against the background it sits
 * on (measure.js) and runs axe-core's color-contrast rule. Any text under
 * WCAG AA, or the same colour as its background, fails the run.
 *
 *   npm run contrast -w @lykia/web            all screens
 *   CONTRAST_ONLY=ask-plan,review npm run contrast -w @lykia/web
 *   CONTRAST_SHOTS=/some/dir …                 also saves a screenshot of each
 *
 * It needs Google Chrome (or CHROME_PATH pointing at a Chromium build).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import { createServer } from "vite";

import { isLocale, registerCoreCatalogue, setCoreLocaleSource, tx, txIn, txKnown, type Locale } from "@lykia/core";
import coreEs from "@lykia/core/i18n/es";
import coreFr from "@lykia/core/i18n/fr";
import corePt from "@lykia/core/i18n/pt-BR";
import coreTr from "@lykia/core/i18n/tr";
import coreZh from "@lykia/core/i18n/zh-CN";

import { bridgePlan } from "../../src/pages/kit/preflightFixtures";
import { intentResponse } from "../../src/pages/kit/stagedFixtures";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const MEASURE = readFileSync(resolve(here, "measure.js"), "utf8");
const FIXTURES = JSON.parse(readFileSync(resolve(here, "api.json"), "utf8")) as Record<string, unknown>;
const API = "http://localhost:3002";
const OWNER = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f";

export type Theme = "day" | "night";

interface Issue {
  readonly where: string;
  readonly text: string;
  readonly fg: string;
  readonly bg: string;
  readonly ratio: number;
  readonly need: number;
  readonly same: boolean;
}

export interface Scene {
  readonly id: string;
  readonly path: string;
  /** A browser wallet is connected (testnet). */
  readonly wallet?: boolean;
  /** The wallet is also signed in, and owns nothing yet (the Fold's newcomer states). */
  readonly newcomer?: boolean;
  readonly act?: (page: Page) => Promise<void>;
}

/* ------------------------------------------------------------- the API */

/*
 * The API writes its sentences in the request's language (Accept-Language) and translates known phrases on
 * the way out. The harness does the same with core's catalogues, so a page in another language shows what the
 * real API would send, and the language check reads API-written text too.
 */
registerCoreCatalogue("tr", coreTr);
registerCoreCatalogue("es", coreEs);
registerCoreCatalogue("pt-BR", corePt);
registerCoreCatalogue("zh-CN", coreZh);
registerCoreCatalogue("fr", coreFr);
let answering: Locale = "en";
setCoreLocaleSource(() => answering);
/** Every locale the page asked the API in, so a run can show the language reached the server. */
export const ASKED_LOCALES = new Set<string>();

const KEEP_KEYS = new Set(["id", "kind", "type", "event", "threadId", "code", "href", "url", "address", "owner", "to", "token", "symbol", "chain", "hash", "txHash", "role", "mode", "decision", "status", "tone", "icon", "action", "source", "environment", "data", "calldata", "sentence", "intent", "venue", "rule", "signer", "account", "recipient", "spec"]);
function localizeOut(v: unknown, depth = 0): unknown {
  if (answering === "en" || depth > 14) return v;
  if (typeof v === "string") return txKnown(v);
  if (Array.isArray(v)) return v.map((x) => localizeOut(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, KEEP_KEYS.has(k) ? x : localizeOut(x, depth + 1)]));
  return v;
}

const plans = new Map<Locale, ReturnType<typeof bridgePlan>>();
function planIn(locale: Locale): ReturnType<typeof bridgePlan> {
  let p = plans.get(locale);
  if (!p) plans.set(locale, (p = bridgePlan()));
  return p;
}
const sse = (events: readonly (readonly [string, unknown])[]) => `retry: 3000\n\n${events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("")}`;

/** First turn: the plan and the question Lyko asks about gas. Every later turn: the plan alone. */
function chatTurn(n: number): string {
  const threadId = "thr_contrast";
  const plan = planIn(answering);
  return sse([
    ["thread", { threadId, mode: "llm" }],
    ["step", { id: "s1", kind: "intent", label: tx("Reading your request"), state: "ok", result: tx("{n, plural, one {# action} other {# actions}}", { n: 1 }), ms: 21 }],
    ["step", { id: "s2", kind: "route", label: tx("Searching routes"), state: "ok", result: `cctp · ${tx("{n, plural, one {# step} other {# steps}}", { n: 1 })}`, ms: 640 }],
    ["step", { id: "s3", kind: "fence", label: tx("Checking your Fence"), state: "ok", result: tx("Needs your confirmation"), ms: 2 }],
    ["block", { kind: "fence", decision: "confirm", rules: plan.graph.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => ({ rule: r.rule, message: r.message })), headroom: [{ label: tx("Per step"), value: "$1000" }, { label: tx("Per day"), value: "$5000" }] }],
    ["proposal", plan.proposal],
    ...(n === 0 ? ([["clarify", plan.clarify]] as const) : []),
    ["text", { text: n === 0 ? plan.text.split("\n\n")[0]! : plan.text }],
    ["done", { threadId, stopReason: "end_turn" }],
  ]);
}

/** A turn after the owner signed: the step settled on Arc. */
function settledTurn(): string {
  const threadId = "thr_contrast";
  return sse([
    ["thread", { threadId, mode: "llm" }],
    ["step", { id: "s1", kind: "intent", label: tx("Reading your request"), state: "ok", result: tx("{n, plural, one {# action} other {# actions}}", { n: 1 }), ms: 21 }],
    ["block", { kind: "settled", summary: tx("Bridged {amount} {symbol} to {name}", { amount: "0.99", symbol: "USDC", name: "Base" }), tx: `0x${"ab".repeat(32)}` }],
    ["text", { text: tx("Your bridge settled on Arc. The USDC is minted on Base in about 20 seconds.") }],
    ["done", { threadId, stopReason: "end_turn" }],
  ]);
}

/** A signed-in owner with nothing yet: every list empty. */
const AT = "2026-11-11T12:00:00.000Z";
const EMPTY: Readonly<Record<string, unknown>> = {
  "/v1/fold/instructions": { owner: OWNER, at: AT, instructions: [], waiting: [], counts: { running: 0, paused: 0, ordersWaiting: 0, waitingSignature: 0 } },
  "/v1/fold/trails": { owner: OWNER, items: [], totals: { settled: 0, failed: 0, refused: 0, feesUsd: "0" } },
  "/v1/pack": { agents: [] },
  "/v1/leashes": { leashes: [] },
  "/v1/autopilot": { offer: { available: true, ceilings: { perStepUsd: "100", perDayUsd: "300" } }, autopilot: null, leash: null, today: null, runs: [] },
};

async function answer(route: Route, turns: { n: number }, newcomer: boolean): Promise<void> {
  const url = new URL(route.request().url());
  const path = url.pathname;
  // The language the page asked in: Accept-Language, as the API reads it (one request at a time, so this is safe).
  const asked = (route.request().headers()["accept-language"] ?? "en").split(",")[0]!.trim();
  answering = isLocale(asked) ? asked : "en";
  ASKED_LOCALES.add(asked);
  const plan = planIn(answering);
  const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(localizeOut(body)) });
  if (newcomer && path in EMPTY) return json(EMPTY[path]);
  if (path === "/v1/agent/chat") {
    const said = String((JSON.parse(route.request().postData() ?? "{}") as { message?: unknown }).message ?? "");
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: /settled/iu.test(said) ? settledTurn() : chatTurn(turns.n++) });
  }
  if (path.endsWith("/stream")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: "retry: 600000\n\n" });
  if (path === `/v1/intents/${plan.graph.id}`) return json(intentResponse(plan.graph));
  const key = `${path}${url.search}`;
  if (key in FIXTURES) return json(FIXTURES[key]);
  if (path in FIXTURES) return json(FIXTURES[path]);
  if (path === "/v1/arc/pulse") return json(FIXTURES["/v1/arc/pulse?environment=mainnet"]);
  return json({ error: { code: "NOT_FOUND", message: "Not in the contrast fixtures." } }, 404);
}

/**
 * A browser wallet that only answers who it is: enough for "connected",
 * never signs. Kept as source text: it runs in the page as written.
 */
const walletScript = (owner: string) => `
(() => {
  const owner = ${JSON.stringify(owner)};
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [owner];
      if (method === "eth_chainId") return "0x4cef52";
      if (method === "net_version") return "5042002";
      throw Object.assign(new Error("Not supported in the contrast check"), { code: 4200 });
    },
    on: () => undefined,
    removeListener: () => undefined,
  };
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  // wagmi reconnects an injected wallet it saw connected before.
  try {
    localStorage.setItem("lykia.wagmi.injected.connected", "true");
    localStorage.setItem("lykia.wagmi.recentConnectorId", '"injected"');
  } catch {}
})();
`;

/* ---------------------------------------------------------- the scenes */

/** What the owner types in each language: the owner writes in their own language too (the sentence from core's catalogue). */
export const OWNER_SAYS: Readonly<Record<string, string>> = Object.fromEntries(
  (["en", "tr", "es", "pt-BR", "zh-CN", "fr"] as const).map((l) => [l, txIn(l, "Bridge {amount} {symbol} to {name}", { amount: "1", symbol: "USDC", name: "Base" })]),
);
async function pageLocale(page: Page): Promise<string> {
  return (await page.evaluate(() => localStorage.getItem("lykia.locale")).catch(() => null)) ?? "en";
}
export async function sayBridge(page: Page): Promise<void> {
  await say(page, OWNER_SAYS[await pageLocale(page)] ?? OWNER_SAYS.en!);
}

export async function say(page: Page, text: string): Promise<void> {
  const box = page.locator("textarea").first();
  await box.waitFor({ timeout: 30_000 });
  await box.fill(text);
  await box.press("Enter");
  await page.waitForSelector(".m-msg--lyko .m-card2[data-kind='route']", { timeout: 30_000 });
  await page.waitForTimeout(800);
}

export async function toPlan(page: Page): Promise<void> {
  await sayBridge(page);
  await page.locator(".m-choose__opt").first().click();
  await page.waitForFunction(() => document.querySelectorAll(".m-msg--lyko").length >= 2 && !document.querySelector(".m-caret"), null, { timeout: 30_000 });
  await page.waitForTimeout(800);
}

export const SCENES: readonly Scene[] = [
  { id: "landing", path: "/" },
  { id: "ask-empty", path: "/app" },
  { id: "ask-question", path: "/app", wallet: true, act: sayBridge },
  { id: "ask-plan", path: "/app", wallet: true, act: toPlan },
  {
    id: "ask-signed",
    path: "/app",
    wallet: true,
    act: async (p) => {
      const box = p.locator("textarea").first();
      await box.waitFor({ timeout: 30_000 });
      await box.fill("Show the settled step");
      await box.press("Enter");
      await p.waitForSelector(".m-card2[data-kind='settled']", { timeout: 30_000 });
      await p.waitForTimeout(800);
    },
  },
  {
    id: "route-panel",
    path: "/app",
    wallet: true,
    act: async (p) => {
      await toPlan(p);
      await p.locator(".m-plan__route, [data-action='open-route']").last().click().catch(() => p.getByRole("button", { name: /open the route/iu }).last().click());
      await p.waitForSelector(".m-artifact", { timeout: 15_000 });
      await p.waitForTimeout(800);
    },
  },
  {
    id: "review",
    path: "/app",
    wallet: true,
    act: async (p) => {
      await toPlan(p);
      await p.locator(".m-plan__go").last().click();
      await p.waitForSelector(".rv-dialog .rv-pf", { timeout: 15_000 });
      await p.waitForTimeout(900);
    },
  },
  { id: "review-kit-warn", path: "/app/kit/review?state=preflight-warn" },
  { id: "review-kit-block", path: "/app/kit/review?state=preflight-block" },
  { id: "chat-kit", path: "/app/kit/chat" },
  { id: "fold-flock", path: "/app/fold/flock" },
  { id: "fold-trails", path: "/app/fold/trails" },
  { id: "fold-herding", path: "/app/fold/herding" },
  { id: "fold-pack", path: "/app/fold/pack" },
  { id: "fold-fence", path: "/app/fold/fence" },
  { id: "fold-new-herding", path: "/app/fold/herding", newcomer: true, act: (p) => p.waitForSelector(".fd-newcomer", { timeout: 20_000 }).then(() => undefined) },
  { id: "fold-new-pack", path: "/app/fold/pack", newcomer: true, act: (p) => p.waitForSelector(".fd-newcomer", { timeout: 20_000 }).then(() => undefined) },
  { id: "fold-new-fence", path: "/app/fold/fence", newcomer: true, act: (p) => p.waitForSelector(".fd-newcomer", { timeout: 20_000 }).then(() => undefined) },
  { id: "your-lyko", path: "/app/you" },
  { id: "forge", path: "/forge" },
];

/* ------------------------------------------------------------- the run */

function chromePath(): string | undefined {
  return process.env.CHROME_PATH || undefined;
}

export async function contextFor(browser: Browser, theme: Theme, width: number, wallet: boolean, newcomer: boolean, locale = "en"): Promise<BrowserContext> {
  const phone = width < 700;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: theme === "night" ? "dark" : "light", isMobile: phone, hasTouch: phone });
  await ctx.addInitScript(
    ({ theme: t, testnet }) => {
      try {
        const profile = JSON.parse(localStorage.getItem("lykia.profile") ?? "{}") as Record<string, unknown>;
        localStorage.setItem("lykia.profile", JSON.stringify({ ...profile, theme: t }));
        if (testnet) localStorage.setItem("lykia-ui", JSON.stringify({ state: { theme: "system", motion: "off", mode: "testnet", railCollapsed: false }, version: 1 }));
      } catch {
        /* storage blocked: the default theme stands */
      }
    },
    { theme, testnet: wallet || newcomer },
  );
  // The interface language the page opens in (the picker's stored choice).
  await ctx.addInitScript({ content: `try { localStorage.setItem("lykia.locale", ${JSON.stringify(locale)}); } catch {}` });
  if (wallet || newcomer) await ctx.addInitScript({ content: walletScript(OWNER) });
  if (newcomer) await ctx.addInitScript({ content: `try { localStorage.setItem("lykia.session", ${JSON.stringify(JSON.stringify({ token: "contrast-check", address: OWNER, roles: [], expiresAt: "2099-01-01T00:00:00.000Z" }))}); } catch {}` });
  const turns = { n: 0 };
  await ctx.route(`${API}/**`, (route) => answer(route, turns, newcomer));
  // Nothing leaves the machine: RPCs and other hosts are refused.
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/u, (route) => route.abort());
  return ctx;
}

async function check(page: Page): Promise<{ checked: number; issues: Issue[]; axe: Issue[] }> {
  const own = (await page.evaluate(`(${MEASURE.replace(/^[\s\S]*?(function measureContrast)/u, "$1")})()`)) as { checked: number; issues: Issue[] };
  await page.evaluate(AXE);
  const axe = (await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: Document, o: unknown) => Promise<{ violations: { nodes: { target: string[]; any: { data?: { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string } }[]; html: string }[] }[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] }, resultTypes: ["violations"] });
    return r.violations.flatMap((v) =>
      v.nodes.map((n) => {
        const d = n.any[0]?.data ?? {};
        const text = n.html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 60);
        return { where: n.target.join(" "), text, fg: d.fgColor ?? "?", bg: d.bgColor ?? "?", ratio: d.contrastRatio ?? 0, need: Number.parseFloat(d.expectedContrastRatio ?? "4.5"), same: (d.contrastRatio ?? 0) < 1.2 };
      }),
    );
  })) as Issue[];
  return { ...own, axe };
}

/**
 * At night no large surface may stay light: a card or panel over 200 × 80 px whose own background is light
 * (relative luminance above 0.4) fails, so a cream card on the night floor cannot come back unnoticed.
 */
async function lightSurfaces(page: Page): Promise<Issue[]> {
  // Kept as source text: it runs in the page as written (no bundler helpers).
  return (await page.evaluate(`(() => {
    const ch = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = (r, g, b) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    const out = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (el.closest("svg, canvas, img, picture, video")) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.5) continue;
      const m = /rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([0-9.]+))?\\)/.exec(cs.backgroundColor);
      if (!m) continue;
      const alpha = m[4] === undefined ? 1 : Number(m[4]);
      if (alpha < 0.6) continue;
      const l = lum(Number(m[1]), Number(m[2]), Number(m[3]));
      if (l <= 0.4) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 80) continue;
      const cls = typeof el.className === "string" ? el.className.split(/\\s+/).filter(Boolean).slice(0, 2).join(".") : "";
      out.push({ where: el.tagName.toLowerCase() + (cls ? "." + cls : "") + " " + Math.round(r.width) + "x" + Math.round(r.height), text: (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 50), fg: "", bg: cs.backgroundColor, ratio: l, need: 0.4, same: false });
    }
    return out;
  })()`)) as Issue[];
}

async function main(): Promise<void> {
  const only = process.env.CONTRAST_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const scenes = only ? SCENES.filter((s) => only.includes(s.id)) : SCENES;
  const themes: Theme[] = process.env.CONTRAST_THEMES ? (process.env.CONTRAST_THEMES.split(",") as Theme[]) : ["day", "night"];
  const widths = process.env.CONTRAST_WIDTHS ? process.env.CONTRAST_WIDTHS.split(",").map(Number) : [1440, 390];
  // CONTRAST_LOCALES=all (or a list) checks every interface language: longer French and Portuguese labels, Chinese breaking.
  const rawLocales = process.env.CONTRAST_LOCALES ?? "en";
  const locales = rawLocales === "all" ? ["en", "tr", "es", "pt-BR", "zh-CN", "fr"] : rawLocales.split(",").map((l) => l.trim());
  const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), logLevel: "error", server: { port: 0, strictPort: false, hmr: false } });
  await server.listen();
  const address = server.httpServer?.address();
  const base = `http://localhost:${typeof address === "object" && address ? address.port : 5173}`;
  const exe = chromePath();
  let browser: Browser;
  try {
    browser = await chromium.launch({ ...(exe ? { executablePath: exe } : { channel: "chrome" }), args: ["--no-sandbox"] });
  } catch (error) {
    await server.close();
    console.error(`The contrast check needs Google Chrome, or CHROME_PATH set to a Chromium build.\n${(error as Error).message.split("\n")[0]}`);
    process.exit(1);
  }
  let failures = 0;
  let checked = 0;
  const started = Date.now();
  for (const locale of locales)
  for (const scene of scenes) {
    for (const theme of themes) {
      for (const width of widths) {
        const ctx = await contextFor(browser, theme, width, Boolean(scene.wallet), Boolean(scene.newcomer), locale);
        const page = await ctx.newPage();
        const label = `${locale === "en" ? "" : `${locale} · `}${scene.id} · ${theme} · ${width}`;
        try {
          await page.goto(`${base}${scene.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
          await page.waitForSelector("#main", { timeout: 60_000 });
          await page.waitForTimeout(1500);
          if (scene.act) await scene.act(page);
          const night = await page.evaluate(() => document.documentElement.dataset.night === "on");
          if (night !== (theme === "night")) throw new Error(`the page is in ${night ? "night" : "day"}, expected ${theme}`);
          if (process.env.CONTRAST_SHOTS) await page.screenshot({ path: resolve(process.env.CONTRAST_SHOTS, `${scene.id}-${theme}-${width}.png`) });
          const r = await check(page);
          checked += r.checked;
          const light = theme === "night" ? await lightSurfaces(page) : [];
          const all = [...r.issues.map((i) => ({ ...i, by: "measure" })), ...r.axe.map((i) => ({ ...i, by: "axe" })), ...light.map((i) => ({ ...i, by: "light surface at night" }))];
          if (all.length === 0) console.log(`ok   ${label} (${r.checked} texts)`);
          else {
            failures += all.length;
            console.log(`FAIL ${label}: ${r.issues.length} by measure, ${r.axe.length} by axe, ${light.length} light surfaces`);
            for (const i of all.slice(0, 40)) console.log(i.by === "light surface at night" ? `     LIGHT ${i.ratio.toFixed(2)} > 0.4 ${i.bg} ${i.where} "${i.text}"` : `     ${i.same ? "SAME " : ""}${i.ratio.toFixed(2)} < ${i.need} ${i.fg} on ${i.bg} [${i.by}] ${i.where} "${i.text}"`);
            if (all.length > 40) console.log(`     … and ${all.length - 40} more`);
          }
        } catch (error) {
          failures += 1;
          console.log(`FAIL ${label}: could not render (${(error as Error).message.split("\n")[0]})`);
        } finally {
          await ctx.close();
        }
      }
    }
  }
  await browser.close();
  await server.close();
  console.log(`\n${failures === 0 ? "Contrast check passed" : `Contrast check failed: ${failures} problem${failures === 1 ? "" : "s"}`} · ${scenes.length} screens × ${themes.length} themes × ${widths.length} widths · ${checked} texts measured · ${Math.round((Date.now() - started) / 1000)} s`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
