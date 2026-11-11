/** API Reference tab: rendered from /v1/openapi.json, with a try-it panel that only accepts test keys. */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiGet, apiUrl } from "../../lib/api";
import { Button, Card, Field, Input, Select, Skeleton, Tag } from "../../mosaic";
import { t as msg } from "../../i18n";

interface Parameter {
  readonly name: string;
  readonly in: string;
  readonly required?: boolean;
  readonly description?: string;
  readonly $ref?: string;
}
interface Operation {
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly parameters?: readonly Parameter[];
  readonly requestBody?: { readonly content?: { readonly "application/json"?: { readonly schema?: unknown } } };
  readonly "x-lykia-auth"?: string;
  readonly "x-lykia-scope"?: string;
  readonly "x-lykia-idempotent"?: boolean;
}
interface OpenApiDoc {
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, Record<string, Operation>>;
}
interface Entry {
  readonly method: string;
  readonly path: string;
  readonly op: Operation;
}

const TEST_KEY = /^lk_test_[a-z0-9]{12}_[A-Za-z0-9_-]{32}$/u;
const METHOD_TONE: Record<string, "sea" | "bad" | "ochre" | "wolf"> = { get: "sea", post: "bad", put: "ochre", patch: "ochre", delete: "wolf" };

function example(schema: unknown, depth = 0): unknown {
  const s = schema as { type?: string | string[]; properties?: Record<string, unknown>; required?: string[]; enum?: unknown[]; const?: unknown; anyOf?: unknown[]; default?: unknown } | undefined;
  if (!s || depth > 4) return null;
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.anyOf) return example(s.anyOf[0], depth + 1);
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (type === "object") return Object.fromEntries((s.required ?? []).map((k) => [k, example(s.properties?.[k], depth + 1)]));
  if (type === "array") return [];
  if (type === "string") return "";
  if (type === "number" || type === "integer") return 1;
  if (type === "boolean") return false;
  return null;
}

