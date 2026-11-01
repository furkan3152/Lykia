// Builds dist/lykia-embed.js: protocol.js + index.js in one classic script
// (no imports, no exports) for a plain <script src> tag. The ESM build in
// dist/index.js stays the module entry.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const strip = (code) =>
  code
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gmu, "")
    .replace(/^export\s+\*\s+from\s+["'][^"']+["'];\s*$/gmu, "")
    .replace(/^export\s+\{[^}]*\};\s*$/gmu, "")
    .replace(/^export\s+(const|function|class|let)\s/gmu, "$1 ")
    .replace(/^\/\/# sourceMappingURL=.*$/gmu, "");
const body = [strip(readFileSync(`${dist}protocol.js`, "utf8")), strip(readFileSync(`${dist}index.js`, "utf8"))].join("\n");
if (/^\s*(import|export)\s/mu.test(body)) throw new Error("bundle still has import/export statements");
const banner = `/*! @lykia/embed ${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version} | MIT */\n`;
writeFileSync(`${dist}lykia-embed.js`, `${banner}(() => {\n"use strict";\n${body}\n})();\n`);
console.log("dist/lykia-embed.js");
