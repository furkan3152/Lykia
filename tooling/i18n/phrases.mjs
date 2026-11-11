/**
 * Core and API phrases: every English sentence passed to tx(), txIn() or
 * phrase() (or a local alias of tx) in packages/core/src and apps/api/src.
 * The English is the key; each language's core catalogue
 * (packages/core/src/i18n/<lang>.ts) must translate every one.
 *
 *   node tooling/i18n/phrases.mjs          check every language, exit 1 on a gap
 *   node tooling/i18n/phrases.mjs --list   print the phrases
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { root, sourceFiles, ts } from "./strings.mjs";

const LANGS = ["tr", "es", "pt-BR", "zh-CN", "fr"];

export function phrases(roots = ["apps/api/src", "packages/core/src"]) {
  const out = new Map();
  for (const file of sourceFiles(roots)) {
    if (/__tests__|\/test\/|\/i18n\/messages\/|\/evals\/|packages\/core\/src\/i18n\//u.test(file)) continue;
    const src = readFileSync(file, "utf8");
    if (!/\b(?:tx|phrase|txIn)\b/u.test(src)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const names = new Set(["tx", "phrase", "txIn", ...[...src.matchAll(/\btx as (\w+)/gu)].map((m) => m[1])]);
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text)) {
        const a = n.expression.text === "txIn" ? n.arguments[1] : n.arguments[0];
        if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && !out.has(a.text)) out.set(a.text, relative(root, file));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** A language's catalogue, read from its source file (English phrase → translation). */
function catalogue(lang) {
  const src = readFileSync(join(root, `packages/core/src/i18n/${lang}.ts`), "utf8");
  const out = new Map();
  for (const m of src.matchAll(/^\s*("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*"),$/gmu)) out.set(JSON.parse(m[1]), JSON.parse(m[2]));
  return out;
}

/** The parameter names of an ICU message: "{name}" and the selector of "{n, plural, …}", not the words inside its branches. */
function params(text) {
  const out = new Set();
  const close = (t, open) => {
    let depth = 0;
    for (let i = open; i < t.length; i++) {
      if (t[i] === "{") depth++;
      else if (t[i] === "}" && --depth === 0) return i;
    }
    return -1;
  };
  const walk = (t) => {
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== "{") continue;
      const end = close(t, i);
      if (end < 0) return;
      const inner = t.slice(i + 1, end);
      const comma = inner.indexOf(",");
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      if (/^[A-Za-z_]\w*$/u.test(name)) out.add(name);
      if (comma >= 0) {
        const rest = inner.slice(comma + 1);
        const body = rest.slice(rest.indexOf(",") + 1);
        for (let j = 0; j < body.length; j++) {
          if (body[j] !== "{") continue;
          const e = close(body, j);
          if (e < 0) break;
          walk(body.slice(j + 1, e));
          j = e;
        }
      }
      i = end;
    }
  };
  walk(text);
  return out;
}

if (process.argv[1]?.endsWith("phrases.mjs")) {
  const all = phrases();
  if (process.argv.includes("--list")) for (const p of all.keys()) console.log(JSON.stringify(p));
  const problems = [];
  for (const lang of LANGS) {
    const cat = catalogue(lang);
    for (const [english, file] of all) {
      const shown = cat.get(english);
      if (shown === undefined || shown.trim() === "" && english.trim() !== "") problems.push(`${lang}: missing ${JSON.stringify(english.slice(0, 70))} (${file})`);
      else {
        // A translation may drop a plural selector it does not need (Chinese), never add a parameter.
        const extra = [...params(shown)].filter((p) => !params(english).has(p));
        if (extra.length > 0) problems.push(`${lang}: unknown parameter ${extra.join(", ")} in ${JSON.stringify(english.slice(0, 70))}`);
      }
    }
  }
  for (const p of problems.slice(0, 40)) console.log(p);
  console.log(problems.length === 0 ? `Core phrase catalogues complete · ${all.size} phrases × ${LANGS.length} languages` : `Core phrase catalogues: ${problems.length} gaps`);
  process.exit(problems.length === 0 ? 0 : 1);
}
