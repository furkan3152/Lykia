/**
 * Catalogue completeness: every English key exists in every language, no
 * value is empty, parameters match, the message syntax parses, and nothing
 * is left identical to English unless it is a brand, token, code or unit,
 * or a word the language really shares (listed in identical.json, reviewed
 * per language).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LOCALES } from "../locales";
import en from "../messages/en";
import es from "../messages/es";
import fr from "../messages/fr";
import ptBR from "../messages/pt-BR";
import tr from "../messages/tr";
import zhCN from "../messages/zh-CN";
import { wordsLeft } from "./words";

const CATALOGUES: Readonly<Record<string, Readonly<Record<string, string>>>> = { tr, es, "pt-BR": ptBR, "zh-CN": zhCN, fr };
const ALLOWED: Readonly<Record<string, readonly string[]>> = JSON.parse(readFileSync(new URL("../identical.json", import.meta.url), "utf8"));

/** The parameter names a message uses, sorted. Plural and select bodies are read as text. */
function params(text: string): string[] {
  const names = new Set<string>();
  const walk = (body: string): void => {
    let i = 0;
    while (i < body.length) {
      if (body[i] !== "{") {
        i += 1;
        continue;
      }
      const end = closeOf(body, i);
      const inner = body.slice(i + 1, end);
      const head = /^\s*([A-Za-z_]\w*)\s*(?:,\s*(plural|select|selectordinal)\s*,)?/u.exec(inner);
      if (head) {
        names.add(head[1]!);
        if (head[2]) {
          const rest = inner.slice(head[0].length);
          let j = 0;
          while (j < rest.length) {
            if (rest[j] === "{") {
              const close = closeOf(rest, j);
              walk(rest.slice(j + 1, close));
              j = close + 1;
            } else j += 1;
          }
        }
      }
      i = end + 1;
    }
  };
  walk(text);
  return [...names].sort();
}

function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return text.length;
}

/** True when braces balance (the ICU subset nests them). */
function balanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth += 1;
    else if (ch === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

describe("translation catalogues", () => {
  it("cover every language the picker offers", () => {
    assert.deepEqual([...LOCALES].filter((l) => l !== "en").sort(), Object.keys(CATALOGUES).sort());
  });

  for (const [lang, cat] of Object.entries(CATALOGUES)) {
    describe(lang, () => {
      it("has every English key and no extra key", () => {
        assert.deepEqual(Object.keys(en).filter((k) => !(k in cat)), []);
        assert.deepEqual(Object.keys(cat).filter((k) => !(k in en)), []);
      });
      it("has no empty value", () => {
        assert.deepEqual(Object.entries(cat).filter(([k, v]) => !v.trim() && (en as Record<string, string>)[k]!.trim()).map(([k]) => k), []);
      });
      it("uses the same parameters as English, with balanced message syntax", () => {
        const bad = Object.entries(cat)
          .filter(([k, v]) => !balanced(v) || params(v).join() !== params((en as Record<string, string>)[k]!).join())
          .map(([k]) => k);
        assert.deepEqual(bad, []);
      });
      it("leaves nothing identical to English beyond names, code and reviewed words", () => {
        const allowed = new Set(ALLOWED[lang] ?? []);
        const leftovers = Object.entries(cat)
          .filter(([k, v]) => v === (en as Record<string, string>)[k] && wordsLeft(v) && !allowed.has(v))
          .map(([k, v]) => `${k}: ${v}`);
        assert.deepEqual(leftovers, []);
      });
    });
  }
});
