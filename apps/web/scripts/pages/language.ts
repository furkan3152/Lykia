/**
 * The rendered-page language check: opens Lykia's screens in every
 * interface language (Ask empty, a question, a plan with its warning, the
 * review modal, every Fold tab, Your Lyko, The Forge's first screen and the
 * landing page) and reads every visible text node, aria-label and title. A
 * node in another language than the page's fails the check; brand, token
 * and chain names, code and figures are set aside by the shared detector
 * (@lykia/core/i18n/check). The harness answers in the page's language the
 * way the API does (Accept-Language), so API-written text on the page is read
 * too; only the owner's own sentences are set aside, and every page must
 * have asked the API in its language.
 *
 *   npm run languages -w @lykia/web                    every language
 *   LANG_LOCALES=tr,fr LANG_ONLY=ask-plan LANG_WIDTHS=390
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "playwright-core";
import { createServer } from "vite";

import { otherLanguageIn } from "@lykia/core/i18n/check";
import type { Locale } from "@lykia/core";
import { ASKED_LOCALES, OWNER_SAYS, SCENES, contextFor } from "../contrast/run";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const VISIBLE = readFileSync(resolve(here, "visible.js"), "utf8").replace(/^[\s\S]*?(function visibleTexts)/u, "$1");
/** The owner's own sentences the harness types (the owner may write in any language). */
const OWNER_WORDS = [...Object.values(OWNER_SAYS), "Show the settled step"];
const SCREENS = ["landing", "ask-empty", "ask-question", "ask-plan", "review", "fold-flock", "fold-trails", "fold-herding", "fold-pack", "fold-fence", "your-lyko", "forge"];

interface Seen {
  readonly kind: string;
  readonly text: string;
}

const fromFixture = (text: string) => OWNER_WORDS.some((f) => text === f || text.startsWith(f) || text.endsWith(f));

async function main(): Promise<void> {
  const locales = (process.env.LANG_LOCALES ?? "en,tr,es,pt-BR,zh-CN,fr").split(",").map((l) => l.trim()) as Locale[];
  const only = process.env.LANG_ONLY?.split(",").map((s) => s.trim()).filter(Boolean) ?? SCREENS;
  const scenes = SCENES.filter((s) => only.includes(s.id));
  const widths = process.env.LANG_WIDTHS ? process.env.LANG_WIDTHS.split(",").map(Number) : [1440];
  const server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), logLevel: "error", server: { port: 0, strictPort: false, hmr: false } });
  await server.listen();
  const address = server.httpServer?.address();
  const base = `http://localhost:${typeof address === "object" && address ? address.port : 5173}`;
  const exe = process.env.CHROME_PATH || undefined;
  const browser: Browser = await chromium.launch({ ...(exe ? { executablePath: exe } : { channel: "chrome" }), args: ["--no-sandbox"] });
  let failures = 0;
  let nodes = 0;
  for (const locale of locales) {
    for (const scene of scenes) {
      for (const width of widths) {
        const ctx = await contextFor(browser, "day", width, Boolean(scene.wallet), Boolean(scene.newcomer), locale);
        const page = await ctx.newPage();
        const label = `${locale} · ${scene.id} · ${width}`;
        try {
          await page.goto(`${base}${scene.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
          await page.waitForSelector("#main", { timeout: 60_000 });
          await page.waitForTimeout(1500);
          if (scene.act) await scene.act(page);
          const lang = await page.evaluate(() => document.documentElement.lang);
          const seen = (await page.evaluate(`(${VISIBLE})()`)) as Seen[];
          nodes += seen.length;
          const wrong = seen.filter((s) => !fromFixture(s.text)).map((s) => ({ s, f: otherLanguageIn(s.text, locale) })).filter((x) => x.f !== null);
          const bad = lang !== locale ? 1 : 0;
          if (bad || wrong.length > 0) {
            failures += 1;
            console.log(`FAIL ${label}${bad ? ` (html lang is "${lang}")` : ""}`);
            for (const w of wrong.slice(0, 12)) console.log(`    [${w.f!.words.join(", ")}] ${w.s.kind}: ${w.s.text.slice(0, 110)}`);
          } else console.log(`ok   ${label} · ${seen.length} texts`);
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
  // The API must have been asked in every language the run opened (Accept-Language reached the server).
  const unasked = locales.filter((l) => !ASKED_LOCALES.has(l));
  if (unasked.length > 0) {
    failures += unasked.length;
    console.log(`FAIL the API was never asked in ${unasked.join(", ")}`);
  } else console.log(`API asked in: ${[...ASKED_LOCALES].join(", ")}`);
  console.log(failures === 0 ? `Language check passed · ${nodes} texts in ${locales.length} languages` : `Language check: ${failures} screens with another language's words`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
