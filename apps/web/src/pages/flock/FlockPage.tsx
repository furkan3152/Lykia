/**
 * The Flock: everything an address holds on Arc mainnet and testnet, drawn
 * as a pasture (wallet sheep, venue pens, the Gateway ferry) with insights
 * that turn into one-tap proposals.
 */
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { InsightsResponse } from "@lykia/core/api/agents";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";

import { navigate } from "../../app/routes/history";
import { useRouteParam, useSearchParam } from "../../app/routes/useRoute";
import { useAsk } from "../../features/ask/store";
import { GatewayCard } from "../../features/circle/Circle";
import { isBoth, isSnapshot, useFlock } from "../../features/data/hooks";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { apiGet, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLang } from "../../lib/i18n";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useLamp } from "../../lib/pulseStore";
import { Button, Card, EmptyState, Input, MeanderBand, PageHead, Skeleton, Stat, Tag, Toggle } from "../../mosaic";
import { pasture, PASTURE_H, PASTURE_W } from "../../mosaic/scenes";

const usd = (v: string | null | undefined) => (v === null || v === undefined ? "unpriced" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

function SnapshotView({ s, lang }: { s: FlockSnapshot; lang: "en" | "tr" }) {
  const lit = useLamp();
  const night = useLykiaStore((st) => st.fence.mode === "whistle");
  const holdings = s.holdings.map((h) => ({ symbol: h.symbol, usd: h.usd === null ? null : Number(h.usd), where: h.where, kind: h.kind }));
  const places = [...new Set(s.holdings.map((h) => h.where))];
  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <SceneFrame
        build={(t) => pasture({ holdings, gatewayUsdc: s.gateway.unifiedUsdc === null ? null : Number(s.gateway.unifiedUsdc), lit, night }, t)}
        width={PASTURE_W}
        height={PASTURE_H}
        dataKey={`${s.at}-${lit}-${night}`}
        assembleKey={`${s.address}-${s.environment}`}
        night={night}
        label={`The pasture of ${s.address} on Arc ${s.environment}`}
        labels={[
          ...(s.gateway.unifiedUsdc && Number(s.gateway.unifiedUsdc) > 0 ? [{ x: 13, y: 40, text: lang === "tr" ? "GATEWAY FERİBOTU" : "GATEWAY FERRY", tone: "sea" as const }] : []),
          ...(holdings.some((h) => h.where === "wallet") ? [{ x: 45, y: 55, text: lang === "tr" ? "CÜZDAN SÜRÜSÜ" : "WALLET FLOCK" }] : [{ x: 50, y: 60, text: lang === "tr" ? "MERA BOŞ" : "AN EMPTY PASTURE", tone: "ghost" as const }]),
          ...(holdings.some((h) => h.where !== "wallet" && h.where !== "gateway" && h.kind !== "debt") ? [{ x: 86, y: 55, text: lang === "tr" ? "VENUE AĞILLARI" : "VENUE PENS", tone: "ochre" as const }] : []),
        ]}
      />
      <div className="m-grid-4">
        <div className="m-frame"><Stat label={lang === "tr" ? "TOPLAM" : "TOTAL"} value={usd(s.totalUsd)} hint={s.totalUsd === null ? (lang === "tr" ? "bir şey fiyatsız" : "something is unpriced") : undefined} /></div>
        <div className="m-frame"><Stat label="GATEWAY" value={s.gateway.unifiedUsdc === null ? "n/a" : `${Number(s.gateway.unifiedUsdc).toFixed(2)}`} hint="USDC" /></div>
        <div className="m-frame"><Stat label={lang === "tr" ? "GAS (NATIVE USDC)" : "GAS (NATIVE USDC)"} value={(Number(s.native.usdc18) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 })} /></div>
        <div className="m-frame"><Stat label={lang === "tr" ? "YER" : "PLACES"} value={places.length} hint={places.join(" · ")} /></div>
      </div>
      <Card title={lang === "tr" ? "Varlıklar" : "Holdings"} kicker={`ARC ${s.environment.toUpperCase()} · ${new Date(s.at).toLocaleTimeString()}`}>
        {s.holdings.length === 0 ? (
          <EmptyState mood="sleeping" title={lang === "tr" ? "Mera boş" : "The pasture is empty"}>{lang === "tr" ? "Bu adreste kayıtlı token yok." : "No registry tokens at this address."}</EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table className="m-table">
            <thead>
              <tr>
                <th>{lang === "tr" ? "Token" : "Token"}</th>
                <th>{lang === "tr" ? "Nerede" : "Where"}</th>
                <th>{lang === "tr" ? "Tür" : "Kind"}</th>
                <th className="r">{lang === "tr" ? "Miktar" : "Amount"}</th>
                <th className="r">USD</th>
              </tr>
            </thead>
            <tbody>
              {s.holdings.map((h, i) => (
                <tr key={`${h.symbol}-${h.where}-${i}`}>
                  <td><b>{h.symbol}</b></td>
                  <td>{h.where}</td>
                  <td><Tag tone={h.kind === "debt" ? "bad" : h.kind === "token" ? "ghost" : "sea"}>{h.kind}</Tag></td>
                  <td className="r num">{h.amount}</td>
                  <td className="r num">{usd(h.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {s.health.length > 0 ? (
          <div className="flex gap-2 flex-wrap" style={{ marginTop: 10 }}>
            {s.health.map((h) => (
              <Tag key={h.venue} tone={h.healthFactor !== null && Number(h.healthFactor) < 1.5 ? "bad" : "ok"}>
                {h.venue} · HF {h.healthFactor ?? "n/a"}
              </Tag>
            ))}
          </div>
        ) : null}
        {s.notes.map((n) => <p key={n} className="m-note" style={{ marginTop: 8 }}>{n}</p>)}
      </Card>
    </div>
  );
}

export default function FlockPage() {
  const lang = useLang();
  const environment = useEnvironment();
  const { address: wallet } = useAccount();
  const param = useRouteParam("address");
  const as = useSearchParam("as");
  const [scope, setScope] = useState<"one" | "both">("both");
  const [draft, setDraft] = useState("");
  const address = (param ?? as ?? wallet ?? null) as string | null;
  const flock = useFlock(address, scope === "both" ? "both" : environment);
  const insights = useQuery({
    queryKey: ["insights", address, environment],
    enabled: Boolean(address),
    queryFn: ({ signal }) => apiGet<InsightsResponse>("/v1/agent/insights", { query: { owner: address, environment }, signal, timeoutMs: 20_000 }),
  });
  const begin = useAsk((s) => s.begin);

  const data = flock.data;
  const panels: { title: string; s: FlockSnapshot | { error: string } }[] = isBoth(data) ? [{ title: "ARC MAINNET", s: data.mainnet }, { title: "ARC TESTNET", s: data.testnet }] : data ? [{ title: `ARC ${environment.toUpperCase()}`, s: data }] : [];

  return (
    <div>
      <PageHead kicker={lang === "tr" ? "SÜRÜ · ARC'TAKİ HER ŞEY" : "FLOCK · EVERYTHING ON ARC"} title={lang === "tr" ? <>Sürünü <em>say.</em></> : <>Count your <em>flock.</em></>} sub={lang === "tr" ? "Cüzdan, Gateway ve venue'lar, mainnet ve testnet yan yana. Fiyatı olmayan her şey \"fiyatsız\" yazar, asla sıfır değil." : "Wallet, Gateway and venues, mainnet and testnet side by side. Anything without a price reads \"unpriced\", never zero."} mood="watching">
        <div className="flex justify-center gap-3 flex-wrap" style={{ marginTop: 18 }}>
          <Toggle light label="Scope" value={scope} onChange={setScope} options={[{ value: "both", label: lang === "tr" ? "İKİ AĞ" : "BOTH NETWORKS" }, { value: "one", label: environment.toUpperCase() }]} />
          {address ? <Tag tone={param || as ? "ochre" : "ghost"}>{param || as ? "VIEW ONLY · " : ""}{address.slice(0, 6)}…{address.slice(-4)}</Tag> : null}
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        {!address ? (
          <Card title={lang === "tr" ? "Hangi sürü?" : "Whose flock?"} kicker={lang === "tr" ? "CÜZDAN BAĞLA YA DA ADRES YAZ" : "CONNECT A WALLET OR PASTE AN ADDRESS"}>
            <EmptyState mood="sleeping" title={lang === "tr" ? "Lyko uyuyor" : "Lyko is asleep"}>{lang === "tr" ? "Bir adres ver, sürüyü saysın." : "Give him an address and he counts the flock."}</EmptyState>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (/^0x[0-9a-fA-F]{40}$/u.test(draft)) navigate(`/app/flock/${draft}`); }}>
              <Input placeholder="0x…" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <Button type="submit" tone="sea">{lang === "tr" ? "SAY" : "COUNT"}</Button>
            </form>
          </Card>
        ) : flock.isLoading ? (
          <div style={{ display: "grid", gap: 16 }}>
            <Skeleton h={360} />
            <Skeleton h={120} />
          </div>
        ) : flock.isError ? (
          <Card title={lang === "tr" ? "Sürü okunamadı" : "The flock could not be read"}><p className="m-note m-note--bad">{describeError(flock.error)}</p></Card>
        ) : (
          <div style={{ display: "grid", gap: 40, gridTemplateColumns: "minmax(0, 1fr)" }}>
            {panels.map((p) => (
              <div key={p.title}>
                <p className="m-kick m-center" style={{ marginBottom: 12 }}>{p.title}</p>
                {isSnapshot(p.s) ? <SnapshotView s={p.s} lang={lang} /> : <p className="m-note m-note--bad">{(p.s as { error: string }).error}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
      {address ? (
        <>
          <section className="m-wrap" style={{ marginTop: 32 }}>
            <div className="m-grid-2">
              <GatewayCard />
              <Card title="Circle" kicker={lang === "tr" ? "ARC ÜZERİNDEKİ TÜM ÜRÜNLER" : "EVERY PRODUCT ON ARC"} footer={<Button tone="ghost" onClick={() => navigate("/app/circle")}>{lang === "tr" ? "PAZARA GİT" : "OPEN THE MARKET"}</Button>}>
                <p className="m-small">{lang === "tr" ? "Gateway, CCTP V2, StableFX, Paymaster, uyum taraması, nanopayments ve USYC: hangisi canlı, hangisi anahtar ister, tek bakışta." : "Gateway, CCTP V2, StableFX, Paymaster, compliance screening, nanopayments and USYC: what is live and what needs a key, at a glance."}</p>
              </Card>
            </div>
          </section>
          <MeanderBand className="mt-12" />
          <section className="m-wrap" style={{ marginTop: 32 }}>
            <h2 className="m-h2">{lang === "tr" ? "Lyko'nun gözü" : "Lyko noticed"}</h2>
            <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 24 }}>
              {insights.isLoading ? [0, 1, 2].map((i) => <Skeleton key={i} h={140} w={360} />) : null}
              {insights.data?.insights.length === 0 ? <p className="m-muted m-center" style={{ gridColumn: "1 / -1" }}>{lang === "tr" ? "Şimdilik söylenecek bir şey yok." : "Nothing to flag right now."}</p> : null}
              {insights.data?.insights.map((ins) => (
                <Card key={ins.id} style={{ width: "min(372px, 100%)" }} title={ins.title} kicker={`${ins.kind.toUpperCase()} · ${ins.severity.toUpperCase()}`} tone={ins.severity === "act" ? "terra" : "sea"} footer={ins.proposal ? <Button size="sm" onClick={() => { begin(ins.proposal!); navigate("/app"); }}>{lang === "tr" ? "TEK DOKUNUŞ" : "ONE TAP"}</Button> : undefined}>
                  <p className="m-small">{ins.detail}</p>
                  {ins.proposal ? <p className="m-note" style={{ marginTop: 8 }}>“{ins.proposal}”</p> : null}
                </Card>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
