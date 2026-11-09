/** Letoon's security cards: the venue breakers, the audit log and the admin kill switch. Approvals, token checks and pauses for the owner live in the Fence tab's Safety section. */
import type { AuditEntry, VenueBreaker } from "@lykia/core/security/index";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet, apiPost, apiPut, apiUrl, describeError } from "../../lib/api";
import { sessionToken } from "../../lib/session";
import { Button, Card, Field, Input, Select, Skeleton, Tag, toast } from "../../mosaic";
import { short, stateTone } from "./model";

export interface SecurityStatus {
  readonly halted: boolean;
  readonly environment: string;
  readonly layers: readonly { readonly id: string; readonly name: string; readonly status: string; readonly detail: string }[];
  readonly venues: readonly VenueBreaker[];
  readonly platform: readonly { readonly id: string; readonly ok: boolean; readonly detail: string }[];
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
    <Card title="The Whistle · kill switch" kicker="ADMIN · AUDITED" tone="night">
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



export function AuditLog({ enabled, address, admin, initialChain = "owner" }: { enabled: boolean; address: string | undefined; admin: boolean; initialChain?: "owner" | "platform" }) {
  const [chain, setChain] = useState<"owner" | "platform">(initialChain);
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
                <td><Tag tone={e.kind === "blocked" || e.kind === "halt" || e.kind === "pause" ? "bad" : e.kind === "league" ? "ochre" : "ghost"}>{e.kind}</Tag></td>
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
