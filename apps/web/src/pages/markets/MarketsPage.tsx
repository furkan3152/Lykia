/** Perps markets from Extended (collateral on Arc), read-only: price, funding, open interest, candles and the book. */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { navigate } from "../../app/routes/history";
import { useAsk } from "../../features/ask/store";
import { usd } from "../../features/desk/format";
import { apiGet, describeError } from "../../lib/api";
import { Button, Card, Input, PageHead, Skeleton, Stat, Tag } from "../../mosaic";

interface Market { readonly market: string; readonly category: string; readonly lastPrice: string | null; readonly markPrice: string | null; readonly change24h: string | null; readonly volume24h: string | null; readonly fundingRate: string | null; readonly openInterest: string | null; readonly maxLeverage: string | null }
interface Markets { readonly venue: string; readonly collateralOn: string; readonly markets: readonly Market[]; readonly notes: readonly string[] }
interface Candle { readonly o: string; readonly h: string; readonly l: string; readonly c: string; readonly v: string; readonly T: number }
interface Level { readonly qty: string; readonly price: string }
interface Detail { readonly market: string; readonly candles: readonly Candle[]; readonly orderbook: { bid: readonly Level[]; ask: readonly Level[] }; readonly trades: readonly { p: string; q: string; S?: string; T: number }[] }

const pct = (v: string | null, digits = 2) => (v === null ? "n/a" : `${(Number(v) * 100).toFixed(digits)}%`);
const px = (v: string | number | null) => (v === null ? "n/a" : Number(v).toLocaleString("en-US", { maximumFractionDigits: Number(v) >= 10_000 ? 0 : Number(v) < 10 ? 5 : 2 }));

/** Candles painted as chunky pixels on a navy tile, in the Mosaic palette. */
function CandleChart({ candles, label }: { readonly candles: readonly Candle[]; readonly label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || candles.length === 0) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const cell = 3;
      const w = Math.max(60, Math.floor(rect.width / cell));
      const h = Math.max(40, Math.floor(rect.height / cell));
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d");
      if (!g) return;
      g.fillStyle = "#13233a";
      g.fillRect(0, 0, w, h);
      const rows = [...candles].sort((a, b) => a.T - b.T).slice(-Math.floor((w - 4) / 3));
      const hi = Math.max(...rows.map((c) => Number(c.h)));
      const lo = Math.min(...rows.map((c) => Number(c.l)));
      const span = hi - lo || 1;
      const y = (v: string) => 2 + Math.round(((hi - Number(v)) / span) * (h - 5));
      g.fillStyle = "#1d3352";
      for (let gy = 0; gy < h; gy += 10) g.fillRect(0, gy, w, 1);
      rows.forEach((c, i) => {
        const x = 2 + i * 3;
        const up = Number(c.c) >= Number(c.o);
        g.fillStyle = up ? "#5f8a3a" : "#b9472e";
        g.fillRect(x + 1, y(c.h), 1, Math.max(1, y(c.l) - y(c.h) + 1));
        const top = Math.min(y(c.o), y(c.c));
        g.fillRect(x, top, 2, Math.max(1, Math.abs(y(c.o) - y(c.c)) + 1));
      });
      const last = rows[rows.length - 1];
      if (last) {
        g.fillStyle = "#d9a441";
        g.fillRect(0, y(last.c), w, 1);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [candles]);
  return <canvas ref={ref} className="m-chart" role="img" aria-label={label} />;
}

