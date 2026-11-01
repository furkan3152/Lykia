// Typechecks the hooks example and renders it on the server (hooks return their initial state).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

test("the hooks example typechecks", () => {
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", `${dir}tsconfig.json`], { stdio: "pipe" });
});

test("it renders with the initial hook state", () => {
  const code = `
    import { createElement } from "react";
    import { renderToString } from "react-dom/server";
    import { App } from "./src/App.tsx";
    process.stdout.write(renderToString(createElement(App, { project: "prj_yourproject1", apiKey: "" })));
  `;
  const html = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: dir, encoding: "utf8" });
  assert.match(html, /Plan payroll for 2 people/u);
  assert.match(html, /Check token/u);
});
