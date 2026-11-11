/**
 * Preflight in the Mosaic: each finding is a tessera card, its border in
 * terra (can't sign yet), ochre (check this) or sea (good to know), a
 * hand-laid pixel stone for its family, the before -> after figures in mono
 * digits, and its fixes as tessera chips. Calm: the most severe one or two
 * first, the rest behind "N more checks". The same look in the chat (above
 * the sign button) and in the review modal ("Before you sign").
 */
import type { Finding, FindingFix } from "@lykia/core";
import React, { useId, useState } from "react";

import { cx } from "../../mosaic/cx";
import { PixelArt } from "../../mosaic/PixelArt";
import { INTENT_PAL, PREFLIGHT_ART } from "../../mosaic/pixelArtData";
import { moreLabel, preflightChips, preflightView, SEVERITY_WORD, type PreflightChip } from "./preflightModel";

function FindingCard({ f, compact = false, index }: { readonly f: Finding; readonly compact?: boolean; readonly index: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className={cx("pf-card", compact && "pf-card--compact")} data-severity={f.severity} data-family={f.family} style={{ "--i": index } as React.CSSProperties}>
      <span className="pf-card__stone" aria-hidden="true">
        <PixelArt art={PREFLIGHT_ART[f.family]} palette={INTENT_PAL} size={compact ? 20 : 26} grout />
      </span>
      <div className="pf-card__body">
        <span className="pf-card__kick">{SEVERITY_WORD[f.severity]}</span>
        <b className="pf-card__title">{f.title}</b>
        {compact ? null : <p className="pf-card__why">{f.why}</p>}
        {f.change && !compact ? (
          <p className="pf-change" aria-label={`${f.change.label}: ${f.change.before} before, ${f.change.after} after`}>
            <span className="pf-change__label">{f.change.label}</span>
            <span className="pf-change__fig num">{f.change.before}</span>
            <span className="pf-change__arrow" aria-hidden="true">→</span>
            <span className="pf-change__fig pf-change__fig--after num">{f.change.after}</span>
          </p>
        ) : null}
        {f.figures.length > 0 && !compact ? (
          <>
            <button type="button" className="pf-why" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
              {open ? "Hide the figures" : "The figures"}
            </button>
            {open ? (
              <dl id={id} className="pf-figs">
                {f.figures.map((x) => (
                  <div key={`${x.label}${x.value}`}>
                    <dt>{x.label}</dt>
                    <dd className="num">{x.value}</dd>
                    <small>{`${x.source}${x.readAt ? ` · ${new Date(x.readAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} UTC` : ""}`}</small>
                  </div>
                ))}
              </dl>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

export interface PreflightPanelProps {
  readonly findings: readonly Finding[] | undefined;
  readonly mode: "chat" | "review";
  readonly acknowledged: boolean;
  /** Chat: "Use all anyway"; review: the tick. */
  readonly onAcknowledge?: (value: boolean) => void;
  readonly onFix?: (fix: FindingFix) => void;
  readonly onCancel?: () => void;
  /** Show the chips (the chat while the plan is still open; the review's block fixes). */
  readonly actionable?: boolean;
  /** Review: the host draws one tick for every "Before you sign" item instead of the panel's own. */
  readonly tick?: boolean;
  /** Review: an extra item the owner confirms with the same tick (the Fence's reasons), drawn first. */
  readonly lead?: React.ReactNode;
}

/**
 * The chat's one warning line: the most severe finding that needs the owner,
 * as a single tessera with its title, and its fixes as chips. The full
 * story (why, the figures, the tick) is in the review modal.
 */
export function PreflightLine({ findings, onFix }: { readonly findings: readonly Finding[] | undefined; readonly onFix?: (fix: FindingFix) => void }) {
  const view = preflightView(findings, false);
  const f = view.shown.find((x) => x.severity !== "note");
  if (!f) return null;
  const fixes = f.fixes.slice(0, 2);
  return (
    <div className="pf pf--line" data-worst={f.severity} role="status">
      <div className="pf-card pf-card--compact" data-severity={f.severity} data-family={f.family}>
        <span className="pf-card__stone" aria-hidden="true">
          <PixelArt art={PREFLIGHT_ART[f.family]} palette={INTENT_PAL} size={20} grout />
        </span>
        <div className="pf-card__body">
          <span className="pf-card__kick">{SEVERITY_WORD[f.severity]}</span>
          <b className="pf-card__title">{f.title}</b>
        </div>
      </div>
      {fixes.length > 0 && onFix ? (
        <div className="pf-chips" role="group" aria-label="Fixes Lyko can make">
          {fixes.map((fix, i) => (
            <button key={fix.id} type="button" className="pf-chip" data-role="fix" data-kind={fix.kind} style={{ "--i": i } as React.CSSProperties} onClick={() => onFix(fix)}>
              <span className="pf-chip__label">{fix.label}</span>
              {fix.detail ? <small className="pf-chip__detail">{fix.detail}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PreflightPanel(p: PreflightPanelProps) {
  const view = preflightView(p.findings, p.acknowledged);
  const uid = useId();
  if (view.list.length === 0 && !p.lead) return null;
  const chips: PreflightChip[] = p.actionable === false ? [] : preflightChips(p.findings, { acknowledged: p.acknowledged, cancellable: Boolean(p.onCancel) }).filter((c) => (p.mode === "review" ? c.role === "fix" : true));
  const worst = view.gate.worst ?? "note";
  return (
    <section className={cx("pf", `pf--${p.mode}`)} data-worst={worst} aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`} className={p.mode === "review" ? "rv-h" : "pf__h"}>
        {p.mode === "review" ? "Before you sign" : view.gate.blocked ? "Lyko stopped this one" : view.gate.needsAck.length > 0 ? "Lyko spotted something" : "Lyko checked"}
        {view.list.length > 0 ? <span className="m-kick">{`${view.list.length} ${view.list.length === 1 ? "CHECK" : "CHECKS"}`}</span> : null}
      </h3>
      <ul className="pf__list">
        {p.lead}
        {view.shown.map((f, i) => (
          <FindingCard key={f.id} f={f} index={i} />
        ))}
      </ul>
      {view.more > 0 ? (
        <details className="pf__more">
          <summary>{moreLabel(view.more)}</summary>
          <ul className="pf__list">
            {view.rest.map((f, i) => (
              <FindingCard key={f.id} f={f} index={i} compact />
            ))}
          </ul>
        </details>
      ) : null}
      {chips.length > 0 ? (
        <div className="pf-chips" role="group" aria-label="What Lyko can do instead">
          {chips.map((c, i) => (
            <button
              key={c.key}
              type="button"
              className="pf-chip"
              data-role={c.role}
              data-kind={c.fix?.kind}
              style={{ "--i": i } as React.CSSProperties}
              onClick={() => (c.role === "proceed" ? p.onAcknowledge?.(true) : c.role === "cancel" ? p.onCancel?.() : c.fix ? p.onFix?.(c.fix) : undefined)}
            >
              <span className="pf-chip__label">{c.label}</span>
              {c.detail ? <small className="pf-chip__detail">{c.detail}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
      {p.mode === "review" && p.tick !== false && !view.gate.blocked && view.list.some((f) => f.severity === "warn") ? (
        <label className="rv-confirm pf-tick">
          <input type="checkbox" checked={p.acknowledged} onChange={(e) => p.onAcknowledge?.(e.target.checked)} /> {"I read these warnings and want to sign it as it is."}
        </label>
      ) : null}
      {p.mode === "review" && view.gate.blocked ? <p className="pf-blocked m-small">{"Signing is off until this is fixed. Pick a fix, or go back and ask Lyko for another plan."}</p> : null}
    </section>
  );
}
