/**
 * Writes the OpenAPI document to docs/platform/openapi.json, then runs the
 * generators (SDK operation types, the Python operation table, the Postman
 * collection). Run after adding or documenting routes:
 *
 *   npm run openapi -w @lykia/api
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createContext } from "../context.js";
import { buildOpenApi } from "../platform/openapi/document.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ctx = createContext(loadConfig({ NODE_ENV: "test", LYKIA_LOG_LEVEL: "silent", LYKIA_SESSION_SECRET: "openapi-export-only-not-a-real-secret-000" }));
createApp(ctx);
const doc = buildOpenApi(ctx, process.env.LYKIA_PUBLIC_API_URL ?? "https://lykia-api-akdogan1.vercel.app");
writeFileSync(`${ROOT}docs/platform/openapi.json`, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote docs/platform/openapi.json (${Object.keys(doc.paths as object).length} paths)`);
execFileSync(process.execPath, [`${ROOT}tooling/openapi-generate.mjs`], { stdio: "inherit" });
process.exit(0);
