/** Scent: Lyko noses a token; wolves gather when it smells wrong. Never "safe". */
import { WOLVES, type WolfKind } from "@lykia/core";
import type { ScentReport } from "@lykia/core/api/scent";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../app/routes/history";
import { useRouteParam } from "../../app/routes/useRoute";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { apiGet, describeError } from "../../lib/api";
import { availabilityOf } from "../../lib/optional";
import { useEnvironment } from "../../lib/environment";
import { useLamp } from "../../lib/pulseStore";
import { Button, Card, EmptyState, Input, PageHead, Skeleton, Tag } from "../../mosaic";
import { sniff, SNIFF_H, SNIFF_W } from "../../mosaic/scenes";

const LEVEL_TONE = { verified: "ok", "no-red-flags": "ok", caution: "ochre", danger: "bad", unknown: "ghost" } as const;
const EXAMPLES = [["USDC", "0x3600000000000000000000000000000000000000"], ["EURC (mainnet)", "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1"]] as const;

export default function ScentPage() {
  const environment = useEnvironment();
  const token = useRouteParam("token") ?? null;
  const lit = useLamp();
  const [draft, setDraft] = useState(token ?? "");
  const report = useQuery({ queryKey: ["scent", token, environment], enabled: Boolean(token), queryFn: ({ signal }) => apiGet<ScentReport>(`/v1/scent/${token}`, { query: { environment }, signal, timeoutMs: 25_000 }) });
  const compliance = useQuery({ queryKey: ["compliance", token, environment], enabled: Boolean(token), retry: false, queryFn: ({ signal }) => apiGet<{ result: string; reasons?: string[]; provider?: string }>(`/v1/circle/compliance/${token}`, { query: { environment }, signal }) });
  const r = report.data;
  const level = r?.level ?? (report.isLoading ? "unknown" : "idle");
  return (
    <div>
      <PageHead kicker={"RULES · TOKEN CHECK"} title={<>Check a token <em>before you touch it.</em></>} sub={"Registry, bytecode, proxies, privileges, owner and a simulated transfer (Lyko calls it the Scent). Even the best result is not \"safe\"; it is \"no red flags found\"."} mood={level === "danger" ? "growling" : level === "caution" ? "alert" : "watching"}>
        <form className="flex gap-2 justify-center" style={{ marginTop: 18, maxWidth: 620, marginInline: "auto" }} onSubmit={(e) => { e.preventDefault(); if (/^0x[0-9a-fA-F]{40}$/u.test(draft.trim())) navigate(`/app/scent/${draft.trim()}`); }}>
          <Input placeholder="0x… token address" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Token address" />
          <Button type="submit">{"SNIFF"}</Button>
        </form>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame
          build={(t) => sniff({ level: level as never, wolves: r?.wolves.length ?? 0, lit }, t)}
          width={SNIFF_W}
          height={SNIFF_H}
          dataKey={`${level}-${r?.wolves.length}-${lit}`}
          assembleKey={token ?? "idle"}
          label="Lyko sniffing a token; wolves gather when it smells wrong"
          labels={r ? [{ x: 58, y: 8, text: r.level.toUpperCase(), tone: LEVEL_TONE[r.level] }, ...r.wolves.slice(0, 3).map((w, i) => ({ x: 80 + i * 7, y: 62 + (i % 2) * 8, text: WOLVES[w as WolfKind].name.toUpperCase(), tone: "wolf" as const }))] : []}
        />
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        {!token ? (
          <Card title={"Give him a token"}>
            <EmptyState mood="happy" title={"Paste a token address"}>{"Paste an address, or try one of these:"}</EmptyState>
            <div className="m-chips">{EXAMPLES.map(([n, a]) => <button key={a} type="button" className="m-chip" onClick={() => navigate(`/app/scent/${a}`)}>{n}</button>)}</div>
          </Card>
        ) : report.isLoading ? <Skeleton h={240} /> : report.isError ? (
          <Card title={"Could not sniff"}><p className="m-note m-note--bad">{describeError(report.error)}</p></Card>
        ) : r ? (
          <div className="m-grid-2 m-grid-2--l">
            <Card title={`${r.symbol ?? "?"} · ${r.name ?? "unknown"}`} kicker={`${r.token.slice(0, 10)}… · ARC ${r.environment.toUpperCase()} · ${r.decimals ?? "?"} DECIMALS`}>
              <table className="m-table">
                <thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
                <tbody>
                  {r.checks.map((c) => (
                    <tr key={c.id}><td><b>{c.id}</b></td><td><Tag tone={c.ok === true ? "ok" : c.ok === false ? "bad" : "ghost"}>{c.ok === true ? "passed" : c.ok === false ? "red flag" : "not run"}</Tag></td><td className="m-small">{c.detail}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title={"Wolves"} kicker={`${r.wolves.length} FOUND`} tone={r.wolves.length ? "terra" : "sea"}>
              {r.wolves.length === 0 ? <EmptyState mood="proud" title={"No red flags found"}>{"That is not \"safe\"; it means everything provable was checked."}</EmptyState> : r.wolves.map((w) => (
                <div key={w} className="m-row"><Tag tone="wolf">{w}</Tag><div><b>{WOLVES[w as WolfKind].name}</b><p className="m-small m-muted">{WOLVES[w as WolfKind].line}</p></div></div>
              ))}
              {"warning" in r.trust ? <p className="m-note" style={{ marginTop: 8 }}>{r.trust.warning}</p> : null}
              <div className="m-row" style={{ marginTop: 8 }}>
                <Tag tone={compliance.data ? (compliance.data.result === "approved" ? "ok" : compliance.data.result === "denied" ? "bad" : "ochre") : "ghost"}>{"COMPLIANCE"}</Tag>
                <p className="m-small">{compliance.data ? `${compliance.data.result}${compliance.data.reasons?.length ? ` · ${compliance.data.reasons.join(", ")}` : ""} (${compliance.data.provider ?? "Circle"})` : compliance.isLoading ? "…" : availabilityOf(compliance.error) === "needs-key" ? ("Circle compliance screening needs a key on the server.") : "Circle compliance screening is coming soon."}</p>
              </div>
            </Card>
          </div>
        ) : null}
      </section>
    </div>
  );
}
