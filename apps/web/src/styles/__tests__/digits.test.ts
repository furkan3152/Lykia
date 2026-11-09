import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/*
 * Figures must never be misread: in the pixel faces a "5" or "2" can look like
 * an "8". fonts.css maps the digits of every pixel face to JetBrains Mono.
 * These checks keep that mapping complete when a face or weight is added.
 */
const STYLES = join(dirname(fileURLToPath(import.meta.url)), "..");
const PIXEL_FACES = ["Pixelify Sans", "Silkscreen"];
const fonts = readFileSync(join(STYLES, "fonts.css"), "utf8");

function faces(css: string) {
  return [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => {
    const body = m[1] ?? "";
    const pick = (k: string) => body.match(new RegExp(`${k}\\s*:\\s*([^;]+);`))?.[1]?.trim() ?? "";
    return { family: pick("font-family").replace(/["']/g, ""), weight: pick("font-weight"), range: pick("unicode-range"), src: pick("src") };
  });
}

/** Weights imported from @fontsource for a face, e.g. "@fontsource/pixelify-sans/500.css" -> 500. */
function importedWeights(slug: string): string[] {
  return [...fonts.matchAll(new RegExp(`@import\\s+"@fontsource/${slug}/(\\d+)\\.css"`, "g"))].map((m) => m[1] ?? "");
}

describe("unambiguous digits", () => {
  const digitFaces = faces(fonts).filter((f) => f.range === "U+0030-0039");

  it("covers every imported weight of every pixel face with JetBrains Mono digits", () => {
    for (const family of PIXEL_FACES) {
      const slug = family.toLowerCase().replace(/\s+/g, "-");
      const weights = importedWeights(slug);
      assert.ok(weights.length > 0, `${family} is imported`);
      for (const weight of weights) {
        const face = digitFaces.find((f) => f.family === family && f.weight === weight);
        assert.ok(face, `${family} ${weight} has a digit face`);
        assert.match(face.src, /jetbrains-mono/);
      }
    }
  });

  it("declares the digit faces after the imports, so they win for 0-9", () => {
    const lastImport = fonts.lastIndexOf("@import");
    const firstDigitFace = fonts.indexOf("U+0030-0039");
    assert.ok(lastImport >= 0 && firstDigitFace > lastImport);
  });

  it("uses no other display face that could draw digits", () => {
    const known = new Set([...PIXEL_FACES, "Space Grotesk Variable", "Space Grotesk", "JetBrains Mono Variable", "JetBrains Mono", "inherit"]);
    const generic = new Set(["monospace", "sans-serif", "serif", "system-ui", "ui-monospace", "ui-sans-serif"]);
    for (const file of readdirSync(STYLES).filter((f) => f.endsWith(".css"))) {
      const css = readFileSync(join(STYLES, file), "utf8");
      for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)[;}]/g)) {
        const first = (m[1] ?? "").split(",")[0]?.trim().replace(/["']/g, "") ?? "";
        if (generic.has(first) || first.startsWith("var(")) continue;
        assert.ok(known.has(first), `${file}: font-family ${first} is not a checked face`);
      }
    }
  });
});
