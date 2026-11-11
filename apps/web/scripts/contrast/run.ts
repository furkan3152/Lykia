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
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import { createServer } from "vite";

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

type Theme = "day" | "night";

interface Issue {
  readonly where: string;
  readonly text: string;
  readonly fg: string;
  readonly bg: string;
  readonly ratio: number;
  readonly need: number;
  readonly same: boolean;
}

interface Scene {
  readonly id: string;
  readonly path: string;
  /** A browser wallet is connected (testnet). */
  readonly wallet?: boolean;
  /** The wallet is also signed in, and owns nothing yet (the Fold's newcomer states). */
  readonly newcomer?: boolean;
  readonly act?: (page: Page) => Promise<void>;
}

/* ------------------------------------------------------------- the API */

const plan = bridgePlan();
const sse = (events: readonly (readonly [string, unknown])[]) => `retry: 3000\n\n${events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("")}`;

/** First turn: the plan and the question Lyko asks about gas. Every later turn: the plan alone. */
function chatTurn(n: number): string {
  const threadId = "thr_contrast";
  return sse([
    ["thread", { threadId, mode: "llm" }],
    ["step", { id: "s1", kind: "intent", label: "Reading your request", state: "ok", result: "1 action: bridge", ms: 21 }],
    ["step", { id: "s2", kind: "route", label: "Searching routes", state: "ok", result: "cctp · 1 step", ms: 640 }],
    ["step", { id: "s3", kind: "fence", label: "Checking your Fence", state: "ok", result: "Confirm", ms: 2 }],
    ["block", { kind: "fence", decision: "confirm", rules: plan.graph.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => ({ rule: r.rule, message: r.message })), headroom: [{ label: "Per step", value: "$1000" }, { label: "Per day", value: "$5000" }] }],
    ["proposal", plan.proposal],
    ...(n === 0 ? ([["clarify", plan.clarify]] as const) : []),
    ["text", { text: n === 0 ? "Bridging all of it leaves nothing on Arc to pay gas with." : plan.text }],
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
  const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (newcomer && path in EMPTY) return json(EMPTY[path]);
  if (path === "/v1/agent/chat") return route.fulfill({ status: 200, contentType: "text/event-stream", body: chatTurn(turns.n++) });
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

async function say(page: Page, text: string): Promise<void> {
  const box = page.locator("textarea").first();
  await box.waitFor({ timeout: 30_000 });
  await box.fill(text);
  await box.press("Enter");
  await page.waitForSelector(".m-msg--lyko .m-card2[data-kind='route']", { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function toPlan(page: Page): Promise<void> {
  await say(page, "Bridge 1 USDC to Base");
  await page.locator(".m-choose__opt").first().click();
  await page.waitForFunction(() => document.querySelectorAll(".m-msg--lyko").length >= 2 && !document.querySelector(".m-caret"), null, { timeout: 30_000 });
  await page.waitForTimeout(800);
}

export const SCENES: readonly Scene[] = [
  { id: "landing", path: "/" },
  { id: "ask-empty", path: "/app" },
  { id: "ask-question", path: "/app", wallet: true, act: (p) => say(p, "Bridge 1 USDC to Base") },
  { id: "ask-plan", path: "/app", wallet: true, act: toPlan },
  {
    id: "route-panel",
    path: "/app",
    wallet: true,
    act: async (p) => {
      await toPlan(p);
      await p.getByRole("button", { name: /open the route/iu }).last().click();
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
      await p.getByRole("button", { name: /review and sign/iu }).last().click();
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

async function contextFor(browser: Browser, theme: Theme, width: number, wallet: boolean, newcomer: boolean): Promise<BrowserContext> {
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

async function main(): Promise<void> {
  const only = process.env.CONTRAST_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const scenes = only ? SCENES.filter((s) => only.includes(s.id)) : SCENES;
  const themes: Theme[] = process.env.CONTRAST_THEMES ? (process.env.CONTRAST_THEMES.split(",") as Theme[]) : ["day", "night"];
  const widths = process.env.CONTRAST_WIDTHS ? process.env.CONTRAST_WIDTHS.split(",").map(Number) : [1440, 390];
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
  for (const scene of scenes) {
    for (const theme of themes) {
      for (const width of widths) {
        const ctx = await contextFor(browser, theme, width, Boolean(scene.wallet), Boolean(scene.newcomer));
        const page = await ctx.newPage();
        const label = `${scene.id} · ${theme} · ${width}`;
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
          const all = [...r.issues.map((i) => ({ ...i, by: "measure" })), ...r.axe.map((i) => ({ ...i, by: "axe" }))];
          if (all.length === 0) console.log(`ok   ${label} (${r.checked} texts)`);
          else {
            failures += all.length;
            console.log(`FAIL ${label}: ${r.issues.length} by measure, ${r.axe.length} by axe`);
            for (const i of all.slice(0, 40)) console.log(`     ${i.same ? "SAME " : ""}${i.ratio.toFixed(2)} < ${i.need} ${i.fg} on ${i.bg} [${i.by}] ${i.where} "${i.text}"`);
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

void main();
