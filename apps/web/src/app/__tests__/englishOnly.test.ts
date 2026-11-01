/**
 * The interface is English only. Users may type Turkish to Lyko (the API
 * reads it), but nothing the app renders may be Turkish. Proper nouns of
 * the Lycian coast stay, and the command aliases in lib/commands.ts exist
 * only to understand what people type.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
/** Input-only files: aliases people may type. */
const INPUT_ONLY = new Set(["lib/commands.ts"]);
const PROPER_NOUNS = /Ölüdeniz|Künye|KÜNYE|künye|Kaş|Üçağız|Alınca|Yanartaş|Tahtalı/gu;
const TURKISH_LETTERS = /[şŞğĞıİçÇöÖüÜ]/u;
const TURKISH_WORDS = /\b(?:tekrar|meralar|yavrular|cüzdan|cuzdan|bağlan|kaydet|iptal|ayarlar|yükleniyor|gönder|gonder|köpek|kurtlar|sürü|düdük|koku|çit|hazine|çoban|kuzu|kervan|lütfen|tamam)\b/iu;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : files(path);
    return /\.(?:tsx?|css)$/u.test(name) ? [path] : [];
  });
}

/** String literals, template literal text and JSX text of a source file (comments removed). */
function rendered(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'`])\/\/.*$/gmu, "$1");
  const out: string[] = [];
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/gu)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of code.matchAll(/>([^<>{}\n]+)</gu)) out.push(m[1]!);
  return out;
}

describe("English-only interface", () => {
  it("renders no Turkish text", () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      const rel = relative(SRC, file).replace(/\\/gu, "/");
      if (INPUT_ONLY.has(rel)) continue;
      for (const text of rendered(readFileSync(file, "utf8"))) {
        const clean = text.replace(PROPER_NOUNS, "");
        if (TURKISH_LETTERS.test(clean) || TURKISH_WORDS.test(clean)) offenders.push(`${rel}: ${text.slice(0, 80)}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
