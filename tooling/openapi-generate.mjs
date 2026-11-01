// Generators driven by docs/platform/openapi.json (written by `npm run openapi -w @lykia/api`):
//   packages/sdk/src/generated/openapi.ts      typed operation table for @lykia/sdk
//   sdks/python/lykia/_operations.py           the same table for the Python SDK
//   docs/platform/lykia.postman_collection.json  a Postman v2.1 collection (Bruno imports it too)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const doc = JSON.parse(readFileSync(`${ROOT}docs/platform/openapi.json`, "utf8"));
const write = (path, text) => {
  mkdirSync(dirname(`${ROOT}${path}`), { recursive: true });
  writeFileSync(`${ROOT}${path}`, text);
  console.log(`wrote ${path}`);
};

const operations = [];
for (const [path, ops] of Object.entries(doc.paths)) {
  for (const [method, op] of Object.entries(ops)) operations.push({ path, method: method.toUpperCase(), op });
}
operations.sort((a, b) => a.op.operationId.localeCompare(b.op.operationId));

/* ------------------------------------------------------------ TypeScript */

const ident = (name) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : JSON.stringify(name));

function tsType(schema, depth = 0) {
  if (!schema || depth > 8) return "unknown";
  if (schema.$ref) return "unknown";
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map((s) => tsType(s, depth + 1)).join(" | ");
  if (schema.allOf) return schema.allOf.map((s) => tsType(s, depth + 1)).join(" & ");
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const parts = types.map((type) => {
    switch (type) {
      case "string":
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "array":
        return schema.prefixItems ? `[${schema.prefixItems.map((s) => tsType(s, depth + 1)).join(", ")}]` : `Array<${tsType(schema.items, depth + 1)}>`;
      case "object": {
        const props = Object.entries(schema.properties ?? {});
        const required = new Set(schema.required ?? []);
        const fields = props.map(([k, v]) => `${ident(k)}${required.has(k) ? "" : "?"}: ${tsType(v, depth + 1)}`);
        if (schema.additionalProperties && typeof schema.additionalProperties === "object") fields.push(`[key: string]: ${tsType(schema.additionalProperties, depth + 1)}`);
        else if (schema.additionalProperties !== false && props.length === 0) return "Record<string, unknown>";
        return `{ ${fields.join("; ")} }`;
      }
      default:
        return "unknown";
    }
  });
  return parts.length === 0 ? "unknown" : parts.join(" | ");
}

function paramsType(op, where) {
  const params = (op.parameters ?? []).filter((p) => p.in === where);
  if (params.length === 0) return "never";
  return `{ ${params.map((p) => `${ident(p.name)}${p.required ? "" : "?"}: ${tsType(p.schema)}`).join("; ")} }`;
}

function bodyType(op) {
  const schema = op.requestBody?.content?.["application/json"]?.schema;
  return schema ? tsType(schema) : "never";
}

function responseType(op) {
  const ok = Object.entries(op.responses ?? {}).find(([status]) => status.startsWith("2"));
  const schema = ok?.[1]?.content?.["application/json"]?.schema;
  return schema ? tsType(schema) : "unknown";
}

const ts = [
  "// Generated from docs/platform/openapi.json by tooling/openapi-generate.mjs. Do not edit by hand:",
  "// run `npm run openapi -w @lykia/api` after documenting routes.",
  "",
  `export const OPENAPI_VERSION = ${JSON.stringify(doc.info.version)};`,
  "",
  "export interface LykiaOperations {",
  ...operations.map(
    ({ path, method, op }) =>
      `  ${op.operationId}: { method: ${JSON.stringify(method)}; path: ${JSON.stringify(path)}; params: ${paramsType(op, "path")}; query: ${paramsType(op, "query")}; body: ${bodyType(op)}; response: ${responseType(op)} };`,
  ),
  "}",
  "",
  "export type LykiaOperationId = keyof LykiaOperations;",
  "",
  "export interface OperationInfo {",
  "  readonly method: \"GET\" | \"POST\" | \"PUT\" | \"PATCH\" | \"DELETE\";",
  "  readonly path: string;",
  "  readonly tag: string;",
  "  readonly summary: string;",
  "  readonly auth: string;",
  "  readonly scope: string | null;",
  "  readonly idempotent: boolean;",
  "}",
  "",
  "export const LYKIA_OPERATIONS: { readonly [K in LykiaOperationId]: OperationInfo } = {",
  ...operations.map(({ path, method, op }) => `  ${op.operationId}: { method: ${JSON.stringify(method)}, path: ${JSON.stringify(path)}, tag: ${JSON.stringify(op.tags?.[0] ?? "")}, summary: ${JSON.stringify(op.summary ?? "")}, auth: ${JSON.stringify(op["x-lykia-auth"] ?? "public")}, scope: ${JSON.stringify(op["x-lykia-scope"] ?? null)}, idempotent: ${op["x-lykia-idempotent"] === true} },`),
  "};",
  "",
];
write("packages/sdk/src/generated/openapi.ts", ts.join("\n"));

