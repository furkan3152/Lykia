import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const vercel = JSON.parse(readFileSync(`${ROOT}vercel.json`, "utf8")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const html = readFileSync(`${ROOT}index.html`, "utf8");
const csp = (source: string) => vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";

describe("web security headers", () => {
  it("allows every inline script by hash and nothing else inline", () => {
    const policy = csp("/((?!embed/).*)");
    assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/u);
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/gu)) {
      const hash = createHash("sha256").update(m[1]!).digest("base64");
      assert.ok(policy.includes(`'sha256-${hash}'`), "index.html changed an inline script: update the hash in vercel.json");
    }
  });

  it("refuses framing except for the embed", () => {
    assert.match(csp("/((?!embed/).*)"), /frame-ancestors 'none'/u);
    assert.match(csp("/embed/(.*)"), /frame-ancestors https:/u);
    assert.match(csp("/((?!embed/).*)"), /object-src 'none'/u);
  });
});
