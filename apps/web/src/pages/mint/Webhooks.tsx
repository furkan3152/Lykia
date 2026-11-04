/** Webhooks tab: endpoints, the event catalogue, the delivery log with attempts, replays and test events. */
import type { WebhookDelivery, WebhookEndpointView } from "@lykia/core/api/platform";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet, apiPost, describeError } from "../../lib/api";
import { Button, Card, EmptyState, Field, Input, Select, Skeleton, Tag, toast } from "../../mosaic";
import { ScrollTable } from "./portalShared";
import { shortTime } from "./portalFormat";

interface CatalogueEntry {
  readonly type: string;
  readonly group: string;
  readonly description: string;
  readonly aliases: readonly string[];
}
type Endpoint = WebhookEndpointView & { readonly description?: string | null };
type Detail = WebhookDelivery & { readonly payload: unknown };

const fail = (e: unknown) => toast.error(describeError(e), { from: "LYKO" });
const VERIFY = `import { constructEvent } from "@lykia/sdk";

// Use the raw body, exactly as received.
const event = await constructEvent(process.env.LYKIA_WEBHOOK_SECRET, rawBody, req.headers["lykia-signature"]);
if (event.type === "step.settled") { /* ... */ }`;

export function Webhooks({ enabled }: { readonly enabled: boolean }) {
  const qc = useQueryClient();
  const catalogue = useQuery({ queryKey: ["webhook-events"], queryFn: ({ signal }) => apiGet<{ events: CatalogueEntry[] }>("/v1/webhooks/events", { signal }) });
  const endpoints = useQuery({ queryKey: ["dev-hooks"], enabled, queryFn: ({ signal }) => apiGet<{ endpoints: Endpoint[] }>("/v1/developers/webhooks", { signal }) });
  const [status, setStatus] = useState("");
  const deliveries = useQuery({ queryKey: ["dev-deliveries", status], enabled, refetchInterval: 10_000, queryFn: ({ signal }) => apiGet<{ deliveries: WebhookDelivery[] }>("/v1/developers/webhooks/deliveries", { signal, query: { limit: 50, status: status || undefined } }) });
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["dev-hooks"] });
    void qc.invalidateQueries({ queryKey: ["dev-deliveries"] });
  };
  const create = useMutation({
    mutationFn: () => apiPost<Endpoint>("/v1/developers/webhooks", { url, ...(events.length ? { events } : {}) }),
    onSuccess: (e) => { setSecret(e.secret ?? null); setUrl(""); refresh(); },
    onError: fail,
  });
  const action = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: "disable" | "enable" | "rotate-secret" }) => apiPost<Endpoint>(`/v1/developers/webhooks/${id}/${verb}`, {}),
    onSuccess: (e) => { if (e.secret) setSecret(e.secret); refresh(); },
    onError: fail,
  });
  const test = useMutation({
    mutationFn: (endpointId: string) => apiPost<{ sent: number; deliveries: WebhookDelivery[] }>("/v1/developers/webhooks/test", { endpointId }),
    onSuccess: (r) => { toast.success(`Test event: ${r.deliveries[0]?.status ?? "sent"}`, { from: "LYKO" }); refresh(); },
    onError: fail,
  });
  const replay = useMutation({ mutationFn: (id: string) => apiPost<WebhookDelivery>(`/v1/developers/webhooks/deliveries/${id}/replay`, {}), onSuccess: (d) => { toast.success(`Replayed: ${d.status}`, { from: "LYKO" }); refresh(); }, onError: fail });
  const open = async (id: string) => {
    try {
      setDetail(await apiGet<Detail>(`/v1/developers/webhooks/deliveries/${id}`));
    } catch (e) {
      fail(e);
    }
  };

  const groups = new Map<string, CatalogueEntry[]>();
  for (const e of catalogue.data?.events ?? []) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      {secret ? <div className="m-note" role="status" style={{ overflowWrap: "anywhere" }}><b>Signing secret, shown once:</b> <code className="num">{secret}</code> <Button size="sm" tone="ghost" onClick={() => setSecret(null)}>HIDE</Button></div> : null}
      {!enabled ? <EmptyState title="Sign in first">Endpoints belong to your developer wallet. The event catalogue is below.</EmptyState> : (
        <div className="m-grid-2" style={{ alignItems: "start" }}>
          <Card title="Endpoints" kicker="HMAC-SHA256 · Lykia-Signature">
            {endpoints.isLoading ? <Skeleton h={80} /> : (endpoints.data?.endpoints ?? []).length === 0 ? <p className="m-small m-muted">No endpoints yet.</p> : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {(endpoints.data?.endpoints ?? []).map((e) => (
                  <li key={e.id} className="m-row" style={{ flexDirection: "column", gap: 6 }}>
                    <span className="num m-small" style={{ overflowWrap: "anywhere" }}>{e.url}</span>
                    <span className="m-small m-muted">{e.id} · {e.events.length} events {e.disabled ? <Tag tone="ghost">disabled</Tag> : <Tag tone="ok">on</Tag>}</span>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" tone="sea" onClick={() => test.mutate(e.id)} disabled={e.disabled}>SEND TEST</Button>
                      <Button size="sm" tone="ghost" onClick={() => action.mutate({ id: e.id, verb: e.disabled ? "enable" : "disable" })}>{e.disabled ? "ENABLE" : "DISABLE"}</Button>
                      <Button size="sm" tone="ghost" onClick={() => action.mutate({ id: e.id, verb: "rotate-secret" })}>NEW SECRET</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="New endpoint" kicker="HTTPS · RETRIES WITH BACKOFF" footer={<Button disabled={!url || create.isPending} onClick={() => create.mutate()}>ADD ENDPOINT</Button>}>
            <Field label="URL"><Input placeholder="https://example.com/lykia" value={url} onChange={(e) => setUrl(e.target.value.trim())} /></Field>
            <p className="m-small m-muted" style={{ margin: "8px 0 4px" }}>Events (none ticked means every catalogue event):</p>
            <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {(catalogue.data?.events ?? []).map((e) => (
                <label key={e.type} className="m-small" style={{ display: "flex", gap: 8 }}>
                  <input type="checkbox" checked={events.includes(e.type)} onChange={(ev) => setEvents((cur) => (ev.target.checked ? [...cur, e.type] : cur.filter((x) => x !== e.type)))} />
                  <span className="num">{e.type}</span>
                </label>
              ))}
            </div>
          </Card>
        </div>
      )}
      {enabled ? (
        <Card title="Deliveries" kicker="EVERY ATTEMPT IS LOGGED">
          <div style={{ maxWidth: 220, marginBottom: 10 }}>
            <Select aria-label="Delivery status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">all</option><option value="pending">pending</option><option value="delivered">delivered</option><option value="failed">failed</option></Select>
          </div>
          {(deliveries.data?.deliveries ?? []).length === 0 ? <p className="m-small m-muted">No deliveries yet. Send a test event.</p> : (
            <ScrollTable label="Webhook deliveries">
              <thead><tr><th>Created</th><th>Event</th><th>Status</th><th className="r">Tries</th><th>Last</th><th /></tr></thead>
              <tbody>
                {(deliveries.data?.deliveries ?? []).map((d) => (
                  <tr key={d.id}>
                    <td className="num m-small" style={{ whiteSpace: "nowrap" }}>{shortTime(d.createdAt)}</td>
                    <td className="num m-small">{d.event}</td>
                    <td><Tag tone={d.status === "delivered" ? "ok" : d.status === "failed" ? "bad" : "ochre"}>{d.status}</Tag></td>
                    <td className="num r">{d.attempts}</td>
                    <td className="num m-small">{d.lastStatusCode ?? "none"}</td>
                    <td><div className="flex gap-2"><Button size="sm" tone="ghost" onClick={() => void open(d.id)}>VIEW</Button><Button size="sm" tone="sea" onClick={() => replay.mutate(d.id)}>REPLAY</Button></div></td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          )}
          {detail ? (
            <div style={{ marginTop: 12 }}>
              <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}><b className="num m-small">{detail.id}</b><Button size="sm" tone="ghost" onClick={() => setDetail(null)}>CLOSE</Button></div>
              <ul className="m-small" style={{ paddingLeft: 18 }}>{(detail.attemptLog ?? []).map((a) => <li key={a.at}>{shortTime(a.at)}: {a.statusCode ?? "no answer"} in {a.durationMs} ms{a.error ? ` (${a.error})` : ""}</li>)}</ul>
              <pre className="m-code" style={{ maxHeight: 260 }}>{JSON.stringify(detail.payload, null, 2)}</pre>
            </div>
          ) : null}
        </Card>
      ) : null}
      <div className="m-grid-2" style={{ alignItems: "start" }}>
        <Card title="Event catalogue" kicker="GET /v1/webhooks/events">
          {[...groups].map(([group, list]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <span className="m-kick">{group}</span>
              <ul className="m-small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{list.map((e) => <li key={e.type}><code>{e.type}</code> {e.description}{e.aliases.length ? <span className="m-muted"> (also {e.aliases.join(", ")})</span> : null}</li>)}</ul>
            </div>
          ))}
        </Card>
        <Card title="Verify a delivery" kicker="@lykia/sdk · lykia (Python)"><pre className="m-code">{VERIFY}</pre><p className="m-small m-muted" style={{ marginTop: 8 }}>Forward events to your laptop with <code>lykia webhooks listen --forward-to http://localhost:3000/hooks</code>.</p></Card>
      </div>
    </div>
  );
}