/* ------------------------------------------------------------ Python */

const py = [
  "# Generated from docs/platform/openapi.json by tooling/openapi-generate.mjs. Do not edit by hand.",
  '"""Every documented Lykia API operation: method, path, tag, scope and idempotency."""',
  "from __future__ import annotations",
  "",
  "from typing import Dict, NamedTuple, Optional",
  "",
  "",
  "class Operation(NamedTuple):",
  "    method: str",
  "    path: str",
  "    tag: str",
  "    summary: str",
  "    scope: Optional[str]",
  "    idempotent: bool",
  "",
  "",
  `OPENAPI_VERSION = ${JSON.stringify(doc.info.version)}`,
  "",
  "OPERATIONS: Dict[str, Operation] = {",
  ...operations.map(({ path, method, op }) => `    ${JSON.stringify(op.operationId)}: Operation(${JSON.stringify(method)}, ${JSON.stringify(path)}, ${JSON.stringify(op.tags?.[0] ?? "")}, ${JSON.stringify(op.summary ?? "")}, ${op["x-lykia-scope"] ? JSON.stringify(op["x-lykia-scope"]) : "None"}, ${op["x-lykia-idempotent"] === true ? "True" : "False"}),`),
  "}",
  "",
];
write("sdks/python/lykia/_operations.py", py.join("\n"));

/* ------------------------------------------------------------ Postman */

function example(schema, depth = 0) {
  if (!schema || depth > 5) return null;
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) return example(schema.anyOf[0], depth + 1);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "string":
      return schema.pattern === "^0x[0-9a-fA-F]{40}$" ? "0x0000000000000000000000000000000000000001" : "";
    case "number":
    case "integer":
      return schema.minimum ?? 1;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object": {
      const out = {};
      for (const name of schema.required ?? []) out[name] = example(schema.properties?.[name], depth + 1);
      return out;
    }
    default:
      return null;
  }
}

const folders = new Map();
for (const { path, method, op } of operations) {
  const tag = op.tags?.[0] ?? "Other";
  if (!folders.has(tag)) folders.set(tag, []);
  const pathParts = path.replace(/^\//u, "").split("/").map((p) => p.replace(/^\{(.+)\}$/u, ":$1"));
  const query = (op.parameters ?? []).filter((p) => p.in === "query").map((p) => ({ key: p.name, value: "", disabled: !p.required }));
  const variables = (op.parameters ?? []).filter((p) => p.in === "path").map((p) => ({ key: p.name, value: "" }));
  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  const headers = [{ key: "Lykia-Key", value: "{{lykiaKey}}" }, { key: "Lykia-Version", value: "{{lykiaVersion}}" }];
  if (op["x-lykia-idempotent"]) headers.push({ key: "Idempotency-Key", value: "{{$guid}}" });
  if (bodySchema) headers.push({ key: "Content-Type", value: "application/json" });
  folders.get(tag).push({
    name: `${op.summary}`,
    request: {
      method,
      header: headers,
      url: { raw: `{{baseUrl}}/${pathParts.join("/")}`, host: ["{{baseUrl}}"], path: pathParts, ...(query.length ? { query } : {}), ...(variables.length ? { variable: variables } : {}) },
      ...(bodySchema ? { body: { mode: "raw", raw: JSON.stringify(example(bodySchema), null, 2), options: { raw: { language: "json" } } } } : {}),
      description: `${op.description ?? op.summary}\n\nAuth: ${op["x-lykia-auth"] ?? "public"}${op["x-lykia-scope"] ? `, scope: ${op["x-lykia-scope"]}` : ""}.`,
    },
  });
}
const collection = {
  info: { name: "Lykia API", description: `${doc.info.summary}\n\nSet baseUrl, lykiaKey (use a lk_test_ key for the sandbox) and lykiaVersion in the collection variables. Generated from openapi.json.`, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: [
    { key: "baseUrl", value: doc.servers?.[0]?.url ?? "http://localhost:3002" },
    { key: "lykiaKey", value: "lk_test_..." },
    { key: "lykiaVersion", value: doc["x-lykia-versions"]?.at(-1) ?? "" },
  ],
  item: [...folders].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => ({ name, item })),
};
write("docs/platform/lykia.postman_collection.json", `${JSON.stringify(collection, null, 2)}\n`);
