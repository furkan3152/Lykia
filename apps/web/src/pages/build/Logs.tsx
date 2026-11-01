/** Logs tab: every request made with your keys (method, path, status, latency, request id, error code). */
import type { RequestLogEntry } from "@lykia/core/api/platform";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet } from "../../lib/api";
import { Button, Card, EmptyState, Field, Input, Select, Skeleton, Tag } from "../../mosaic";
import { ScrollTable } from "./portalShared";
import { shortTime, statusTone } from "./portalFormat";

interface Page {
  readonly data: RequestLogEntry[];
  readonly nextCursor: string | null;
}

export function Logs({ enabled }: { readonly enabled: boolean }) {
  const [statusClass, setStatusClass] = useState("");
  const [keyId, setKeyId] = useState("");
  const [path, setPath] = useState("");
  const [live, setLive] = useState(false);
  const logs = useInfiniteQuery({
    queryKey: ["dev-logs", statusClass, keyId, path],
    enabled,
    initialPageParam: "",
    refetchInterval: live ? 4_000 : false,
    queryFn: ({ pageParam, signal }) => apiGet<Page>("/v1/logs", { signal, query: { limit: 50, statusClass: statusClass || undefined, keyId: /^[a-z0-9]{12}$/u.test(keyId) ? keyId : undefined, path: path || undefined, cursor: pageParam || undefined } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  if (!enabled) return <EmptyState title="Sign in first">Logs show requests made with your keys.</EmptyState>;
  const rows = logs.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <Card title="Request logs" kicker="PER KEY · PER PROJECT · NEWEST FIRST">
      <div className="m-grid-3" style={{ gap: 10, alignItems: "end" }}>
        <Field label="Status">
          <Select value={statusClass} onChange={(e) => setStatusClass(e.target.value)}><option value="">all</option><option value="2xx">2xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option><option value="error">errors</option></Select>
        </Field>
        <Field label="Key id"><Input value={keyId} onChange={(e) => setKeyId(e.target.value.trim())} placeholder="abcdef123456" /></Field>
        <Field label="Path contains"><Input value={path} onChange={(e) => setPath(e.target.value.trim())} placeholder="/v1/intents" /></Field>
      </div>
      <div className="flex flex-wrap gap-2" style={{ margin: "10px 0" }}>
        <Button size="sm" tone={live ? "sea" : "ghost"} onClick={() => setLive((v) => !v)}>{live ? "LIVE: ON" : "LIVE: OFF"}</Button>
        <Button size="sm" tone="ghost" onClick={() => void logs.refetch()}>REFRESH</Button>
      </div>
      {logs.isLoading ? <Skeleton h={160} /> : rows.length === 0 ? <p className="m-small m-muted">No requests yet. Call the API with one of your keys and they appear here (kept 7 days on Free).</p> : (
        <ScrollTable label="Request logs">
          <thead><tr><th>Time</th><th>Status</th><th>Request</th><th className="r">ms</th><th>Error</th><th>Request id</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={`${e.requestId}-${e.at}`}>
                <td className="num m-small" style={{ whiteSpace: "nowrap" }}>{shortTime(e.at)}</td>
                <td><Tag tone={statusTone(e.status)}>{String(e.status)}</Tag></td>
                <td className="m-small" style={{ overflowWrap: "anywhere" }}><b>{e.method}</b> {e.path}{e.mode === "test" ? <span className="m-muted"> · test</span> : null}{e.idempotentReplay ? <span className="m-muted"> · replay</span> : null}</td>
                <td className="num r">{e.latencyMs}</td>
                <td className="m-small">{e.errorCode ?? ""}</td>
                <td className="num m-small" style={{ overflowWrap: "anywhere" }}>{e.requestId}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      {logs.hasNextPage ? <div style={{ marginTop: 10 }}><Button size="sm" tone="ghost" disabled={logs.isFetchingNextPage} onClick={() => void logs.fetchNextPage()}>LOAD MORE</Button></div> : null}
    </Card>
  );
}
