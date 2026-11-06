/**
 * Flock · holdings. The position map (every venue Lykia supports as a pen,
 * every position as a row with its state and what it is doing, the pasture
 * of stones sized by value and coloured by state), then the what-if slider
 * on the same shock model the assistant answers with.
 */
import { applyFoldShocks, describeShock, type FoldShocks, type Position, type PositionAction } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import { useMemo, useState } from "react";

import { Link } from "../../../app/routes/Link";
import type { PositionMap as PositionMapData } from "../data";
import { usd } from "../model";
import { PositionMap } from "../positions/PositionMap";

const SLIDERS = [
  { key: "EURC", label: "EURC vs USD", min: -20, max: 20, step: 1, unit: "%" },
  { key: "cirBTC", label: "BTC", min: -50, max: 50, step: 5, unit: "%" },
  { key: "ratesBps", label: "Lending rates", min: -300, max: 300, step: 25, unit: "bps" },
] as const;

export function FlockTab({ snapshot, map, minHealth, signedIn, onSignIn, onAction, busy, openWhatIf }: { readonly snapshot: FlockSnapshot | undefined; readonly map: PositionMapData; readonly minHealth: number; readonly signedIn: boolean; readonly onSignIn: () => void; readonly onAction: (p: Position, a: PositionAction) => void; readonly busy?: boolean; readonly openWhatIf: boolean }) {
  const [shocks, setShocks] = useState<FoldShocks>(() => ({ EURC: openWhatIf ? -5 : 0, cirBTC: 0, ratesBps: 0 }));
  const result = useMemo(() => (snapshot ? applyFoldShocks(snapshot.holdings, snapshot.health, shocks) : null), [snapshot, shocks]);
  const delta = result ? result.after - result.before : 0;
  return (
    <div className="fd-stack">
      <PositionMap map={map} signedIn={signedIn} onSignIn={onSignIn} onAction={onAction} busy={busy} />
      <section className="fd-card m-frame m-frame--thin" aria-labelledby="whatif-h">
        <header className="fd-card__head fd-card__head--row">
          <h3 id="whatif-h">{"What if…"}</h3>
          <span className="m-kick">{"THE SAME MODEL LYKO ANSWERS WITH"}</span>
        </header>
        <div className="fd-grid2">
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
            <div className="fd-whatif fd-whatif--side">
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
          ) : <div className="m-skel" style={{ height: 120 }} />}
        </div>
        <p className="m-small m-muted">
          {"Shocks move the wallet, lending and vault holdings the Fold bar counts. "}
          <Link to="/app/pastures">{"Where stablecoins earn on Arc"}</Link>
        </p>
      </section>
    </div>
  );
}
