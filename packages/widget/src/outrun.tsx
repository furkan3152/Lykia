/** <Outrun>: the path of a plan, drawn as an arc, one waypoint per step. */
import { useEffect } from "react";
import type { Outrun as OutrunData } from "@lykia/core";
import { useOutrun } from "./hooks.js";
import { LykiaRoot } from "./provider.js";

/** Waypoint positions along a half-ellipse, left to right. Pure; exported for tests and custom drawings. */
export function arcPoints(count: number, width = 320, height = 120): { x: number; y: number }[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: width / 2, y: 16 }];
  return Array.from({ length: count }, (_, i) => {
    const t = Math.PI - (i / (count - 1)) * Math.PI;
    return { x: Math.round(width / 2 + Math.cos(t) * (width / 2 - 16)), y: Math.round(height - 8 - Math.sin(t) * (height - 24)) };
  });
}

export function OutrunArc(props: { readonly outrun: OutrunData }) {
  const points = arcPoints(props.outrun.waypoints.length);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  return (
    <svg className="lk-outrun" viewBox="0 0 320 128" role="img" aria-label={`Plan path, ${Math.round(props.outrun.progress * 100)}% done`}>
      <path d={path} fill="none" stroke="var(--lykia-border)" strokeWidth="3" strokeLinecap="round" />
      {props.outrun.waypoints.map((w, i) => {
        const p = points[i] as { x: number; y: number };
        const done = w.status === "settled";
        return (
          <g key={w.stepId}>
            <circle cx={p.x} cy={p.y} r="7" fill={done ? "var(--lykia-ok)" : i === props.outrun.current ? "var(--lykia-primary)" : "var(--lykia-surface)"} stroke="var(--lykia-fg)" strokeWidth="1.5" />
            <title>{`${w.name}: ${w.summary} (${w.status})`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export function Outrun(props: { readonly className?: string; readonly intentId?: string; readonly outrun?: OutrunData }) {
  const query = useOutrun();
  useEffect(() => {
    if (props.intentId && !props.outrun) void query.load(props.intentId);
  }, [props.intentId, props.outrun]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = props.outrun ?? query.data;
  return (
    <LykiaRoot name="outrun" {...(props.className ? { className: props.className } : {})}>
      <section className="lk-card" aria-label="Outrun">
        <h3 className="lk-title">Outrun</h3>
        {data ? (
          <>
            <OutrunArc outrun={data} />
            <ol className="lk-list">{data.waypoints.map((w) => <li key={w.stepId}><span>{w.name} · {w.summary}</span><span className="lk-muted">{w.status}</span></li>)}</ol>
            {data.fold.length > 0 ? <p className="lk-muted">Fold: {data.fold.join(", ")}</p> : null}
          </>
        ) : (
          <p className="lk-muted">{query.loading ? "Loading the path…" : "No plan yet."}</p>
        )}
        {query.error ? <p className="lk-error" role="alert">{query.error}</p> : null}
      </section>
    </LykiaRoot>
  );
}