function TryIt({ entry }: { readonly entry: Entry }) {
  const params = (entry.op.parameters ?? []).filter((p) => !p.$ref && (p.in === "path" || p.in === "query"));
  const [key, setKey] = useState(() => sessionStorage.getItem("lykia-try-key") ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const schema = entry.op.requestBody?.content?.["application/json"]?.schema;
  const [body, setBody] = useState(() => (schema ? JSON.stringify(example(schema), null, 2) : ""));
  const [result, setResult] = useState<{ status: number; requestId: string | null; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const keyOk = key === "" || TEST_KEY.test(key);
  const send = async () => {
    if (!keyOk) return;
    setBusy(true);
    try {
      let path = entry.path;
      const query: Record<string, string> = {};
      for (const p of params) {
        const v = values[p.name] ?? "";
        if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(v));
        else if (v) query[p.name] = v;
      }
      if (key) sessionStorage.setItem("lykia-try-key", key);
      const response = await fetch(apiUrl(path, query), {
        method: entry.method.toUpperCase(),
        headers: { accept: "application/json", ...(key ? { "Lykia-Key": key } : {}), ...(body && entry.method !== "get" ? { "content-type": "application/json" } : {}) },
        ...(body && entry.method !== "get" ? { body } : {}),
        credentials: "omit",
      });
      const text = await response.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // not JSON
      }
      setResult({ status: response.status, requestId: response.headers.get("x-request-id"), text: pretty.slice(0, 20_000) });
    } catch (e) {
      setResult({ status: 0, requestId: null, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
      <Field label={msg("forge.apiReference.testKey")} error={keyOk ? null : msg("forge.apiReference.onlyLkTestKeysHereThey")} hint={msg("forge.apiReference.keptInThisTabOnlyLeave")}>
        <Input value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="lk_test_…" autoComplete="off" />
      </Field>
      {params.map((p) => (
        <Field key={`${p.in}-${p.name}`} label={`${p.name} (${p.in}${p.required ? msg("forge.apiReference.required") : ""})`}>
          <Input value={values[p.name] ?? ""} onChange={(e) => setValues((cur) => ({ ...cur, [p.name]: e.target.value }))} />
        </Field>
      ))}
      {entry.method !== "get" && entry.method !== "delete" ? (
        <Field label={msg("forge.apiReference.bodyJson")}>
          <textarea className="m-input" value={body} onChange={(e) => setBody(e.target.value)} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: 12, boxSizing: "border-box" }} />
        </Field>
      ) : null}
      <div><Button size="sm" onClick={() => void send()} disabled={busy || !keyOk}>{busy ? "SENDING…" : msg("forge.apiReference.sendRequest")}</Button></div>
      {result ? (
        <div>
          <p className="m-small" style={{ margin: "4px 0" }}><Tag tone={result.status >= 400 || result.status === 0 ? "bad" : "ok"}>{String(result.status)}</Tag> {result.requestId ? <span className="num m-muted">{msg("forge.apiReference.xRequestId")} {result.requestId}</span> : null}</p>
          <pre className="m-code" style={{ maxHeight: 320 }}>{result.text}</pre>
        </div>
      ) : null}
    </div>
  );
}

export function ApiReference() {
  const doc = useQuery({ queryKey: ["openapi"], staleTime: 300_000, queryFn: ({ signal }) => apiGet<OpenApiDoc>("/v1/openapi.json", { signal }) });
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const entries = useMemo<Entry[]>(() => Object.entries(doc.data?.paths ?? {}).flatMap(([path, ops]) => Object.entries(ops).map(([method, op]) => ({ method, path, op }))), [doc.data]);
  const tags = useMemo(() => [...new Set(entries.map((e) => e.op.tags?.[0] ?? msg("forge.apiReference.other")))].sort(), [entries]);
  const q = search.toLowerCase();
  const shown = entries.filter((e) => (!tag || (e.op.tags?.[0] ?? "Other") === tag) && (!q || e.path.toLowerCase().includes(q) || e.op.summary.toLowerCase().includes(q)));
  return (
    <Card title={msg("forge.apiReference.apiReference")} kicker={doc.data ? msg("forge.apiReference.openapi31OperationsV", { length: entries.length, version: doc.data.info.version }) : "OPENAPI 3.1"}>
      <div className="m-grid-2" style={{ gap: 10, alignItems: "end" }}>
        <Field label={msg("forge.apiReference.group")}><Select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">{msg("forge.apiReference.allGroups")}</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
        <Field label={msg("forge.apiReference.search")}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={msg("forge.apiReference.intentsWebhooksQuote")} /></Field>
      </div>
      <div className="flex flex-wrap gap-2" style={{ margin: "10px 0" }}>
        <a className="m-btn m-btn--ghost" href={apiUrl("/v1/openapi.json")} target="_blank" rel="noopener noreferrer">{msg("forge.apiReference.openapiJson")}</a>
        <a className="m-btn m-btn--ghost" href={apiUrl("/v1/reference")} target="_blank" rel="noopener noreferrer">{msg("forge.apiReference.fullPage")}</a>
      </div>
      {doc.isLoading ? <Skeleton h={200} /> : doc.isError ? <p className="m-small">{msg("forge.apiReference.theReferenceCouldNotBeLoaded")}</p> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {(all || tag || q ? shown : shown.slice(0, 60)).map((e) => {
            const id = `${e.method} ${e.path}`;
            const isOpen = open === id;
            return (
              <li key={id} className="m-row" style={{ flexDirection: "column", gap: 4 }}>
                <button type="button" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} style={{ all: "unset", cursor: "pointer", display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", width: "100%" }}>
                  <Tag tone={METHOD_TONE[e.method] ?? "ghost"}>{e.method.toUpperCase()}</Tag>
                  <code className="num m-small" style={{ overflowWrap: "anywhere", minWidth: 0 }}>{e.path}</code>
                  <span className="m-small m-muted" style={{ flex: "1 1 200px" }}>{e.op.summary}</span>
                </button>
                {isOpen ? (
                  <div style={{ width: "100%" }}>
                    {e.op.description ? <p className="m-small">{e.op.description}</p> : null}
                    <p className="m-small m-muted" style={{ margin: "2px 0" }}>{msg("forge.apiReference.auth")} {e.op["x-lykia-auth"] ?? "public"}{e.op["x-lykia-scope"] ? msg("forge.apiReference.scope", { value: e.op["x-lykia-scope"] }) : ""}{e.op["x-lykia-idempotent"] ? msg("forge.apiReference.idempotencyKey") : ""} {msg("forge.apiReference.operationid")} <code>{e.op.operationId}</code></p>
                    <TryIt entry={e} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {!all && !tag && !q && shown.length > 60 ? <div style={{ marginTop: 10 }}><Button size="sm" tone="ghost" onClick={() => setAll(true)}>{msg("forge.apiReference.showAll", { length: shown.length })}</Button></div> : null}
    </Card>
  );
}
