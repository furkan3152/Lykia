// The product language is English: READMEs and docs may describe Turkish input
// support, but they must not use the old Turkish product words or place names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BANNED = /\b(?:k[üu]nye|çit|düdük|sürü|koku|ağıl|ölüdeniz|faralya|kabak|alınca|kalkan|kaş|üçağız|yanartaş|tahtalı|kangal|likya|hazinedar|kuzu|çoban|kervan)\b/iu;

function docs() {
  const out = ["README.md", "apps/api/README.md", "apps/web/README.md", "packages/sdk/README.md", "packages/contracts/README.md", "packages/contracts/SECURITY.md"].map((f) => join(ROOT, f)).filter(existsSync);
  for (const name of readdirSync(join(ROOT, "docs"))) if (name.endsWith(".md")) out.push(join(ROOT, "docs", name));
  return out;
}

test("docs and READMEs use English product words only", () => {
  const offenders = [];
  for (const file of docs()) {
    let inCode = false;
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      // Fenced code shows source layout and identifiers, not product copy.
      if (line.trim().startsWith("```")) inCode = !inCode;
      if (inCode) return;
      // `/v1/kunye` routes stay documented as deprecated aliases.
      const text = line.replace(/\/v1\/kunye[^\s)`]*/gu, "").replace(/\/app\/kunye[^\s)`]*/gu, "");
      if (BANNED.test(text)) offenders.push(`${file.slice(ROOT.length)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, []);
});
