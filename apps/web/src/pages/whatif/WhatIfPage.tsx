/**
 * What-if: shock cirBTC and EURC and see the flock's value and health factors
 * move. PnL explain: which holding carries how much of the move. Computed in
 * the browser from the live flock snapshot; nothing is sent anywhere.
 */
import { useState } from "react";

import { navigate } from "../../app/routes/history";
import { isSnapshot, useFlock } from "../../features/data/hooks";
import { usd } from "../../features/desk/format";
import { applyShocks, SHOCKED, shockedHealth, type Shocks } from "../../features/desk/whatif";
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import { describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Card, EmptyState, Field, Input, PageHead, Skeleton, Stat, Tag } from "../../mosaic";

const PRESETS: readonly { label: string; shocks: Shocks }[] = [
  { label: "BTC −20%", shocks: { cirBTC: -20, EURC: 0 } },
  { label: "BTC −40%", shocks: { cirBTC: -40, EURC: 0 } },
  { label: "EUR −5%", shocks: { cirBTC: 0, EURC: -5 } },
  { label: "Risk-off", shocks: { cirBTC: -30, EURC: -3 } },
  { label: "BTC +25%", shocks: { cirBTC: 25, EURC: 0 } },
];

export default function WhatIfPage() {
  const environment = useEnvironment();
  const wallet = useLykiaWallet();
  const [address, setAddress] = useState("");
  const target = /^0x[0-9a-fA-F]{40}$/u.test(address.trim()) ? address.trim() : wallet.address ?? null;
  const flock = useFlock(target, environment);
  const [shocks, setShocks] = useState<Shocks>({ cirBTC: -20, EURC: 0 });
  const snap = isSnapshot(flock.data) ? flock.data : null;
  const result = snap ? applyShocks(snap.holdings, shocks) : null;
  const health = snap ? shockedHealth(snap, shocks) : [];
  const delta = result ? result.after - result.before : 0;
  const movers = result ? result.rows.filter((r) => r.after !== r.before).sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)) : [];
  return (
    <div>
      <PageHead kicker={"PORTFOLIO · WHAT-IF"} title={<>Stress-test <em>your portfolio.</em></>} sub={"Move cirBTC and EURC and watch your portfolio's value and health factors respond, with every dollar of the move explained by the holding that carries it. Computed in your browser from live balances."} mood="watching" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2 m-grid-2--r">
          <Card title={"Shocks"} kicker={"PRICE MOVES IN %"}>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="m-chips">{PRESETS.map((p) => <button key={p.label} type="button" className="m-chip" onClick={() => setShocks(p.shocks)}>{p.label}</button>)}</div>
              {SHOCKED.map((s) => (
                <Field key={s} label={`${s} ${shocks[s] >= 0 ? "+" : ""}${shocks[s]}%`}>
                  <input type="range" min={-80} max={80} step={1} value={shocks[s]} onChange={(e) => setShocks((c) => ({ ...c, [s]: Number(e.target.value) }))} aria-label={`${s} shock`} style={{ width: "100%" }} />
                </Field>
              ))}
              <Field label="Address (optional)" hint="Defaults to your connected wallet."><Input placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            </div>
          </Card>
          <Card title={"Result"} kicker={snap ? `ARC ${environment.toUpperCase()} · BLOCK ${snap.block ?? "?"}` : "…"} tone="sea">
            {!target ? <EmptyState mood="happy" title={"No portfolio yet"}>{"Connect a wallet or paste an address."}</EmptyState> : flock.isLoading ? <Skeleton h={200} /> : flock.isError ? <p className="m-note m-note--bad">{describeError(flock.error)}</p> : result ? (
              <>
                <div className="m-grid-3" style={{ gap: 8 }}>
                  <Stat label="Now" value={<span className="num">{usd(result.before)}</span>} />
                  <Stat label="After" value={<span className="num">{usd(result.after)}</span>} />
                  <Stat label="Change" value={<span className="num" style={{ color: delta >= 0 ? "var(--ok)" : "var(--bad)" }}>{`${delta >= 0 ? "+" : ""}${usd(delta)}`}</span>} hint={result.before ? `${((delta / Math.abs(result.before)) * 100).toFixed(1)}%` : undefined} />
                </div>
                {health.length ? (
                  <table className="m-table" style={{ marginTop: 12 }}>
                    <thead><tr><th>Venue</th><th className="r">Health now</th><th className="r">After (est.)</th></tr></thead>
                    <tbody>{health.map((h) => <tr key={h.venue}><td>{h.venue}</td><td className="r num">{h.before?.toFixed(2) ?? "n/a"}</td><td className="r num"><Tag tone={h.after === null ? "ghost" : h.after < 1 ? "bad" : h.after < 1.3 ? "ochre" : "ok"}>{h.after?.toFixed(2) ?? "n/a"}</Tag></td></tr>)}</tbody>
                  </table>
                ) : <p className="m-small m-muted" style={{ marginTop: 10 }}>{"No borrowing positions, so no health factor to stress."}</p>}
                {health.some((h) => h.after !== null && h.after < 1.1) ? (
                  <div className="m-note m-note--bad" style={{ marginTop: 10 }}>{"This shock brings a position near liquidation. A stop-loss on the collateral or a health alert gives you time."}<div className="flex gap-2" style={{ marginTop: 8 }}><Button size="sm" onClick={() => navigate("/app/orders")}>{"STOP-LOSS"}</Button><Button size="sm" tone="ghost" onClick={() => navigate("/app/alerts")}>{"HEALTH ALERT"}</Button></div></div>
                ) : null}
                {result.unpriced ? <p className="m-small m-muted" style={{ marginTop: 8 }}>{`${result.unpriced} holding(s) have no price source and are left out.`}</p> : null}
              </>
            ) : null}
          </Card>
        </div>
      </section>
      {result ? (
        <section className="m-wrap" style={{ marginTop: 28 }}>
          <Card title={"PnL explained"} kicker={"WHO CARRIES THE MOVE"}>
            {movers.length === 0 ? <p className="m-small m-muted">{"Nothing you hold moves with cirBTC or EURC; the flock is in USDC terms."}</p> : (
              <div className="m-scroll-x">
                <table className="m-table">
                  <thead><tr><th>Holding</th><th>Moves with</th><th className="r">Now</th><th className="r">After</th><th className="r">Share of move</th></tr></thead>
                  <tbody>{movers.map((r) => <tr key={r.label}><td>{r.label}{r.debt ? <Tag tone="bad" style={{ marginLeft: 6 }}>debt</Tag> : null}</td><td>{r.asset}</td><td className="r num">{usd(r.before)}</td><td className="r num">{usd(r.after)}</td><td className="r num">{delta ? `${(((r.after - r.before) / delta) * 100).toFixed(0)}%` : "n/a"}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <p className="m-small m-muted" style={{ marginTop: 8 }}>{"USDC holdings and USDC debt do not move with these shocks. Health factors are estimated from your venue holdings and assume USDC debt."}</p>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
