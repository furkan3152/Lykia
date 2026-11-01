// Checks the example page against the embed package: real element names, valid attributes, one script tag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMBED_ROUTES, appearanceParams } from "@lykia/embed/protocol";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the page loads the embed with one module script tag", () => {
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/gu)].map((m) => m[1]);
  assert.deepEqual(scripts, ["https://unpkg.com/@lykia/embed"]);
  assert.match(html, /<script type="module" src="https:\/\/unpkg.com\/@lykia\/embed">/u);
});

test("every element is a real Lykia element with a project and valid appearance", () => {
  const tags = [...html.matchAll(/<(lykia-[a-z]+)([^>]*)>/gu)];
  assert.ok(tags.length >= 2);
  for (const [, tag, attrs] of tags) {
    assert.ok(tag in EMBED_ROUTES, tag);
    const get = (name) => new RegExp(`\\s${name}="([^"]*)"`, "u").exec(attrs)?.[1] ?? null;
    assert.match(get("project"), /^prj_[a-z0-9]+$/u);
    assert.ok(!(get("key") ?? "").startsWith("lk_sk_"), "never a secret key in a page");
    for (const name of ["primary", "scheme", "radius"]) if (get(name) !== null) assert.ok(name in appearanceParams(get), `${tag} ${name}`);
  }
});
