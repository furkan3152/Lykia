import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { BESIDE_ROUTER, PRIMITIVES, USDC_PATH } from "../usdcPath";

const root = new URL("../../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

/** The primitive names in the first column of every markdown table row. */
function tableRows(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => /^\| [^-|]/u.test(line) && !line.startsWith("| Primitive |"))
    .map((line) => line.split("|")[1]!.trim());
}

describe("where USDC and Circle sit in Lykia", () => {
  it("follows one USDC in six stops, the last one optional", () => {
    assert.deepEqual(USDC_PATH.map((s) => s.id), ["wallet", "fence", "simulate", "send", "settle", "out"]);
    assert.deepEqual(USDC_PATH.map((s) => Boolean(s.optional)), [false, false, false, false, false, true]);
    assert.ok(USDC_PATH.find((s) => s.id === "fence")!.line.includes("$1,000 a step, $5,000 a day"));
  });

  it("keeps the README and docs/circle/README.md tables in step with the landing", () => {
    for (const path of ["README.md", "docs/circle/README.md"]) {
      const md = read(path);
      const section = path === "README.md" ? md.slice(md.indexOf("## USDC and Circle in Lykia"), md.indexOf("## Contents")) : md.slice(md.indexOf("## Primitive by primitive"), md.indexOf("## Beside Lykia"));
      assert.deepEqual(tableRows(section), [...PRIMITIVES], path);
    }
  });

  it("never calls Circle Wallets the default", () => {
    const wallets = BESIDE_ROUTER.find((b) => b.primitive === "Circle Wallets")!;
    assert.match(wallets.line, /off by default/u);
  });
});
