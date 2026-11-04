// Lykia stands on its own: no file in the repository (code, comments, docs,
// tests, configs, the UI) names the other products of the family. The names
// are written as Unicode escapes on purpose, so this file does not trip itself.
// Tracked and new (untracked, not ignored) files are both checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const NAMES = [
  "\u006b\u006c\u0065\u0074\u0069\u0061",
  "\u0065\u006c\u0079\u0069\u0061",
  "\u0065\u006c\u0079\u0072\u0061",
  "\u0065\u006c\u0079",
];
const SIBLINGS = new RegExp(`\\b(?:${NAMES.join("|")})\\b`, "iu");

const LOCKFILE = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/u;
const BINARY = /\.(?:png|jpe?g|gif|webp|ico|bmp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp3|mp4|webm|wasm)$/iu;

function files() {
  try {
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function offenders() {
  const found = [];
  for (const file of files()) {
    if (LOCKFILE.test(file) || BINARY.test(file) || file.split("/").includes("node_modules")) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    text.split("\n").forEach((line, i) => {
      if (SIBLINGS.test(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

test("no file names the other products of the family", () => {
  assert.deepEqual(offenders(), []);
});

test("the check itself catches each name, in any case, and only as a word", () => {
  for (const name of NAMES) {
    assert.ok(SIBLINGS.test(`see ${name} for more`), name);
    assert.ok(SIBLINGS.test(name.toUpperCase()), name);
  }
  assert.ok(!SIBLINGS.test("Lykia keeps the flock inside the Fence."));
  assert.ok(!SIBLINGS.test("Elysian fields, a jelly, an elytron"));
});
