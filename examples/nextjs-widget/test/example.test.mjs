// Typechecks the example without Next installed, then renders the page on the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const dir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

test("the Next.js example typechecks with plain React", () => {
  const tsc = require.resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", `${dir}tsconfig.json`], { stdio: "pipe" });
});

test("the page renders on the server", () => {
  // tsx reads this example's tsconfig (react-jsx) when it runs from the example's folder.
  const code = `
    import { createElement } from "react";
    import { renderToString } from "react-dom/server";
    import Page from "./app/page.tsx";
    process.stdout.write(renderToString(createElement(Page)));
  `;
  const html = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: dir, encoding: "utf8" });
  assert.match(html, /data-lykia="chat"/u);
  assert.match(html, /data-lykia="swap"/u);
  assert.match(html, /Acme Pay/u);
});
