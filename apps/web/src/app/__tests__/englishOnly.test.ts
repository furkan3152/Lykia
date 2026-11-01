/**
 * The interface is English only. Users may type Turkish to Lyko (the API
 * reads it), but nothing the app renders may be Turkish, including the old
 * product words (Künye, Çit, Düdük...) and Turkish place names. The command
 * aliases in lib/commands.ts exist only to understand what people type, and
 * the /app/kunye redirect keeps old links working.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EASTER_EGGS, GLOSSARY, LYCIAN_WAY, LYKO_LINES, ROLE_TEMPLATES } from "@lykia/core";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
/** Input-only files: aliases people may type. */
const INPUT_ONLY = new Set(["lib/commands.ts"]);
/** Files that must name the old /app/kunye path so old links redirect. */
const ALIAS_FILES = new Set(["app/routes/routeTable.ts", "pages/redirect/TagRedirectPage.tsx"]);
/** Old Turkish product words and place names; none may be rendered. */
const BANNED = /\b(?:k[üu]nye|[çc]it|d[üu]d[üu]k|s[üu]r[üu]|koku|a[ğg][ıi]l|[öo]l[üu]deniz|faralya|kabak|al[ıi]nca|kalkan|ka[şs]|[üu][çc]a[ğg][ıi]z|yanarta[şs]|tahtal[ıi]|kangal|likya|hazinedar)\b/iu;
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
        const banned = BANNED.test(text) && !(ALIAS_FILES.has(rel) && /\/app\/kunye/u.test(text) && !BANNED.test(text.replace(/\/app\/kunye/gu, "")));
        if (TURKISH_LETTERS.test(text) || TURKISH_WORDS.test(text) || banned) offenders.push(`${rel}: ${text.slice(0, 80)}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("renders no Turkish from the shared lore and role names", () => {
    const strings = [
      ...LYCIAN_WAY.flatMap((w) => [w.name, w.note]),
      ...Object.values(EASTER_EGGS).map((e) => e.line),
      ...Object.keys(EASTER_EGGS),
      ...Object.values(GLOSSARY).flatMap((g) => [g.en, g.what]),
      ...Object.values(LYKO_LINES).map((l) => l.en),
      ...Object.values(ROLE_TEMPLATES).map((r) => r.title.en),
    ];
    const offenders = strings.filter((t) => TURKISH_LETTERS.test(t) || TURKISH_WORDS.test(t) || BANNED.test(t));
    assert.deepEqual(offenders, []);
  });
});
