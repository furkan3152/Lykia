/**
 * Flock · your holdings. The position map (every place Lykia reads, every
 * position as a row with what it is, what it is worth, what it is doing and
 * one next step), then the Stress test: a few plain scenarios, each answered
 * in one sentence with the value before and after and the closest
 * liquidation, on the same shock model Lyko answers with. "Ask your own
 * question" goes to Lyko; the sliders sit behind "Fine-tune".
 */
import { NO_SHOCK, shockInputsFromPositions, STRESS_SCENARIO_IDS, STRESS_SCENARIOS, stressAnswer, type FoldShocks, type Position, type PositionAction, type StressScenarioId } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import { useMemo, useState } from "react";

import { cx } from "../../../mosaic";
import { HowItWorks } from "../../help/Help";
import type { PositionMap as PositionMapData } from "../data";
import { usd } from "../model";
import { PositionMap } from "../positions/PositionMap";

const SLIDERS = [
  { key: "EURC", label: "EURC price change", unit: "%", min: -20, max: 20, step: 1, says: (v: number) => `EURC ${v > 0 ? "+" : ""}${v}%` },
  { key: "cirBTC", label: "Bitcoin price change", unit: "%", min: -50, max: 50, step: 5, says: (v: number) => `Bitcoin ${v > 0 ? "+" : ""}${v}%` },
  { key: "ratesBps", label: "Lending rates change", unit: "points", min: -300, max: 300, step: 25, says: (v: number) => `rates ${v > 0 ? "+" : ""}${(v / 100).toFixed(2)} points` },
] as const;

export interface FlockTabProps {
  readonly snapshot: FlockSnapshot | undefined;
  readonly map: PositionMapData;
  readonly minHealth: number;
  readonly signedIn: boolean;
  readonly onSignIn: () => void;
  readonly onAction: (p: Position, a: PositionAction) => void;
  readonly onAsk: (text: string) => void;
  /** "Ask about this" on a position row: a scoped question to Lyko on watch. */
  readonly onAskAbout?: (p: Position) => void;
  readonly busy?: boolean;
  readonly openWhatIf: boolean;
}

export function FlockTab({ snapshot, map, minHealth, signedIn, onSignIn, onAction, onAsk, onAskAbout, busy, openWhatIf }: FlockTabProps) {
  return (
    <div className="fd-stack">
      <PositionMap map={map} signedIn={signedIn} onSignIn={onSignIn} onAction={onAction} {...(onAskAbout ? { onAskAbout } : {})} busy={busy} />
      <StressTest snapshot={snapshot} map={map} minHealth={minHealth} onAsk={onAsk} initial={openWhatIf ? "eurc-5" : null} />
    </div>
  );
}

export function StressTest({ snapshot, map, minHealth, onAsk, initial }: { readonly snapshot: FlockSnapshot | undefined; readonly map: PositionMapData; readonly minHealth: number; readonly onAsk: (text: string) => void; readonly initial: StressScenarioId | null }) {
  const [picked, setPicked] = useState<StressScenarioId | "custom" | null>(initial);
  const [custom, setCustom] = useState<FoldShocks>(NO_SHOCK);
  // The position map when every venue answered (it carries LPs, markets and Gateway); the snapshot until then.
  const inputs = useMemo(() => {
    const reads = map.slots.map((s) => s.read).filter((r): r is NonNullable<typeof r> => r !== null);
    if (!map.loading && reads.some((r) => r.positions.length > 0)) return shockInputsFromPositions(reads);
    return snapshot ? { holdings: snapshot.holdings, health: snapshot.health, names: {} as Record<string, string> } : null;
  }, [map, snapshot]);
  const scenario = picked && picked !== "custom" ? STRESS_SCENARIOS[picked] : null;
  const shocks = scenario ? scenario.shocks : custom;
  const lead = scenario ? scenario.lead : `With ${SLIDERS.filter((x) => custom[x.key] !== 0).map((x) => x.says(custom[x.key])).join(", ") || "no change"}`;
  const answer = inputs && picked ? stressAnswer(inputs.holdings, inputs.health, shocks, lead, minHealth, inputs.names) : null;
  return (
    <section className="fd-card m-frame m-frame--thin p-stress" aria-labelledby="stress-h">
      <header className="fd-card__head fd-card__head--row">
        <div>
          <h3 id="stress-h">{"Stress test"}</h3>
          <span className="m-small m-muted">{"What happens to your money if prices or rates move. A calculation only: nothing moves."}</span>
        </div>
        <HowItWorks area="stress" />
      </header>
      <div className="fd-stress__chips p-stress__chips" role="radiogroup" aria-label="Scenarios">
        {STRESS_SCENARIO_IDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={picked === id} className={cx("m-chip", picked === id && "is-on")} onClick={() => setPicked(id)}>
            {STRESS_SCENARIOS[id].label}
          </button>
        ))}
        <button type="button" className="m-chip p-stress__ask" onClick={() => onAsk("What if ")}>
          {"Ask your own question →"}
        </button>
      </div>
      {!picked ? <p className="m-small m-muted">{"Pick a scenario to see what it would do to your holdings and loans."}</p> : null}
      {picked && !inputs ? <div className="m-skel" style={{ height: 90 }} /> : null}
      {answer ? (
        <div className="p-stress__answer" aria-live="polite" data-safe={answer.safe}>
          <p className="p-stress__sentence">{answer.sentence}</p>
          <dl className="p-stress__nums">
            <div>
              <dt>{"Worth now"}</dt>
              <dd className="num">{usd(answer.before, 0)}</dd>
            </div>
            <div>
              <dt>{"Worth after"}</dt>
              <dd className="num" data-tone={answer.delta < 0 ? "bad" : answer.delta > 0 ? "ok" : undefined}>{`${usd(answer.after, 0)} (${answer.delta < 0 ? "−" : "+"}${usd(Math.abs(answer.delta), 0).replace("−", "")})`}</dd>
            </div>
            <div>
              <dt>{"Closest liquidation"}</dt>
              <dd className="num" data-tone={answer.closest && answer.closest.health < minHealth ? "bad" : undefined}>{answer.closest ? `${answer.closest.venue}: ${answer.closest.roomPercent.toFixed(0)}% away (health ${answer.closest.health.toFixed(2)})` : "none: nothing is borrowed"}</dd>
            </div>
          </dl>
        </div>
      ) : null}
      <details className="p-finetune" onToggle={(e) => (e.currentTarget.open ? setPicked("custom") : undefined)}>
        <summary className="m-small">{"Fine-tune: set your own numbers"}</summary>
        <div className="fd-sliders">
          {SLIDERS.map((x) => (
            <label key={x.key} className="fd-slider">
              <span>{`${x.label} (${x.unit})`}</span>
              <input type="range" min={x.min} max={x.max} step={x.step} value={custom[x.key]} onChange={(e) => { setPicked("custom"); setCustom((c) => ({ ...c, [x.key]: Number(e.target.value) })); }} aria-valuetext={x.says(custom[x.key])} />
              <b className="num">{x.key === "ratesBps" ? `${custom[x.key] > 0 ? "+" : ""}${(custom[x.key] / 100).toFixed(2)}` : `${custom[x.key] > 0 ? "+" : ""}${custom[x.key]}%`}</b>
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
