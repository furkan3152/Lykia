// Builds the workspace packages after `npm install` so apps can import their dist output.
// Skips quietly when TypeScript is not installed yet (for example a production-only install).
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.LYKIA_SKIP_POSTINSTALL === "1") process.exit(0);
if (!existsSync(join(root, "node_modules", "typescript"))) {
  console.log("[lykia] typescript not installed; skipping package build");
  process.exit(0);
}
for (const pkg of ["packages/core"]) {
  if (!existsSync(join(root, pkg, "package.json"))) continue;
  console.log(`[lykia] building ${pkg}`);
  execSync("npm run build", { cwd: join(root, pkg), stdio: "inherit" });
}