export default function MarketsPage() {
  const [selected, setSelected] = useState("BTC-USD");
  const [filter, setFilter] = useState("");
  const list = useQuery({ queryKey: ["perps-markets"], refetchInterval: 30_000, queryFn: ({ signal }) => apiGet<Markets>("/v1/perps/markets", { signal, timeoutMs: 12_000 }) });
  const detail = useQuery({ queryKey: ["perps-market", selected], refetchInterval: 10_000, queryFn: ({ signal }) => apiGet<Detail>(`/v1/perps/markets/${selected}`, { signal, timeoutMs: 12_000 }) });
  const m = list.data?.markets.find((x) => x.market === selected) ?? null;
  const shown = useMemo(() => (list.data?.markets ?? []).filter((x) => x.market.toLowerCase().includes(filter.toLowerCase())).slice(0, 40), [list.data, filter]);
  const bids = detail.data?.orderbook.bid.slice(0, 10) ?? [];
  const asks = detail.data?.orderbook.ask.slice(0, 10) ?? [];
  const hedgeable = selected === "BTC-USD" || selected === "EUR-USD";
  return (
    <div>
      <PageHead kicker={"MORE · PERPS MARKETS · READ ONLY"} title={<>Read the <em>perps.</em></>} sub={"Live perpetuals data from Extended, whose USDC collateral sits on Arc. Trading happens on Extended's own engine with an Extended account; Lykia shows the market and lets you hedge on Arc itself with conditional orders."} mood="watching" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2 m-grid-2--l">
          <Card title={selected} kicker={m ? `${m.category.toUpperCase()} · UP TO ${Number(m.maxLeverage ?? 0)}× ON EXTENDED` : "…"}>
            <div className="m-grid-4 m-stats4" style={{ gap: 8 }}>
              <Stat label="Mark" value={<span className="num">{px(m?.markPrice ?? null)}</span>} />
              <Stat label="24h" value={<span className="num" style={{ color: Number(m?.change24h ?? 0) >= 0 ? "var(--ok)" : "var(--bad)" }}>{pct(m?.change24h ?? null)}</span>} />
              <Stat label="Funding (1h)" value={<span className="num">{pct(m?.fundingRate ?? null, 4)}</span>} />
              <Stat label="Open interest" value={<span className="num">{usd(m?.openInterest ?? null)}</span>} />
            </div>
            <div style={{ marginTop: 12 }}>
              {detail.isLoading ? <Skeleton h={300} /> : detail.isError ? <p className="m-note m-note--bad">{describeError(detail.error)}</p> : <CandleChart candles={detail.data?.candles ?? []} label={`${selected} hourly candles, last 7 days`} />}
            </div>
            <p className="m-small m-muted" style={{ marginTop: 8 }}>{"Hourly candles, last 7 days. Ochre line: last close."}</p>
            {hedgeable ? (
              <div className="m-note" style={{ marginTop: 10 }}>
                {`Hedge on Arc: a stop-loss on ${selected === "BTC-USD" ? "cirBTC" : "EURC"} sells into USDC when Chainlink crosses your level, without leaving Arc.`}
                <div style={{ marginTop: 8 }}><Button size="sm" onClick={() => { useAsk.getState().setPrefill(`Set a stop-loss on my ${selected === "BTC-USD" ? "cirBTC" : "EURC"}: sell `); navigate("/app"); }}>{"SET A STOP-LOSS IN ASK LYKO"}</Button></div>
              </div>
            ) : null}
          </Card>
          <Card title={"Order book"} kicker={"TOP 10 · EXTENDED"} tone="sea">
            {detail.isLoading ? <Skeleton h={260} /> : (
              <div className="m-book num">
                <div className="m-small m-muted"><span>BID</span><span>SIZE</span></div>
                <div className="m-small m-muted"><span>ASK</span><span>SIZE</span></div>
                {Array.from({ length: Math.max(bids.length, asks.length) }, (_, i) => (
                  <FragmentRow key={i} bid={bids[i]} ask={asks[i]} />
                ))}
              </div>
            )}
            {detail.data?.trades?.length ? (
              <>
                <p className="m-small m-muted" style={{ marginTop: 12 }}>{"RECENT TRADES"}</p>
                {detail.data.trades.slice(0, 8).map((t, i) => (
                  <div key={`${t.T}-${i}`} className="m-small num flex justify-between"><span style={{ color: t.S === "SELL" ? "var(--bad)" : "var(--ok)" }}>{px(t.p)}</span><span>{t.q}</span><span className="m-muted">{new Date(t.T).toLocaleTimeString("en-US")}</span></div>
                ))}
              </>
            ) : null}
          </Card>
        </div>
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <Card title={"Markets"} kicker={list.data ? `${list.data.markets.length} ACTIVE · BY 24H VOLUME` : "…"}>
          <div style={{ maxWidth: 320, marginBottom: 10 }}><Input placeholder="Filter, e.g. ETH" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter markets" /></div>
          {list.isLoading ? <Skeleton h={200} /> : list.isError ? <p className="m-note m-note--bad">{describeError(list.error)}</p> : (
            <div className="m-scroll-x">
              <table className="m-table">
                <thead><tr><th>Market</th><th className="r">Mark</th><th className="r">24h</th><th className="r">Volume</th><th className="r">Funding</th><th className="r">OI</th></tr></thead>
                <tbody>
                  {shown.map((x) => (
                    <tr key={x.market} className={x.market === selected ? "win" : undefined} onClick={() => setSelected(x.market)} style={{ cursor: "pointer" }}>
                      <td><b>{x.market}</b> <Tag tone="ghost">{x.category}</Tag></td>
                      <td className="r num">{px(x.markPrice)}</td>
                      <td className="r num" style={{ color: Number(x.change24h ?? 0) >= 0 ? "var(--ok)" : "var(--bad)" }}>{pct(x.change24h)}</td>
                      <td className="r num">{usd(x.volume24h)}</td>
                      <td className="r num">{pct(x.fundingRate, 4)}</td>
                      <td className="r num">{usd(x.openInterest)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.data?.notes.map((n) => <p key={n} className="m-small m-muted" style={{ marginTop: 6 }}>{n}</p>)}
        </Card>
      </section>
    </div>
  );
}

function FragmentRow({ bid, ask }: { readonly bid: Level | undefined; readonly ask: Level | undefined }) {
  return (
    <>
      <div style={{ background: bid ? "#e8f2df" : undefined }}><span>{bid ? px(bid.price) : ""}</span><span>{bid?.qty ?? ""}</span></div>
      <div style={{ background: ask ? "#f7e3dc" : undefined }}><span>{ask ? px(ask.price) : ""}</span><span>{ask?.qty ?? ""}</span></div>
    </>
  );
}
