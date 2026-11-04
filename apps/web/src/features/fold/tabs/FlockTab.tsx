/**
 * Flock · holdings. The pasture (holdings drawn as tesserae sized by value,
 * grouped by venue), the what-if slider on the same shock model the
 * assistant answers with, and the holdings table where every row offers one
 * assistant action that drafts through the proposal system.
 */
import { applyFoldShocks, describeShock, type FoldShocks } from "@lykia/core";
import type { FlockHolding, FlockSnapshot } from "@lykia/core/api/flock";
import { useMemo, useState } from "react";

import { Link } from "../../../app/routes/Link";
import { Button, EmptyState, Tag, cx } from "../../../mosaic";
import { BUCKET_COLOR, holdingAction, pastureLayout, usd, venueName } from "../model";
import { allocationBucketOf } from "@lykia/core";

const SLIDERS = [
  { key: "EURC", label: "EURC vs USD", min: -20, max: 20, step: 1, unit: "%" },
  { key: "cirBTC", label: "BTC", min: -50, max: 50, step: 5, unit: "%" },
  { key: "ratesBps", label: "Lending rates", min: -300, max: 300, step: 25, unit: "bps" },
] as const;

function Pasture({ holdings, shocks }: { readonly holdings: readonly FlockHolding[]; readonly shocks: FoldShocks }) {
  const { groups, tiles } = useMemo(() => pastureLayout(holdings), [holdings]);
  if (tiles.length === 0) return <EmptyState mood="sleeping" title="An empty pasture">{"Nothing priced to draw yet. Fund the wallet with USDC, or check the address and network."}</EmptyState>;
  return (
    <div className="fd-pasture" role="img" aria-label={`Holdings by venue: ${groups.map((g) => `${g.label} ${usd(g.usd, 0)}`).join(", ")}`}>
      {tiles.map((t) => {
        const moved = /BTC/iu.test(t.label) ? shocks.cirBTC : /EURC/iu.test(t.label) ? shocks.EURC : 0;
        return (
          <div key={t.key} className={cx("fd-tile", t.kind === "debt" && "fd-tile--debt")} data-moved={moved < 0 ? "down" : moved > 0 ? "up" : undefined} style={{ left: `${t.x}%`, top: `${t.y}%`, width: `${t.w}%`, height: `${t.h}%`, ["--tile" as string]: BUCKET_COLOR[allocationBucketOf(t)] }}>
            <span className="fd-tile__l">{t.kind === "debt" ? `Borrowed ${t.label}` : t.label}</span>
            <span className="fd-tile__v num">{usd(t.usd * (1 + moved / 100), 0)}</span>
          </div>
        );
      })}
      {groups.map((g) => (
        <span key={g.where} className="fd-pasture__pen" style={{ left: `${g.x}%`, width: `${g.w}%` }}>
          {g.label}
        </span>
      ))}
    </div>
  );
}

