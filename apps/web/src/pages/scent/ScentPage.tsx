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
import { t as msg } from "../../i18n";

const LEVEL_TONE = { verified: "ok", "no-red-flags": "ok", caution: "ochre", danger: "bad", unknown: "ghost" } as const;
const EXAMPLES = [["USDC", "0x3600000000000000000000000000000000000000"], [msg("scent.eurcMainnet"), "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1"]] as const;

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
      <PageHead kicker={msg("scent.fenceScentTokenCheck")} title={<>{msg("scent.checkAToken")} <em>{msg("scent.beforeYouTouchIt")}</em></>} sub={msg("scent.registryBytecodeProxiesPrivilegesOwnerAn")} mood={level === "danger" ? "growling" : level === "caution" ? "alert" : "watching"}>
        <form className="flex gap-2 justify-center" style={{ marginTop: 18, maxWidth: 620, marginInline: "auto" }} onSubmit={(e) => { e.preventDefault(); if (/^0x[0-9a-fA-F]{40}$/u.test(draft.trim())) navigate(`/app/scent/${draft.trim()}`); }}>
          <Input placeholder="0x… token address" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={msg("scent.tokenAddress")} />
          <Button type="submit">{msg("scent.sniff")}</Button>
        </form>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame
          build={(t) => sniff({ level: level as never, wolves: r?.wolves.length ?? 0, lit }, t)}
          width={SNIFF_W}
          height={SNIFF_H}
          dataKey={`${level}-${r?.wolves.length}-${lit}`}
          assembleKey={token ?? "idle"}
          label={msg("scent.lykoSniffingATokenWolvesGather")}
          labels={r ? [{ x: 58, y: 8, text: r.level.toUpperCase(), tone: LEVEL_TONE[r.level] }, ...r.wolves.slice(0, 3).map((w, i) => ({ x: 80 + i * 7, y: 62 + (i % 2) * 8, text: WOLVES[w as WolfKind].name.toUpperCase(), tone: "wolf" as const }))] : []}
        />
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        {!token ? (
          <Card title={msg("scent.giveHimAToken")}>
            <EmptyState mood="happy" title={msg("scent.pasteATokenAddress")}>{msg("scent.pasteAnAddressOrTryOne")}</EmptyState>
            <div className="m-chips">{EXAMPLES.map(([n, a]) => <button key={a} type="button" className="m-chip" onClick={() => navigate(`/app/scent/${a}`)}>{n}</button>)}</div>
          </Card>
        ) : report.isLoading ? <Skeleton h={240} /> : report.isError ? (
          <Card title={msg("scent.couldNotSniff")}><p className="m-note m-note--bad">{describeError(report.error)}</p></Card>
        ) : r ? (
          <div className="m-grid-2 m-grid-2--l">
            <Card title={`${r.symbol ?? "?"} · ${r.name ?? msg("scent.unknown")}`} kicker={msg("scent.tokenKicker", { token: `${r.token.slice(0, 10)}…`, env: r.environment.toUpperCase(), decimals: r.decimals ?? "?" })}>
              <table className="m-table">
                <thead><tr><th>{msg("scent.check")}</th><th>{msg("scent.result")}</th><th>{msg("scent.detail")}</th></tr></thead>
                <tbody>
                  {r.checks.map((c) => (
                    <tr key={c.id}><td><b>{c.id}</b></td><td><Tag tone={c.ok === true ? "ok" : c.ok === false ? "bad" : "ghost"}>{c.ok === true ? "passed" : c.ok === false ? msg("scent.redFlag") : msg("scent.notRun")}</Tag></td><td className="m-small">{c.detail}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title={msg("scent.wolves")} kicker={`${r.wolves.length} FOUND`} tone={r.wolves.length ? "terra" : "sea"}>
              {r.wolves.length === 0 ? <EmptyState mood="proud" title={msg("scent.noRedFlagsFound")}>{msg("scent.thatIsNotSafeItMeans")}</EmptyState> : r.wolves.map((w) => (
                <div key={w} className="m-row"><Tag tone="wolf">{w}</Tag><div><b>{WOLVES[w as WolfKind].name}</b><p className="m-small m-muted">{WOLVES[w as WolfKind].line}</p></div></div>
              ))}
              {"warning" in r.trust ? <p className="m-note" style={{ marginTop: 8 }}>{r.trust.warning}</p> : null}
              <div className="m-row" style={{ marginTop: 8 }}>
                <Tag tone={compliance.data ? (compliance.data.result === "approved" ? "ok" : compliance.data.result === "denied" ? "bad" : "ochre") : "ghost"}>{msg("scent.compliance")}</Tag>
                <p className="m-small">{compliance.data ? `${compliance.data.result}${compliance.data.reasons?.length ? ` · ${compliance.data.reasons.join(", ")}` : ""} (${compliance.data.provider ?? "Circle"})` : compliance.isLoading ? "…" : availabilityOf(compliance.error) === "needs-key" ? (msg("scent.circleComplianceScreeningNeedsAKey")) : msg("scent.circleComplianceScreeningIsComingSoon")}</p>
              </div>
            </Card>
          </div>
        ) : null}
      </section>
    </div>
  );
}
