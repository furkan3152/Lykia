/** The Security center's cards: layers, venues, approvals, monitors, alerts, audit log, address check and the admin kill switch. */
import type { Insight } from "@lykia/core/api/agents";
import type { AuditEntry, MonitorPolicy, SecurityFinding, VenueBreaker } from "@lykia/core/security/index";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet, apiPost, apiPut, apiUrl, describeError } from "../../lib/api";
import { sessionToken } from "../../lib/session";
import { Button, Card, Field, Input, Select, Skeleton, Tag, toast } from "../../mosaic";
import { useLykiaWallet } from "../wallet/useLykiaWallet";
import { severityTone, short, stateTone } from "./model";

export interface SecurityStatus {
  readonly halted: boolean;
  readonly environment: string;
  readonly layers: readonly { readonly id: string; readonly name: string; readonly status: string; readonly detail: string }[];
  readonly venues: readonly VenueBreaker[];
  readonly platform: readonly { readonly id: string; readonly ok: boolean; readonly detail: string }[];
}

export function LayerGrid({ status }: { status: SecurityStatus | undefined }) {
  if (!status) return <Skeleton h={160} />;
  return (
    <div className="m-grid-3">
      {status.layers.map((l, i) => (
        <Card key={l.id} title={l.name} kicker={`LAYER ${i + 1}`} tone={l.status === "active" ? "terra" : "night"}>
          <p style={{ marginBottom: 8 }}><Tag tone={stateTone(l.status)}>{l.status}</Tag></p>
          <p className="m-small">{l.detail}</p>
        </Card>
      ))}
    </div>
  );
}

export function VenueBreakers({ status }: { status: SecurityStatus | undefined }) {
  const [all, setAll] = useState(false);
  if (!status) return <Skeleton h={120} />;
  const rows = all ? status.venues : status.venues.filter((v) => v.state !== "healthy");
  return (
    <Card title="Circuit breakers" kicker={`${status.venues.filter((v) => v.state === "healthy").length}/${status.venues.length} HEALTHY`} footer={<Button size="sm" tone="ghost" onClick={() => setAll((a) => !a)}>{all ? "ONLY ISSUES" : "SHOW ALL VENUES"}</Button>}>
      {status.halted ? <p className="m-note" style={{ marginBottom: 8 }}>Routing is halted. Only moves that bring value home (repay, withdraw) pass.</p> : null}
      {rows.length === 0 ? <p className="m-small m-muted m-center">Every venue is healthy.</p> : (
        <table className="m-table">
          <thead><tr><th>Venue</th><th>State</th><th>Why</th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.venue}><td>{v.venue}</td><td><Tag tone={stateTone(v.state)}>{v.state}</Tag></td><td className="m-small">{v.reasons.join(" ") || "—"}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function KillSwitch({ status }: { status: SecurityStatus | undefined }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done, { from: "LYKO" });
      setReason("");
      await qc.invalidateQueries({ queryKey: ["security-status"] });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };
  const halted = status?.halted ?? false;
  return (
    <Card title="Kill switch" kicker="ADMIN" tone="night">
      <div style={{ display: "grid", gap: 10 }}>
        <Field label="Reason (recorded in the platform audit chain)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
        <Button tone={halted ? "sea" : "terra"} disabled={busy || reason.trim().length < 3} onClick={() => void act(() => apiPost("/v1/security/halt", { halt: !halted, reason: reason.trim() }), halted ? "Routing resumed" : "Routing halted")}>{halted ? "RESUME ROUTING" : "HALT ALL ROUTING"}</Button>
        <Field label="Venue">
          <Select value={venue} onChange={(e) => setVenue(e.target.value)}>
            <option value="">Choose a venue</option>
            {(status?.venues ?? []).map((v) => <option key={v.venue} value={v.venue}>{v.venue} · {v.state}</option>)}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button size="sm" tone="ghost" disabled={busy || !venue || reason.trim().length < 3} onClick={() => void act(() => apiPut(`/v1/security/venues/${venue}`, { disabled: true, reason: reason.trim() }), `${venue} disabled`)}>DISABLE VENUE</Button>
          <Button size="sm" tone="ghost" disabled={busy || !venue || reason.trim().length < 3} onClick={() => void act(() => apiPut(`/v1/security/venues/${venue}`, { disabled: false, reason: reason.trim() }), `${venue} enabled`)}>ENABLE VENUE</Button>
        </div>
      </div>
    </Card>
  );
}

export function Approvals({ owner, environment }: { owner: string | undefined; environment: string }) {
  const wallet = useLykiaWallet();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["security-approvals", owner, environment], enabled: Boolean(owner), queryFn: ({ signal }) => apiGet<{ approvals: Insight[] }>("/v1/security/approvals", { signal, query: { owner, environment } }) });
  const revoke = async (insight: Insight) => {
    try {
      await wallet.sendForSubmit(insight.transactions ?? []);
      toast.success("Allowance revoked", { description: insight.title, from: "LYKO" });
      await qc.invalidateQueries({ queryKey: ["security-approvals"] });
    } catch (e) {
      toast.error("Revoke did not go through", { description: describeError(e), from: "LYKO" });
    }
  };
  return (
    <Card title="Approvals" kicker={q.data ? `${q.data.approvals.length} OPEN` : owner ? "…" : "CONNECT"}>
      {!owner ? <p className="m-small m-muted m-center">Connect a wallet to see allowances left open to Arc venues.</p> : q.isLoading ? <Skeleton h={80} /> : !q.data?.approvals.length ? (
        <p className="m-small m-muted m-center">No allowances left open. Lykia approves exact amounts that the same transaction spends.</p>
      ) : q.data.approvals.map((a) => (
        <div key={a.id} className="m-row" style={{ flexWrap: "wrap" }}>
          <Tag tone={a.severity === "act" ? "bad" : "ochre"}>{a.severity === "act" ? "unlimited" : "open"}</Tag>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}><b className="m-small">{a.title}</b><p className="m-small m-muted">{a.detail}</p></div>
          <Button size="sm" onClick={() => void revoke(a)}>REVOKE</Button>
        </div>
      ))}
    </Card>
  );
}

