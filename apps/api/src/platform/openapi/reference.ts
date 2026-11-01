/**
 * A rendered API reference (GET /v1/reference): plain HTML built on the
 * server from the OpenAPI document, no scripts, inline styles only, so it
 * works under the API's strict Content-Security-Policy. The developer portal
 * (/build, API Reference tab) renders the same document with a try-it panel.
 */
import type { JsonSchema } from "./zodSchema.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function schemaLine(schema: JsonSchema | undefined): string {
  if (!schema) return "";
  return esc(JSON.stringify(schema, null, 2).slice(0, 2400));
}

export function renderReference(doc: JsonSchema): string {
  const info = doc.info as { title: string; version: string; description: string };
  const paths = doc.paths as Record<string, Record<string, JsonSchema>>;
  const byTag = new Map<string, { method: string; path: string; op: JsonSchema }[]>();
  for (const [path, ops] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const tag = ((op.tags as string[] | undefined) ?? ["Other"])[0] as string;
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)?.push({ method, path, op });
    }
  }
  const tags = [...byTag.keys()].sort();
  const nav = tags.map((t) => `<a href="#tag-${esc(t)}">${esc(t)}</a>`).join("");
  const sections = tags
    .map((tag) => {
      const ops = (byTag.get(tag) ?? [])
        .map(({ method, path, op }) => {
          const params = ((op.parameters as JsonSchema[] | undefined) ?? []).filter((p) => !("$ref" in p));
          const body = (op.requestBody as { content?: { "application/json"?: { schema?: JsonSchema } } } | undefined)?.content?.["application/json"]?.schema;
          return `<article id="${esc(op.operationId)}"><h3><span class="m m-${esc(method)}">${esc(method.toUpperCase())}</span> <code>${esc(path)}</code></h3><p>${esc(op.summary)}</p>${op.description ? `<p class="d">${esc(op.description)}</p>` : ""}<p class="meta">auth: ${esc(op["x-lykia-auth"])}${op["x-lykia-scope"] ? ` · scope: ${esc(op["x-lykia-scope"])}` : ""}${op["x-lykia-idempotent"] ? " · Idempotency-Key" : ""}${op["x-x402"] ? " · x402" : ""}</p>${
            params.length > 0 ? `<table><tr><th>Parameter</th><th>In</th><th>Required</th></tr>${params.map((p) => `<tr><td><code>${esc(p.name)}</code></td><td>${esc(p.in)}</td><td>${p.required ? "yes" : "no"}</td></tr>`).join("")}</table>` : ""
          }${body ? `<details><summary>Request body</summary><pre>${schemaLine(body)}</pre></details>` : ""}</article>`;
        })
        .join("");
      return `<section id="tag-${esc(tag)}"><h2>${esc(tag)}</h2>${ops}</section>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(info.title)} reference</title><style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#2b1d14;background:#f6efe3}header{padding:24px;background:#2b1d14;color:#f6efe3}header h1{margin:0;font-size:24px}header p{max-width:900px;margin:8px 0 0;opacity:.85}
nav{display:flex;flex-wrap:wrap;gap:6px;padding:12px 24px;background:#ead9bf;position:sticky;top:0}nav a{color:#7a2e1a;text-decoration:none;font-size:13px;padding:2px 8px;border:1px solid #c9a77a;border-radius:4px}
main{max-width:980px;margin:0 auto;padding:16px}section h2{border-bottom:2px solid #b8442b;padding-bottom:4px}article{background:#fffaf2;border:1px solid #e0cba9;border-radius:6px;padding:12px 14px;margin:10px 0;overflow-wrap:anywhere}
h3{margin:0;font-size:15px}code{font-family:ui-monospace,monospace}.m{display:inline-block;min-width:56px;text-align:center;border-radius:4px;color:#fff;font-size:12px;padding:1px 6px}.m-get{background:#2f6f6a}.m-post{background:#b8442b}.m-put,.m-patch{background:#a0711c}.m-delete{background:#6b2d5c}
.meta{font-size:12px;color:#6b5847}.d{font-size:14px}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #e0cba9;padding:2px 8px;text-align:left}pre{overflow:auto;background:#2b1d14;color:#f6efe3;padding:10px;border-radius:4px;font-size:12px}
</style></head><body><header><h1>${esc(info.title)} <small>v${esc(info.version)}</small></h1><p>${esc(info.description)}</p><p><a style="color:#f2c66d" href="/v1/openapi.json">openapi.json</a></p></header><nav>${nav}</nav><main>${sections}</main></body></html>`;
}