export function FlockTab({ snapshot, sample, floorUsd, minHealth, onAction, openWhatIf }: { readonly snapshot: FlockSnapshot | undefined; readonly sample: boolean; readonly floorUsd: number; readonly minHealth: number; readonly onAction: (h: FlockHolding, sentence: string, label: string) => void; readonly openWhatIf: boolean }) {
  const [shocks, setShocks] = useState<FoldShocks>(() => ({ EURC: openWhatIf ? -5 : 0, cirBTC: 0, ratesBps: 0 }));
  const result = useMemo(() => (snapshot ? applyFoldShocks(snapshot.holdings, snapshot.health, shocks) : null), [snapshot, shocks]);
  if (!snapshot) {
    return (
      <div className="fd-grid2">
        <div className="m-skel" style={{ height: 300 }} />
        <div className="m-skel" style={{ height: 300 }} />
      </div>
    );
  }
  const gross = snapshot.holdings.reduce((a, h) => a + (h.usd === null ? 0 : Math.abs(Number(h.usd))), 0);
  const delta = result ? result.after - result.before : 0;
  return (
    <div className="fd-stack">
      <div className="fd-grid2 fd-grid2--wide">
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="pasture-h">
          <header className="fd-card__head">
            <h3 id="pasture-h">{"The pasture"}</h3>
            <span className="m-kick">{sample ? "SAMPLE · " : ""}{`ARC ${snapshot.environment.toUpperCase()}`}</span>
          </header>
          <Pasture holdings={snapshot.holdings} shocks={shocks} />
          <p className="m-small m-muted" style={{ marginTop: 10 }}>
            {"Each pen is a venue; each stone is sized by value. "}
            <Link to="/app/pastures">{"Where stablecoins earn on Arc"}</Link>
          </p>
        </section>
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="whatif-h">
          <header className="fd-card__head">
            <h3 id="whatif-h">{"What if…"}</h3>
            <span className="m-kick">{"THE SAME MODEL LYKO ANSWERS WITH"}</span>
          </header>
          <div className="fd-sliders">
            {SLIDERS.map((s) => (
              <label key={s.key} className="fd-slider">
                <span>{s.label}</span>
                <input type="range" min={s.min} max={s.max} step={s.step} value={shocks[s.key]} onChange={(e) => setShocks((x) => ({ ...x, [s.key]: Number(e.target.value) }))} aria-valuetext={`${shocks[s.key]} ${s.unit}`} />
                <b className="num">{shocks[s.key] > 0 ? "+" : ""}{shocks[s.key]}{s.unit === "%" ? "%" : " bps"}</b>
              </label>
            ))}
          </div>
          {result ? (
            <div className="fd-whatif">
              <div className="fd-whatif__nums">
                <div><span className="m-kick">{"NOW"}</span><b className="num">{usd(result.before, 0)}</b></div>
                <div><span className="m-kick">{"AFTER"}</span><b className="num" data-tone={delta < 0 ? "bad" : delta > 0 ? "ok" : undefined}>{usd(result.after, 0)}</b></div>
                <div><span className="m-kick">{"LOWEST HEALTH"}</span><b className="num" data-tone={result.worstHealth !== null && result.worstHealth < minHealth ? "bad" : undefined}>{result.worstHealth === null ? "—" : result.worstHealth.toFixed(2)}</b></div>
              </div>
              <p className="m-small">{describeShock(result, shocks, minHealth)}</p>
              <div className="flex gap-2 flex-wrap">
                {[-5, -10].map((v) => (
                  <button key={v} type="button" className="m-chip" onClick={() => setShocks({ EURC: v, cirBTC: 0, ratesBps: 0 })}>{`EURC ${v}%`}</button>
                ))}
                <button type="button" className="m-chip" onClick={() => setShocks({ EURC: 0, cirBTC: -20, ratesBps: 0 })}>{"BTC −20%"}</button>
                <button type="button" className="m-chip" onClick={() => setShocks({ EURC: 0, cirBTC: 0, ratesBps: 0 })}>{"Reset"}</button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <section className="fd-card m-frame m-frame--thin" aria-labelledby="holdings-h">
        <header className="fd-card__head">
          <h3 id="holdings-h">{"Holdings"}</h3>
          <span className="m-kick">{`${snapshot.holdings.length} PLACES · ${new Date(snapshot.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}</span>
        </header>
        {snapshot.holdings.length === 0 ? (
          <EmptyState mood="resting" title="Nothing here yet">{"No known tokens at this address. Fund it with USDC, or ask Lyko where to start."}</EmptyState>
        ) : (
          <div className="fd-table" role="table" aria-label="Holdings">
            <div className="fd-table__row fd-table__row--head" role="row">
              <span role="columnheader">{"Asset"}</span>
              <span role="columnheader">{"Where"}</span>
              <span role="columnheader" className="r">{"Amount"}</span>
              <span role="columnheader" className="r">{"Value"}</span>
              <span role="columnheader">{"Share"}</span>
              <span role="columnheader" className="r">{"Lyko can"}</span>
            </div>
            {snapshot.holdings.map((h, i) => {
              const action = holdingAction(h, floorUsd);
              const value = h.usd === null ? null : Number(h.usd);
              const share = value === null || gross <= 0 ? 0 : Math.abs(value) / gross;
              return (
                <div key={`${h.symbol}-${h.where}-${i}`} className="fd-table__row" role="row">
                  <span role="cell" className="fd-asset"><i style={{ background: BUCKET_COLOR[allocationBucketOf(h)] }} /><b>{h.symbol}</b></span>
                  <span role="cell"><span className="fd-where">{venueName(h.where)}</span> <Tag tone={h.kind === "debt" ? "bad" : h.kind === "token" ? "ghost" : "sea"}>{h.kind === "token" ? "held" : h.kind === "debt" ? "borrowed" : "earning"}</Tag></span>
                  <span role="cell" className="r num">{Number(h.amount).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
                  <span role="cell" className="r num">{value === null ? "unpriced" : usd(value)}</span>
                  <span role="cell"><span className="fd-share"><i style={{ width: `${Math.max(2, share * 100)}%` }} /></span></span>
                  <span role="cell" className="r">{action ? <Button size="sm" tone="ghost" onClick={() => onAction(h, action.sentence, action.label)}>{action.label}</Button> : <span className="m-small m-muted">—</span>}</span>
                </div>
              );
            })}
          </div>
        )}
        {snapshot.health.length > 0 ? (
          <div className="flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
            {snapshot.health.map((h) => (
              <Tag key={h.venue} tone={h.healthFactor !== null && Number(h.healthFactor) < minHealth * 1.25 ? "bad" : "ok"}>{`${venueName(h.venue)} · health ${h.healthFactor ?? "n/a"}`}</Tag>
            ))}
          </div>
        ) : null}
        {snapshot.notes.map((n) => <p key={n} className="m-note" style={{ marginTop: 8 }}>{n}</p>)}
      </section>
    </div>
  );
}
