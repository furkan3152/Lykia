import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/*
 * Ask Lyko's layout rules, kept from drifting:
 * - the bay scrolls with the conversation, so it never sits over a message;
 * - the conversation's height leaves exactly the phone's bottom bar free;
 * - pixel caps (.m-kick) carry short labels only; longer notes use the body face;
 * - gaps in the Ask first screen come from the spacing scale.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
const askPage = read("pages/ask/AskPage.tsx");
const chat = read("styles/chat.css");
const nav = read("styles/nav.css");
const mosaic = read("styles/mosaic.css");

describe("Ask Lyko layout", () => {
  it("lays the scene strip inside the scrolling conversation", () => {
    const scroll = askPage.indexOf('className="m-convo__scroll"');
    const scene = askPage.indexOf('className="m-convo__scene"');
    const col = askPage.indexOf('className="m-convo__col"');
    assert.ok(scroll > 0 && scene > scroll && col > scene, "the scene must open inside .m-convo__scroll, before the message column");
  });

  it("sizes the conversation to the phone's bottom bar", () => {
    const dock = nav.match(/--mdock-h:\s*(\d+)px/);
    assert.ok(dock, "nav.css defines the bottom bar height");
    assert.match(nav, /\.m-dock\s*{[^}]*height:\s*calc\(var\(--mdock-h\)/, "the bottom bar takes that height");
    const heights = [...chat.matchAll(/\.m-chat, \.m-chat--artifact \{ height: ([^;]+);/g)].map((m) => m[1] ?? "");
    assert.ok(heights.length >= 2, "phone and tablet heights are set");
    for (const h of heights) assert.match(h, /var\(--mdock-h\)/, `height ${h} must subtract the bottom bar`);
  });

  it("keeps pixel caps to short labels", () => {
    for (const file of ["pages/ask/AskPage.tsx", "features/ask/Starters.tsx", "features/ask/Composer.tsx"]) {
      for (const m of read(file).matchAll(/className="m-kick[^"]*">\{"([^"]+)"\}/g)) {
        const words = (m[1] ?? "").split(/[\s·]+/).filter(Boolean);
        assert.ok(words.length <= 4, `${file}: "${m[1]}" is too long for pixel caps; use the body face`);
      }
    }
  });

  it("takes the first screen's gaps from the spacing scale", () => {
    for (const k of [1, 2, 3, 4, 5, 6]) assert.match(mosaic, new RegExp(`--sp-${k}:\\s*\\d+px`));
    const start = chat.indexOf("Ask Lyko: the first screen");
    assert.ok(start > 0);
    const rules = chat.slice(start).match(/\bgap:\s*[^;]+;/g) ?? [];
    assert.ok(rules.length > 10);
    for (const g of rules) assert.match(g, /var\(--sp-\d\)/, `"${g}" should use the spacing scale`);
  });
});
