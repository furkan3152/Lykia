/**
 * Renders Lykia's main screens through the contrast check's harness (the
 * same fixtures, wallet and scenes) and reads the text a person sees.
 *
 *   PAGES_MODE=count   counts visible text nodes and words per screen
 *   PAGES_MODE=shots   saves screenshots to PAGES_SHOTS
 *
 *   PAGES_ONLY=ask-empty,ask-plan  PAGES_WIDTHS=1440,390  PAGES_LOCALE=tr  PAGES_THEME=night
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "playwright-core";
import { createServer } from "vite";

import { SCENES, contextFor } from "../contrast/run";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const VISIBLE = readFileSync(resolve(here, "visible.js"), "utf8").replace(/^[\s\S]*?(function visibleTexts)/u, "$1");

interface Seen {
  readonly kind: string;
  readonly text: string;
}

async function main(): Promise<void> {
  const mode = process.env.PAGES_MODE ?? "count";
  const only = process.env.PAGES_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const scenes = only ? SCENES.filter((s) => only.includes(s.id)) : SCENES;
  const widths = process.env.PAGES_WIDTHS ? process.env.PAGES_WIDTHS.split(",").map(Number) : [1440, 390];
  const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), logLevel: "error", server: { port: 0, strictPort: false, hmr: false } });
  await server.listen();
  const address = server.httpServer?.address();
  const base = `http://localhost:${typeof address === "object" && address ? address.port : 5173}`;
  const exe = process.env.CHROME_PATH || undefined;
  const browser: Browser = await chromium.launch({ ...(exe ? { executablePath: exe } : { channel: "chrome" }), args: ["--no-sandbox"] });
  let failures = 0;
  for (const scene of scenes) {
    for (const width of widths) {
      const locale = process.env.PAGES_LOCALE ?? "en";
      const theme = (process.env.PAGES_THEME ?? "day") as "day" | "night";
      const ctx = await contextFor(browser, theme, width, Boolean(scene.wallet), Boolean(scene.newcomer), locale);
      const page = await ctx.newPage();
      const label = `${scene.id} · ${width}`;
      try {
        await page.goto(`${base}${scene.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForSelector("#main", { timeout: 60_000 });
        await page.waitForTimeout(1500);
        if (scene.act) await scene.act(page);
        if (mode === "shots" && process.env.PAGES_SHOTS) await page.screenshot({ path: resolve(process.env.PAGES_SHOTS, `${process.env.PAGES_LOCALE ?? "en"}-${scene.id}-${width}${process.env.PAGES_THEME === "night" ? "-night" : ""}.png`), fullPage: false });
        const seen = (await page.evaluate(`(${VISIBLE})()`)) as Seen[];
        const texts = seen.filter((s) => s.kind === "text");
        const words = texts.reduce((n, s) => n + s.text.split(/\s+/u).filter(Boolean).length, 0);
        console.log(`${label.padEnd(28)} ${String(texts.length).padStart(4)} text nodes  ${String(words).padStart(5)} words`);
        if (process.env.PAGES_DUMP) console.log(texts.map((t) => `    | ${t.text}`).join("\n"));
      } catch (error) {
        failures += 1;
        console.log(`FAIL ${label}: could not render (${(error as Error).message.split("\n")[0]})`);
      } finally {
        await ctx.close();
      }
    }
  }
  await browser.close();
  await server.close();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
