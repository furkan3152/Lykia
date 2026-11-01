// `npm pack --dry-run` for every publishable package: each tarball must hold
// its dist entry, types, README and LICENSE, and nothing from src/ or test/.
// Nothing is published.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["packages/core", "packages/sdk", "packages/widget", "packages/embed", "packages/agent-tools"];
let failed = false;

for (const dir of PACKAGES) {
  const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: join(root, dir), encoding: "utf8" });
  const [info] = JSON.parse(out);
  const files = info.files.map((f) => f.path);
  const problems = [];
  for (const need of ["package.json", "README.md", "dist/index.js", "dist/index.d.ts"]) if (!files.includes(need)) problems.push(`missing ${need}`);
  if (!files.includes("LICENSE") && !existsSync(join(root, dir, "LICENSE"))) problems.push("missing LICENSE");
  if (files.some((f) => f.startsWith("src/") || f.startsWith("test/"))) problems.push("ships src/ or test/");
  if (files.some((f) => f.endsWith(".map"))) problems.push("ships source maps");
  for (const field of ["name", "version", "description", "license", "exports", "types"]) if (!pkg[field]) problems.push(`package.json lacks ${field}`);
  if (pkg.private) problems.push("marked private");
  for (const [sub, target] of Object.entries(pkg.exports ?? {})) {
    const file = typeof target === "string" ? target : target.import;
    if (file && !file.includes("*") && !files.includes(file.replace(/^\.\//u, ""))) problems.push(`export ${sub} points at a missing ${file}`);
  }
  const size = `${(info.size / 1024).toFixed(1)} kB packed, ${info.entryCount} files`;
  if (problems.length > 0) {
    failed = true;
    console.log(`✗ ${info.name}@${info.version} (${size}): ${problems.join("; ")}`);
  } else console.log(`✓ ${info.name}@${info.version} (${size})`);
}
process.exit(failed ? 1 : 0);
