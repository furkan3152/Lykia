/**
 * The Flock: everything an address holds on Arc mainnet and testnet, drawn
 * as a pasture (wallet sheep, venue pens, the Gateway ferry) with insights
 * that turn into one-tap proposals.
 */
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { InsightsResponse } from "@lykia/core/api/agents";
import type { UnsignedTransaction } from "@lykia/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../app/routes/history";
import { useRouteParam, useSearchParam } from "../../app/routes/useRoute";
import { useAsk } from "../../features/ask/store";
import { GatewayCard } from "../../features/circle/Circle";
import { isBoth, isSnapshot, useFlock } from "../../features/data/hooks";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { useWallet } from "../../features/wallet/store";
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import { apiGet, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useLamp } from "../../lib/pulseStore";
import { Button, Card, EmptyState, Input, MeanderBand, PageHead, Skeleton, Stat, Tag, Toggle, toast } from "../../mosaic";
import { pasture, PASTURE_H, PASTURE_W } from "../../mosaic/scenes";

const usd = (v: string | null | undefined) => (v === null || v === undefined ? "unpriced" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

function SnapshotView({ s }: { s: FlockSnapshot }) {
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
          ...(s.gateway.unifiedUsdc && Number(s.gateway.unifiedUsdc) > 0 ? [{ x: 13, y: 40, text: "GATEWAY FERRY", tone: "sea" as const }] : []),
          ...(holdings.some((h) => h.where === "wallet") ? [{ x: 45, y: 55, text: "WALLET FLOCK" }] : [{ x: 50, y: 60, text: "AN EMPTY PASTURE", tone: "ghost" as const }]),
          ...(holdings.some((h) => h.where !== "wallet" && h.where !== "gateway" && h.kind !== "debt") ? [{ x: 86, y: 55, text: "VENUE PENS", tone: "ochre" as const }] : []),
        ]}
      />
      <div className="m-grid-4">
        <div className="m-frame"><Stat label={"TOTAL"} value={usd(s.totalUsd)} hint={s.totalUsd === null ? ("something is unpriced") : undefined} /></div>
        <div className="m-frame"><Stat label="GATEWAY" value={s.gateway.unifiedUsdc === null ? "n/a" : `${Number(s.gateway.unifiedUsdc).toFixed(2)}`} hint="USDC" /></div>
        <div className="m-frame"><Stat label={"GAS (NATIVE USDC)"} value={(Number(s.native.usdc18) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 })} /></div>
        <div className="m-frame"><Stat label={"PLACES"} value={places.length} hint={places.join(" · ")} /></div>
      </div>
      <Card title={"Holdings"} kicker={`ARC ${s.environment.toUpperCase()} · ${new Date(s.at).toLocaleTimeString()}`}>
        {s.holdings.length === 0 ? (
          <EmptyState mood="sleeping" title={"The pasture is empty"}>{"No registry tokens at this address."}</EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table className="m-table">
            <thead>
              <tr>
                <th>{"Token"}</th>
                <th>{"Where"}</th>
                <th>{"Kind"}</th>
                <th className="r">{"Amount"}</th>
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
  const environment = useEnvironment();
  const lykiaWallet = useLykiaWallet();
  const wallet = lykiaWallet.address;
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
  const openModal = useWallet((s) => s.openModal);
  const qc = useQueryClient();
  const [revoking, setRevoking] = useState<string | null>(null);
  const revoke = async (id: string, txs: readonly UnsignedTransaction[]) => {
    if (!lykiaWallet.connected) return openModal();
    if (address && lykiaWallet.address && address.toLowerCase() !== lykiaWallet.address.toLowerCase()) return toast.warning("This is someone else's flock", { description: "Only the connected wallet can sign its own fixes.", from: "LYKO" });
    setRevoking(id);
    try {
      await lykiaWallet.send(txs);
      toast.success("Fix signed", { description: "Final on Arc; Lyko re-counts the flock.", from: "LYKO" });
      void qc.invalidateQueries({ queryKey: ["insights"] });
    } catch (e) {
      toast.error("Not signed", { description: describeError(e), from: "LYKO" });
    } finally {
      setRevoking(null);
    }
  };

  const data = flock.data;
  const panels: { title: string; s: FlockSnapshot | { error: string } }[] = isBoth(data) ? [{ title: "ARC MAINNET", s: data.mainnet }, { title: "ARC TESTNET", s: data.testnet }] : data ? [{ title: `ARC ${environment.toUpperCase()}`, s: data }] : [];

  return (
    <div>
      <PageHead kicker={"FLOCK · EVERYTHING ON ARC"} title={<>Count your <em>flock.</em></>} sub={"Wallet, Gateway and venues, mainnet and testnet side by side. Anything without a price reads \"unpriced\", never zero."} mood="watching">
        <div className="flex justify-center gap-3 flex-wrap" style={{ marginTop: 18 }}>
          <Toggle light label="Scope" value={scope} onChange={setScope} options={[{ value: "both", label: "BOTH NETWORKS" }, { value: "one", label: environment.toUpperCase() }]} />
          {address ? <Tag tone={param || as ? "ochre" : "ghost"}>{param || as ? "VIEW ONLY · " : ""}{address.slice(0, 6)}…{address.slice(-4)}</Tag> : null}
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        {!address ? (
          <Card title={"Whose flock?"} kicker={"CONNECT A WALLET OR PASTE AN ADDRESS"}>
            <EmptyState mood="sleeping" title={"Lyko is asleep"}>{"Give him an address and he counts the flock."}</EmptyState>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (/^0x[0-9a-fA-F]{40}$/u.test(draft)) navigate(`/app/flock/${draft}`); }}>
              <Input placeholder="0x…" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <Button type="submit" tone="sea">{"COUNT"}</Button>
            </form>
          </Card>
        ) : flock.isLoading ? (
          <div style={{ display: "grid", gap: 16 }}>
            <Skeleton h={360} />
            <Skeleton h={120} />
          </div>
        ) : flock.isError ? (
          <Card title={"The flock could not be read"}><p className="m-note m-note--bad">{describeError(flock.error)}</p></Card>
        ) : (
          <div style={{ display: "grid", gap: 40, gridTemplateColumns: "minmax(0, 1fr)" }}>
            {panels.map((p) => (
              <div key={p.title}>
                <p className="m-kick m-center" style={{ marginBottom: 12 }}>{p.title}</p>
                {isSnapshot(p.s) ? <SnapshotView s={p.s} /> : <p className="m-note m-note--bad">{(p.s as { error: string }).error}</p>}
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
              <Card title="Circle" kicker={"EVERY PRODUCT ON ARC"} footer={<Button tone="ghost" onClick={() => navigate("/app/circle")}>{"OPEN THE MARKET"}</Button>}>
                <p className="m-small">{"Gateway, CCTP V2, StableFX, Paymaster, compliance screening, nanopayments and USYC: what is live and what needs a key, at a glance."}</p>
              </Card>
            </div>
          </section>
          <MeanderBand className="mt-12" />
          <section className="m-wrap" style={{ marginTop: 32 }}>
            <h2 className="m-h2">{"Lyko noticed"}</h2>
            <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 24 }}>
              {insights.isLoading ? [0, 1, 2].map((i) => <Skeleton key={i} h={140} w={360} />) : null}
              {insights.data?.insights.length === 0 ? <p className="m-muted m-center" style={{ gridColumn: "1 / -1" }}>{"Nothing to flag right now."}</p> : null}
              {insights.data?.insights.map((ins) => (
                <Card key={ins.id} style={{ width: "min(372px, 100%)" }} title={ins.title} kicker={`${ins.kind.toUpperCase()} · ${ins.severity.toUpperCase()}`} tone={ins.severity === "act" ? "terra" : "sea"} footer={ins.transactions && ins.transactions.length > 0 ? <Button size="sm" tone="terra" disabled={revoking === ins.id} onClick={() => void revoke(ins.id, ins.transactions!)}>{revoking === ins.id ? "SIGNING…" : lykiaWallet.connected ? (ins.kind === "stale-approval" ? "REVOKE" : "SIGN FIX") : "CONNECT TO FIX"}</Button> : ins.proposal ? <Button size="sm" onClick={() => { begin(ins.proposal!); navigate("/app"); }}>{"ONE TAP"}</Button> : undefined}>
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
