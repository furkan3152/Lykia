/** Activity: everything Lykia did or is doing for you, newest first: intents, orders and alerts. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../app/routes/history";
import { DeskTabs } from "../../features/desk/DeskTabs";
import { useSiwe } from "../../features/session/useSiwe";
import { apiFetch, apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Card, EmptyState, Field, Input, PageHead, Skeleton, Stat, Tag, Toggle, toast } from "../../mosaic";

interface Item { readonly type: "intent" | "order" | "alert"; readonly id: string; readonly at: string; readonly title: string; readonly status: string; readonly detail: string; readonly link: string }

interface Tracked { readonly status: "pending" | "success" | "reverted" | "not-found"; readonly block: string | null; readonly from: string | null; readonly to: string | null; readonly toLabel: string | null; readonly gasUsed: string | null; readonly logs: readonly { emitter: string; label: string | null }[]; readonly explorer: string }
interface Watched { readonly address: string; readonly label: string; readonly addedAt: string }

const TONE: Record<string, "ok" | "ochre" | "bad" | "sea" | "ghost"> = { settled: "ok", filled: "sea", running: "ochre", open: "ok", waiting: "ochre", planned: "ghost", failed: "bad", denied: "bad", invalid: "bad", stopped: "ghost", cancelled: "ghost", expired: "ghost", new: "ochre", read: "ghost" };

export default function ActivityPage() {
  const environment = useEnvironment();
  const siwe = useSiwe();
  const [type, setType] = useState<"all" | Item["type"]>("all");
  const feed = useQuery({ queryKey: ["activity", siwe.address, environment], enabled: siwe.signedIn, refetchInterval: 20_000, queryFn: ({ signal }) => apiGet<{ items: Item[]; counts: Record<string, number> }>("/v1/activity", { query: { environment }, signal }) });
  const items = (feed.data?.items ?? []).filter((i) => type === "all" || i.type === type);
  const go = (i: Item) => navigate(i.type === "intent" ? `/app/outrun/${i.id}` : i.link.startsWith("/app") ? i.link : i.type === "order" ? "/app/orders" : "/app/alerts");
  return (
    <div>
      <PageHead kicker={"DESK · ACTIVITY"} title={<>The whole <em>trail.</em></>} sub={"Every intent with its step progress, every conditional order with its live status, every alert that fired. Track any Arc transaction and keep a watchlist of addresses."} mood="watching">
        <DeskTabs />
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        {!siwe.signedIn ? (
          <Card title={"Sign in first"}>
            <EmptyState mood="happy" title={"Your trail is private"}>{"Sign in with your wallet to read it."}</EmptyState>
            <div className="m-center"><Button onClick={() => void siwe.signIn()} disabled={siwe.busy || !siwe.address}>{siwe.address ? "SIGN IN" : "CONNECT A WALLET"}</Button></div>
          </Card>
        ) : (
          <Card title={"Trail"} kicker={`ARC ${environment.toUpperCase()}`}>
            <div className="m-grid-3" style={{ gap: 8, marginBottom: 12 }}>
              <Stat label="Intents" value={<span className="num">{feed.data?.counts.intents ?? "…"}</span>} />
              <Stat label="Orders" value={<span className="num">{feed.data?.counts.orders ?? "…"}</span>} />
              <Stat label="Alerts" value={<span className="num">{feed.data?.counts.alerts ?? "…"}</span>} />
            </div>
            <div className="m-scroll-x" style={{ marginBottom: 10 }}><Toggle label="Filter" value={type} onChange={setType} options={[{ value: "all", label: "All" }, { value: "intent", label: "Intents" }, { value: "order", label: "Orders" }, { value: "alert", label: "Alerts" }]} /></div>
            {feed.isLoading ? <Skeleton h={200} /> : feed.isError ? <p className="m-note m-note--bad">{describeError(feed.error)}</p> : items.length === 0 ? <EmptyState mood="watching" title={"Nothing yet"}>{"Ask Lyko for something, arm an order or set an alert."}</EmptyState> : items.map((i) => (
              <button key={`${i.type}-${i.id}`} type="button" className="m-row" style={{ width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", flexWrap: "wrap" }} onClick={() => go(i)}>
                <Tag tone="ghost">{i.type}</Tag>
                <Tag tone={TONE[i.status] ?? "ghost"}>{i.status}</Tag>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}><b className="m-small">{i.title}</b><p className="m-small m-muted">{i.detail}</p></div>
                <span className="m-small m-muted num">{new Date(i.at).toLocaleString("en-US")}</span>
              </button>
            ))}
          </Card>
        )}
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <TxTracker environment={environment} />
          {siwe.signedIn ? <Watchlist /> : null}
        </div>
      </section>
    </div>
  );
}

function TxTracker({ environment }: { readonly environment: string }) {
  const [hash, setHash] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const tx = useQuery<Tracked>({ queryKey: ["track", target, environment], enabled: Boolean(target), refetchInterval: (q) => (q.state.data?.status === "pending" ? 2000 : false), queryFn: ({ signal }) => apiGet<Tracked>(`/v1/track/${target}`, { query: { environment }, signal }) });
  const t = tx.data;
  return (
    <Card title={"Track a transaction"} kicker={"ANY ARC TX · LOGS LABELLED"}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (/^0x[0-9a-fA-F]{64}$/u.test(hash.trim())) setTarget(hash.trim()); else toast.warning("A transaction hash is 0x and 64 hex characters", { from: "LYKO" }); }}>
        <Input placeholder="0x… transaction hash" value={hash} onChange={(e) => setHash(e.target.value)} aria-label="Transaction hash" />
        <Button type="submit">{"TRACK"}</Button>
      </form>
      {tx.isLoading ? <Skeleton h={80} /> : tx.isError ? <p className="m-note m-note--bad">{describeError(tx.error)}</p> : t ? (
        <div style={{ marginTop: 10 }}>
          <div className="m-row"><Tag tone={t.status === "success" ? "ok" : t.status === "reverted" ? "bad" : t.status === "pending" ? "ochre" : "ghost"}>{t.status}</Tag><p className="m-small">{t.block ? `Block ${Number(t.block).toLocaleString("en-US")} · final` : t.status === "pending" ? "Waiting for inclusion; Arc finalizes in under a second." : "The node does not know this hash on this network."}{t.toLabel ? ` · to ${t.toLabel}` : ""}</p></div>
          {t.logs.length ? <table className="m-table"><thead><tr><th>Emitter</th><th>What</th></tr></thead><tbody>{t.logs.slice(0, 12).map((l, i) => <tr key={`${l.emitter}-${i}`}><td className="m-small num">{`${l.emitter.slice(0, 8)}…${l.emitter.slice(-4)}`}</td><td className="m-small">{l.label ?? "unlabelled contract"}</td></tr>)}</tbody></table> : null}
          <a className="m-small" href={t.explorer} target="_blank" rel="noreferrer">{"Open in the explorer ↗"}</a>
        </div>
      ) : <p className="m-small m-muted" style={{ marginTop: 8 }}>{"Paste a hash from any wallet or app; Lykia labels each contract it touched from its registry."}</p>}
    </Card>
  );
}

function Watchlist() {
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const list = useQuery({ queryKey: ["watch"], queryFn: ({ signal }) => apiGet<{ items: Watched[] }>("/v1/watch", { signal }) });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["watch"] });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  return (
    <Card title={"Watchlist"} kicker={list.data ? `${list.data.items.length} / 50` : "…"} tone="sea">
      <div className="m-grid-2" style={{ gap: 8 }}>
        <Field label="Address"><Input placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Label"><Input placeholder="Treasury" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      </div>
      <Button size="sm" tone="sea" disabled={!/^0x[0-9a-fA-F]{40}$/u.test(address.trim())} onClick={() => void run(async () => { await apiPost("/v1/watch", { address: address.trim(), label: label.trim() }); setAddress(""); setLabel(""); })}>{"WATCH"}</Button>
      {list.data?.items.map((w) => (
        <div key={w.address} className="m-row">
          <div style={{ flex: 1, minWidth: 0 }}><b className="m-small">{w.label || "Unnamed"}</b><p className="m-small m-muted num">{`${w.address.slice(0, 8)}…${w.address.slice(-6)}`}</p></div>
          <Button size="sm" tone="ghost" onClick={() => navigate(`/app/flock/${w.address}`)}>{"FLOCK"}</Button>
          <Button size="sm" tone="ghost" onClick={() => void run(() => apiFetch(`/v1/watch/${w.address}`, { method: "DELETE" }))}>{"REMOVE"}</Button>
        </div>
      ))}
    </Card>
  );
}
