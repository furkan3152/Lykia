/**
 * The generic detail blocks: gauge, range bar, timeline, key facts,
 * countdown and PnL line. Any position kind is drawn with these, so a new
 * kind (a leash budget, a plan in progress, a watch) needs no screen of its own.
 * Every block says what it means in one plain line.
 */
import { fmtUsd, untilText, type PositionBlock } from "@lykia/core";

import { cx } from "../../../mosaic";
import { Hint } from "../../help/Help";
import { intlLocale, t } from "../../../i18n";

function Gauge({ b }: { readonly b: Extract<PositionBlock, { type: "gauge" }> }) {
  const n = 20;
  const span = b.max - b.min || 1;
  const fill = Math.max(0, Math.min(1, (b.value - b.min) / span));
  const at = b.threshold ? Math.max(0, Math.min(1, (b.threshold.at - b.min) / span)) : null;
  const room = b.threshold ? (b.threshold.danger === "below" ? (b.value - b.threshold.at) / span : (b.threshold.at - b.value) / span) : null;
  const tone = room === null ? "ok" : room <= 0 ? "bad" : room <= 0.12 ? "warn" : "ok";
  return (
    <div className="pb-gauge" data-tone={tone}>
      <div className="pb-head">
        <span className="m-kick">{b.label.toUpperCase()}</span>
        <b className="num">{b.display}</b>
      </div>
      <div className="pb-gauge__row" style={at !== null ? { ["--at" as string]: `${at * 100}%` } : undefined} role="meter" aria-valuemin={b.min} aria-valuemax={b.max} aria-valuenow={b.value} aria-label={`${b.label}: ${b.display}`}>
        {Array.from({ length: n }, (_, i) => <i key={i} data-f={i < Math.round(fill * n)} />)}
        {at !== null ? <span className="pb-gauge__mark" aria-hidden="true" /> : null}
      </div>
      {b.threshold ? <span className="pb-legend">{t("fold.positions.blocks.theMarkIs", { label: b.threshold.label })}</span> : null}
      {b.meaning ? <p className="pb-mean">{b.meaning}</p> : null}
    </div>
  );
}

function Range({ b }: { readonly b: Extract<PositionBlock, { type: "range" }> }) {
  const lo = Math.min(b.lower, b.value);
  const hi = Math.max(b.upper, b.value);
  const pad = (hi - lo) * 0.08 || 1;
  const pos = (v: number) => ((v - (lo - pad)) / (hi + pad - (lo - pad))) * 100;
  return (
    <div className="pb-range">
      <div className="pb-head">
        <span className="m-kick">{b.label.toUpperCase()}</span>
        <b className="num">{b.valueLabel}</b>
      </div>
      <div className="pb-range__bar">
        <span className="pb-range__band" style={{ left: `${pos(b.lower)}%`, width: `${Math.max(1.5, pos(b.upper) - pos(b.lower))}%` }} />
        <span className="pb-range__now" style={{ left: `${pos(b.value)}%` }} />
      </div>
      <div className="pb-range__legend num">
        <span>{b.lowerLabel}</span>
        <span>{b.upperLabel}</span>
      </div>
      {b.meaning ? <p className="pb-mean">{b.meaning}</p> : null}
    </div>
  );
}

function Timeline({ b, now }: { readonly b: Extract<PositionBlock, { type: "timeline" }>; readonly now: number }) {
  return (
    <div className="pb-timeline">
      <span className="m-kick">{b.label.toUpperCase()}</span>
      <ol>
        {b.steps.map((s) => (
          <li key={s.label} data-done={s.done}>
            <i aria-hidden="true" />
            <span>{s.label}</span>
            {s.at ? <small className="num">{s.done ? new Date(s.at).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" }) : untilText(s.at, now)}</small> : null}
          </li>
        ))}
      </ol>
      {b.meaning ? <p className="pb-mean">{b.meaning}</p> : null}
    </div>
  );
}

function Facts({ b }: { readonly b: Extract<PositionBlock, { type: "facts" }> }) {
  return (
    <dl className="pb-facts">
      {b.items.map((f) => (
        <div key={f.label}>
          <dt>
            {f.label}
            {f.meaning ? <Hint text={f.meaning} /> : null}
          </dt>
          <dd className="num">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Countdown({ b, now }: { readonly b: Extract<PositionBlock, { type: "countdown" }>; readonly now: number }) {
  return (
    <div className="pb-countdown" data-soon={Date.parse(b.until) - now < 72 * 3_600_000 || undefined}>
      <span className="m-kick">{b.label.toUpperCase()}</span>
      <b className="num">{untilText(b.until, now)}</b>
      <small className="num">{new Date(b.until).toLocaleString(intlLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
      {b.meaning ? <p className="pb-mean">{b.meaning}</p> : null}
    </div>
  );
}

function Pnl({ b }: { readonly b: Extract<PositionBlock, { type: "pnl" }> }) {
  const v = Number(b.valueUsd);
  return (
    <div className="pb-pnl" data-tone={v >= 0 ? "ok" : "bad"}>
      <span className="m-kick">{b.label.toUpperCase()}</span>
      <b className="num">{`${v >= 0 ? "+" : "−"}${fmtUsd(Math.abs(v), 2)}${b.percent ? ` (${Number(b.percent) >= 0 ? "+" : "−"}${Math.abs(Number(b.percent)).toFixed(1)}%)` : ""}`}</b>
      <p className="pb-mean">{b.basis}</p>
    </div>
  );
}

export function PositionBlocks({ blocks, now, className }: { readonly blocks: readonly PositionBlock[]; readonly now: number; readonly className?: string }) {
  return (
    <div className={cx("pb", className)}>
      {blocks.map((b, i) => {
        const key = `${b.type}-${i}`;
        switch (b.type) {
          case "gauge":
            return <Gauge key={key} b={b} />;
          case "range":
            return <Range key={key} b={b} />;
          case "timeline":
            return <Timeline key={key} b={b} now={now} />;
          case "facts":
            return <Facts key={key} b={b} />;
          case "countdown":
            return <Countdown key={key} b={b} now={now} />;
          case "pnl":
            return <Pnl key={key} b={b} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