export function AddressCheck({ owner, environment }: { owner: string | undefined; environment: string }) {
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<{ kind: string; known: boolean; findings: SecurityFinding[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      setResult(await apiPost("/v1/security/check-address", { owner, address: address.trim(), environment }));
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Check an address" kicker="BEFORE YOU PAY" footer={<Button size="sm" disabled={busy || !owner || !/^0x[0-9a-fA-F]{40}$/u.test(address.trim())} onClick={() => void check()}>{busy ? "…" : "CHECK"}</Button>}>
      <Field label="Recipient" hint="Compared with your contacts and past recipients, the USDC/EURC blocklist and Circle screening."><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" spellCheck={false} /></Field>
      {result ? (
        <div style={{ marginTop: 10 }}>
          <p className="m-small"><Tag tone={result.known ? "ok" : "ghost"}>{result.known ? "known" : "new"}</Tag> {result.kind}</p>
          {result.findings.length === 0 ? <p className="m-small m-muted">Nothing to flag.</p> : result.findings.map((f) => (
            <p key={f.rule} className="m-small" style={{ marginTop: 6, display: "flex", gap: 6 }}><Tag tone={severityTone(f.severity)}>{f.severity}</Tag><span>{f.message}</span></p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

interface Pause { readonly subject: string; readonly reason: string; readonly by: string; readonly at: string }

export function Monitors({ enabled, address }: { enabled: boolean; address: string | undefined }) {
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ["security-policy", address], enabled, queryFn: ({ signal }) => apiGet<MonitorPolicy>("/v1/security/policy", { signal }) });
  const pauses = useQuery({ queryKey: ["security-pauses", address], enabled, queryFn: ({ signal }) => apiGet<{ pauses: Pause[] }>("/v1/security/pauses", { signal }) });
  const [draft, setDraft] = useState<{ txPerMinute: string; usdPerHour: string }>({ txPerMinute: "", usdPerHour: "" });
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("security-") });
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done, { from: "LYKO" });
      await refresh();
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  if (!enabled) return null;
  const p = policy.data;
  return (
    <Card title="Agent monitors" kicker={p ? `AUTO-WHISTLE · ${p.onAnomaly.toUpperCase()}` : "…"}>
      {!p ? <Skeleton h={80} /> : (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="m-grid-2" style={{ gap: 10 }}>
            <Field label={`Moves per minute (now ${p.txPerMinute})`}><Input inputMode="numeric" value={draft.txPerMinute} onChange={(e) => setDraft((d) => ({ ...d, txPerMinute: e.target.value }))} /></Field>
            <Field label={`USD per hour (now ${p.usdPerHour})`}><Input inputMode="decimal" value={draft.usdPerHour} onChange={(e) => setDraft((d) => ({ ...d, usdPerHour: e.target.value }))} /></Field>
          </div>
          <Field label="On an anomaly">
            <Select value={p.onAnomaly} onChange={(e) => void act(() => apiPut("/v1/security/policy", { onAnomaly: e.target.value }), "Auto-Whistle updated")}>
              <option value="flag">Flag it and alert me</option>
              <option value="pause">Pause keeper-run agents and alert me</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button size="sm" disabled={!draft.txPerMinute && !draft.usdPerHour} onClick={() => void act(() => apiPut("/v1/security/policy", { ...(draft.txPerMinute ? { txPerMinute: Number(draft.txPerMinute) } : {}), ...(draft.usdPerHour ? { usdPerHour: Number(draft.usdPerHour) } : {}) }), "Limits saved")}>SAVE LIMITS</Button>
            {address ? <Button size="sm" tone="ghost" onClick={() => void act(() => apiPost("/v1/security/pause", { subject: address, reason: "Paused by the owner from the Security center" }), "Your wallet is paused in Lykia")}>PAUSE MY WALLET</Button> : null}
          </div>
          {(pauses.data?.pauses ?? []).map((x) => (
            <div key={x.subject} className="m-row">
              <Tag tone="bad">paused</Tag>
              <div style={{ flex: 1, minWidth: 0 }}><b className="m-small">{short(x.subject)}</b><p className="m-small m-muted">{x.by} · {x.reason}</p></div>
              <Button size="sm" tone="ghost" onClick={() => void act(() => apiPost("/v1/security/resume", { subject: x.subject }), "Resumed")}>RESUME</Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

interface SecurityAlert { readonly id: string; readonly at: string; readonly severity: "block" | "warn" | "info"; readonly title: string; readonly body: string }

export function SecurityAlerts({ enabled, address }: { enabled: boolean; address: string | undefined }) {
  const q = useQuery({ queryKey: ["security-alerts", address], enabled, refetchInterval: 30_000, queryFn: ({ signal }) => apiGet<{ alerts: SecurityAlert[] }>("/v1/security/alerts", { signal }) });
  if (!enabled) return null;
  return (
    <Card title="Security alerts" kicker={q.data ? `${q.data.alerts.length} IN 30 DAYS` : "…"}>
      {q.isLoading ? <Skeleton h={60} /> : !q.data?.alerts.length ? <p className="m-small m-muted m-center">No alerts. The Auto-Whistle stays quiet while activity looks normal.</p> : q.data.alerts.slice(0, 8).map((a) => (
        <div key={a.id} className="m-row">
          <Tag tone={severityTone(a.severity)}>{a.severity}</Tag>
          <div style={{ flex: 1, minWidth: 0 }}><b className="m-small">{a.title}</b><p className="m-small m-muted">{new Date(a.at).toLocaleString("en-US")} · {a.body}</p></div>
        </div>
      ))}
    </Card>
  );
}

export function AuditLog({ enabled, address, admin }: { enabled: boolean; address: string | undefined; admin: boolean }) {
  const [chain, setChain] = useState<"owner" | "platform">("owner");
  const q = useQuery({ queryKey: ["security-audit", address, chain], enabled, queryFn: ({ signal }) => apiGet<{ entries: AuditEntry[]; verified: { ok: boolean; brokenAt: number | null } }>("/v1/security/audit", { signal, query: { chain, limit: 200 } }) });
  const exportLog = async () => {
    try {
      const token = sessionToken();
      const res = await fetch(apiUrl("/v1/security/audit", { chain, limit: 1000, format: "ndjson" }), { headers: token ? { "Lykia-Session": token } : {} });
      if (!res.ok) throw new Error(`Export failed (${res.status}).`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `lykia-audit-${chain}.ndjson`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  if (!enabled) return null;
  const entries = [...(q.data?.entries ?? [])].reverse();
  return (
    <Card
      title="Audit log"
      kicker={q.data ? (q.data.verified.ok ? `CHAIN INTACT · ${q.data.entries.length} ENTRIES` : `BROKEN AT #${q.data.verified.brokenAt}`) : "…"}
      footer={
        <div className="flex gap-2">
          {admin ? <Button size="sm" tone="ghost" onClick={() => setChain((c) => (c === "owner" ? "platform" : "owner"))}>{chain === "owner" ? "PLATFORM CHAIN" : "MY CHAIN"}</Button> : null}
          <Button size="sm" tone="ghost" onClick={() => void exportLog()}>EXPORT NDJSON</Button>
        </div>
      }
    >
      {q.isLoading ? <Skeleton h={120} /> : entries.length === 0 ? <p className="m-small m-muted m-center">Nothing recorded yet. Every plan you prepare and submit lands here, hash-chained.</p> : (
        <table className="m-table">
          <thead><tr><th>#</th><th>When</th><th>What</th><th>Subject</th><th>Hash</th></tr></thead>
          <tbody>
            {entries.slice(0, 50).map((e) => (
              <tr key={e.seq}>
                <td className="num">{e.seq}</td>
                <td className="m-small">{new Date(e.at).toLocaleString("en-US")}</td>
                <td><Tag tone={e.kind === "blocked" || e.kind === "halt" || e.kind === "pause" ? "bad" : "ghost"}>{e.kind}</Tag></td>
                <td className="m-small">{e.subject.length > 24 ? short(e.subject) : e.subject}</td>
                <td className="m-small num" title={e.hash}>{e.hash.slice(7, 17)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
