import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { firstSentence, inlineText, parseInline, parseMarkdown, safeHref, type Block } from "../richText";

const ADDR = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f";
const TX = "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

async function render(text: string): Promise<string> {
  // The web build compiles JSX automatically; node tests use the classic transform, which reads React from the global scope.
  (globalThis as { React?: unknown }).React = React;
  const { Markdown } = await import("../Markdown");
  return renderToStaticMarkup(React.createElement(Markdown, { text, environment: "mainnet", lead: true }));
}

describe("markdown parser", () => {
  it("reads the owner's example without leaving a single asterisk", () => {
    const blocks = parseMarkdown("**Your gas is low.**\n\n- **Why it matters:** Arc pays gas in USDC.\n- **Next:** top up 0.5 USDC.");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.t, "p");
    const p = blocks[0] as Extract<Block, { t: "p" }>;
    assert.equal(p.c[0]!.t, "strong");
    const list = blocks[1] as Extract<Block, { t: "ul" }>;
    assert.equal(list.t, "ul");
    assert.equal(list.items.length, 2);
    assert.equal(list.items[0]![0]!.t, "strong");
    assert.ok(!JSON.stringify(blocks).includes("**"));
  });

  it("supports italics, inline code, numbered lists and small headings", () => {
    const blocks = parseMarkdown("## Plan\n1. *first* step\n2. run `npm test`\n\nsnake_case_names stay text");
    assert.deepEqual(blocks.map((b) => b.t), ["h", "ol", "p"]);
    const ol = blocks[1] as Extract<Block, { t: "ol" }>;
    assert.equal(ol.items[0]![0]!.t, "em");
    assert.deepEqual(ol.items[1]!.map((n) => n.t), ["text", "code"]);
    assert.equal(inlineText((blocks[2] as Extract<Block, { t: "p" }>).c), "snake_case_names stay text");
  });

  it("keeps unclosed markers as text", () => {
    assert.equal(inlineText(parseInline("2 * 3 = 6 and **open")), "2 * 3 = 6 and **open");
    assert.equal(inlineText(parseInline("`not closed")), "`not closed");
  });

  it("turns addresses and transaction hashes into chips, amounts into figures, -> into an arrow", () => {
    const nodes = parseInline(`Send 1,250.50 USDC to ${ADDR} -> done in ${TX}, about $3.20`);
    const kinds = nodes.map((n) => n.t);
    assert.ok(kinds.includes("address"));
    assert.ok(kinds.includes("tx"));
    const amounts = nodes.filter((n) => n.t === "amount");
    assert.deepEqual(amounts, [{ t: "amount", v: "1,250.50", unit: "USDC" }, { t: "amount", v: "3.20", unit: "$" }]);
    assert.ok(inlineText(nodes).includes(" → "));
    const tx = nodes.find((n) => n.t === "tx");
    assert.equal(tx && "v" in tx ? tx.v : "", TX, "a 64-hex hash is never cut into an address");
  });

  it("follows only http(s) links and in-app paths", () => {
    assert.equal(safeHref("https://explorer.arc.io/tx/0xabc"), "https://explorer.arc.io/tx/0xabc");
    assert.equal(safeHref("/app/fold/fence"), "/app/fold/fence");
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "//evil.example/x", "vbscript:x", " java\tscript:x"]) assert.equal(safeHref(bad), null, bad);
    const nodes = parseInline("[click](javascript:alert(1)) and [docs](https://example.com/a)");
    assert.equal(nodes[0]!.t, "text", "an unsafe link keeps only its label");
    assert.ok(nodes.some((n) => n.t === "link" && n.href === "https://example.com/a"));
  });

  it("finds the verdict line", () => {
    assert.equal(firstSentence("**Gas is low: 0.04 USDC.** Then more.\n\n- x"), "Gas is low: 0.04 USDC.");
    assert.equal(firstSentence("1 USDC buys 0.8889 EURC at the reference rate. Source: Chainlink."), "1 USDC buys 0.8889 EURC at the reference rate.");
    assert.equal(firstSentence("x".repeat(300)).length, 140);
  });
});

describe("markdown renderer", () => {
  it("never injects HTML from the text", async () => {
    const hostile = [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "**<b>bold</b>** and <iframe src=//evil></iframe>",
      "[x](javascript:alert(1))",
      '[x](https://ok.example/" onmouseover="alert(1))',
      "`<svg onload=alert(1)>`",
    ].join("\n\n");
    const html = await render(hostile);
    for (const tag of ["<script", "<img", "<iframe", "<b>", "<svg onload"]) assert.ok(!html.includes(tag), `${tag} leaked`);
    assert.ok(!/href="javascript:/iu.test(html));
    // Text is escaped, so every "<" left in the output opens a real element: none of them may carry an event handler.
    assert.ok(!/<[a-z][^>]*\son[a-z]+=/iu.test(html), "no event handler attributes");
    assert.ok(html.includes("&lt;script&gt;"), "markup stays visible as text");
  });

  it("draws the verdict line, lists, chips and figures", async () => {
    const html = await render(`Gas is low: 0.04 USDC.\n\n- **Short by:** 0.46 USDC\n- Top up ${ADDR}`);
    assert.match(html, /class="m-md__p m-md__lead"/u);
    assert.match(html, /<ul class="m-md__ul">/u);
    assert.match(html, /class="m-fig">0\.46<small>USDC<\/small>/u);
    assert.match(html, new RegExp(`href="https://explorer\\.arc\\.io/address/${ADDR}"`, "u"));
    assert.match(html, /aria-label="Copy address"/u);
    assert.ok(!html.includes("**"));
  });
});
