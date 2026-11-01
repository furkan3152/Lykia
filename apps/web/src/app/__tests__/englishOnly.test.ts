/**
 * The interface and the whole repository are English only. Every tracked
 * text file is checked for Turkish-specific letters and a few transliterated
 * Turkish words, and so is the shared lore the app renders. The letters and
 * words are written as Unicode escapes on purpose.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { EASTER_EGGS, GLOSSARY, LYCIAN_WAY, LYKO_LINES, ROLE_TEMPLATES } from "@lykia/core";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/** Letters used by Turkish and not by English: c-cedilla, g-breve, dotless i, s-cedilla, o/u-umlaut and their capitals (with dotted capital I). */
const TURKISH_LETTERS = /[\u00e7\u011f\u0131\u015f\u00f6\u00fc\u00c7\u011e\u0130\u015e\u00d6\u00dc]/u;
/** Transliterated Turkish words (product words, place names and common verbs from older copy). */
const WORDS = [
  "\u006b\u0075\u006e\u0079\u0065",
  "\u006b\u0061\u006e\u0067\u0061\u006c",
  "\u006c\u0069\u006b\u0079\u0061",
  "\u0068\u0061\u007a\u0069\u006e\u0065\u0064\u0061\u0072",
  "\u0064\u0075\u0064\u0075\u006b",
  "\u0067\u006f\u006e\u0064\u0065\u0072",
  "\u0079\u0061\u0074\u0069\u0072",
  "\u0063\u0075\u007a\u0064\u0061\u006e",
  "\u0074\u0065\u006b\u0072\u0061\u0072",
  "\u006b\u0061\u0072\u0061\u0062\u0061\u0073",
  "\u006e\u006f\u0062\u0065\u0074\u0063\u0069",
  "\u006f\u006c\u0075\u0064\u0065\u006e\u0069\u007a",
  "\u0066\u0061\u0072\u0061\u006c\u0079\u0061",
  "\u0075\u0063\u0061\u0067\u0069\u007a",
  "\u0079\u0061\u006e\u0061\u0072\u0074\u0061\u0073",
  "\u0074\u0061\u0068\u0074\u0061\u006c\u0069",
  "\u006b\u0065\u0072\u0076\u0061\u006e",
  "\u006d\u0065\u0072\u0061\u006c\u0061\u0072",
  "\u0079\u0061\u0076\u0072\u0075\u006c\u0061\u0072",
  "\u0062\u006f\u0072\u0064\u0072\u006f",
  "\u0066\u0061\u0074\u0075\u0072\u0061",
  "\u0061\u0064\u0072\u0065\u0073\u0069\u006e\u0065",
  "\u0068\u0065\u0070\u0073\u0069\u006e\u0069",
  "\u006c\u0075\u0074\u0066\u0065\u006e",
];
const TURKISH_WORDS = new RegExp(`\\b(?:${WORDS.join("|")})\\b`, "iu");

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", "artifacts", "cache", "typechain-types", ".vercel", ".turbo", "playwright-report", "test-results"]);
const LOCKFILE = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/u;
const BINARY = /\.(?:png|jpe?g|gif|webp|ico|bmp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp3|mp4|webm|wasm)$/iu;

/** Tracked files (git), or every file outside build and dependency folders when git is not available. */
function trackedFiles(): string[] {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean);
  } catch {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (!SKIP_DIRS.has(name)) walk(path);
        } else out.push(relative(ROOT, path).replace(/\\/gu, "/"));
      }
    };
    walk(ROOT);
    return out;
  }
}

/** Lines that may hold non-English letters for a reason other than language. */
function exempt(file: string, line: string): boolean {
  // The owner's name in the copyright line of a licence.
  if (/(?:^|\/)LICENSE(?:\.\w+)?$/u.test(file) && /^\s*Copyright\b/iu.test(line)) return true;
  // The Cyrillic and Greek look-alike table used to catch spoofed tickers and addresses.
  if (file === "packages/core/src/assets.ts" && /^\s*(?:"[^ -~]": "[A-Za-z0-9]",\s*)+$/u.test(line)) return true;
  return false;
}

function offenders(): string[] {
  const found: string[] = [];
  for (const file of trackedFiles()) {
    if (LOCKFILE.test(file) || BINARY.test(file) || file.split("/").some((part) => part === "node_modules")) continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    text.split("\n").forEach((line, i) => {
      if ((TURKISH_LETTERS.test(line) || TURKISH_WORDS.test(line)) && !exempt(file, line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

describe("English only", () => {
  it("every tracked text file is English only", () => {
    assert.deepEqual(offenders(), []);
  });

  it("the shared lore and role names the app renders are English only", () => {
    const strings = [
      ...LYCIAN_WAY.flatMap((w) => [w.name, w.note]),
      ...Object.values(EASTER_EGGS).map((e) => e.line),
      ...Object.keys(EASTER_EGGS),
      ...Object.values(GLOSSARY).flatMap((g) => [g.en, g.what]),
      ...Object.values(LYKO_LINES),
      ...Object.values(ROLE_TEMPLATES).map((r) => r.title.en),
    ];
    assert.deepEqual(strings.filter((t) => TURKISH_LETTERS.test(t) || TURKISH_WORDS.test(t)), []);
  });
});
