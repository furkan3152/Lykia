/** Logs tab: every request made with your keys (method, path, status, latency, request id, error code). */
import type { RequestLogEntry } from "@lykia/core/api/platform";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet } from "../../lib/api";
import { Button, Card, EmptyState, Field, Input, Select, Skeleton, Tag } from "../../mosaic";
import { ScrollTable } from "./portalShared";
import { shortTime, statusTone } from "./portalFormat";
import { t } from "../../i18n";

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
  if (!enabled) return <EmptyState title={t("forge.logs.signInFirst")}>{t("forge.logs.logsShowRequestsMadeWithYour")}</EmptyState>;
  const rows = logs.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <Card title={t("forge.logs.requestLogs")} kicker={t("forge.logs.perKeyPerProjectNewestFirst")}>
      <div className="m-grid-3" style={{ gap: 10, alignItems: "end" }}>
        <Field label={t("forge.logs.status")}>
          <Select value={statusClass} onChange={(e) => setStatusClass(e.target.value)}><option value="">{t("forge.logs.all")}</option><option value="2xx">2xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option><option value="error">{t("forge.logs.errors")}</option></Select>
        </Field>
        <Field label={t("forge.logs.keyId")}><Input value={keyId} onChange={(e) => setKeyId(e.target.value.trim())} placeholder="abcdef123456" /></Field>
        <Field label={t("forge.logs.pathContains")}><Input value={path} onChange={(e) => setPath(e.target.value.trim())} placeholder="/v1/intents" /></Field>
      </div>
      <div className="flex flex-wrap gap-2" style={{ margin: "10px 0" }}>
        <Button size="sm" tone={live ? "sea" : "ghost"} onClick={() => setLive((v) => !v)}>{live ? t("forge.logs.liveOn") : t("forge.logs.liveOff")}</Button>
        <Button size="sm" tone="ghost" onClick={() => void logs.refetch()}>{t("forge.logs.refresh")}</Button>
      </div>
      {logs.isLoading ? <Skeleton h={160} /> : rows.length === 0 ? <p className="m-small m-muted">{t("forge.logs.noRequestsYetCallTheApi")}</p> : (
        <ScrollTable label={t("forge.logs.requestLogs")}>
          <thead><tr><th>{t("forge.logs.time")}</th><th>{t("forge.logs.status")}</th><th>{t("forge.logs.request")}</th><th className="r">ms</th><th>{t("forge.logs.error")}</th><th>{t("forge.logs.requestId")}</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={`${e.requestId}-${e.at}`}>
                <td className="num m-small" style={{ whiteSpace: "nowrap" }}>{shortTime(e.at)}</td>
                <td><Tag tone={statusTone(e.status)}>{String(e.status)}</Tag></td>
                <td className="m-small" style={{ overflowWrap: "anywhere" }}><b>{e.method}</b> {e.path}{e.mode === "test" ? <span className="m-muted"> {t("forge.logs.test")}</span> : null}{e.idempotentReplay ? <span className="m-muted"> {t("forge.logs.replay")}</span> : null}</td>
                <td className="num r">{e.latencyMs}</td>
                <td className="m-small">{e.errorCode ?? ""}</td>
                <td className="num m-small" style={{ overflowWrap: "anywhere" }}>{e.requestId}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      {logs.hasNextPage ? <div style={{ marginTop: 10 }}><Button size="sm" tone="ghost" disabled={logs.isFetchingNextPage} onClick={() => void logs.fetchNextPage()}>{t("forge.logs.loadMore")}</Button></div> : null}
    </Card>
  );
}
