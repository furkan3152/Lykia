/**
 * Lyko at work: each step the server reports is laid as a tessera in a
 * strip (icon, label, short result, time), and opens to show its detail.
 * When the turn ends the strip folds into one line ("Checked 4 things ·
 * 1.8s") that opens it again. Lyko's avatar beside the answer follows the
 * same events: sniffing, found, warning, done.
 */
import type { ChatStep } from "@lykia/core/api/agents";
import { useState } from "react";

import { LykoTile } from "../../mosaic";
import { cx } from "../../mosaic/cx";
import { Mark, StepIcon } from "../../mosaic/PixelArt";
import { formatMs, trailSummary, type AvatarState } from "./workTrail";
import { t } from "../../i18n";

const STATE_WORD: Readonly<Record<ChatStep["state"], string>> = { running: "working", ok: "done", warn: t("ask.trail.needsALook"), fail: t("ask.trail.didNotPass") };

function Tessera({ step, index }: { readonly step: ChatStep; readonly index: number }) {
  const [open, setOpen] = useState(false);
  const more = Boolean(step.detail);
  const body = (
    <>
      <span className="m-tess__stone" aria-hidden="true">
        <StepIcon kind={step.kind} size={14} />
      </span>
      <span className="m-tess__what">
        <span className="m-tess__label">
          {step.label}
          {step.agent ? <span className="m-tess__agent">{step.agent}</span> : null}
        </span>
        {step.result ? <span className="m-tess__result">{step.result}</span> : step.state === "running" ? <span className="m-tess__result m-tess__result--wait">sniffing…</span> : null}
      </span>
      <span className="m-tess__end">
        {step.state === "running" ? <span className="m-tess__dots" aria-hidden="true"><i /><i /><i /></span> : step.ms !== undefined && step.ms >= 50 ? <span className="m-tess__ms">{formatMs(step.ms)}</span> : null}
        {step.state !== "running" ? <span className="m-tess__mark" aria-hidden="true"><Mark name={step.state === "ok" ? "check" : step.state === "warn" ? "bang" : "cross"} size={10} /></span> : null}
        {more ? <span className="m-tess__chev" aria-hidden="true" data-open={open} /> : null}
      </span>
      <span className="sr-only">{`, ${STATE_WORD[step.state]}`}</span>
    </>
  );
  return (
    <li className="m-tess" data-state={step.state} data-kind={step.kind} style={{ "--i": index } as React.CSSProperties}>
      {more ? (
        <button type="button" className="m-tess__row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {body}
        </button>
      ) : (
        <div className="m-tess__row">{body}</div>
      )}
      {more && open ? <p className="m-tess__detail">{step.detail}</p> : null}
    </li>
  );
}

/** The strip while Lyko works, the one-line summary when he is done. */
export function Trail({ steps, streaming, notes = [], compact = false }: { readonly steps: readonly ChatStep[]; readonly streaming: boolean; readonly notes?: readonly string[]; readonly compact?: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  if (steps.length === 0 && notes.length === 0) return null;
  const open = userOpen ?? streaming;
  const summary = streaming ? t("ask.trail.lykoAtWorkOf", { length: steps.filter((s) => s.state !== "running").length, length2: steps.length }) : trailSummary(steps);
  return (
    <div className={cx("m-work", compact && "m-work--compact")} data-open={open} data-live={streaming || undefined}>
      <button type="button" className="m-work__head" aria-expanded={open} onClick={() => setUserOpen(!open)}>
        <span className="m-work__mini" aria-hidden="true">
          {steps.slice(0, 14).map((s) => (
            <i key={s.id} data-state={s.state} />
          ))}
        </span>
        <span className="m-work__sum">{summary}</span>
        <span className="m-work__chev" aria-hidden="true" data-open={open} />
      </button>
      {open ? (
        <div className="m-work__body">
          <ol className="m-work__strip" aria-live={streaming ? "polite" : undefined}>
            {steps.map((s, i) => (
              <Tessera key={s.id} step={s} index={i} />
            ))}
          </ol>
          {notes.length > 0 ? (
            <div className="m-work__notes">
              <span className="m-work__notes-k">{t("ask.trail.lykoSNotes")}</span>
              {notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const MOOD = { sniffing: "herding", found: "proud", warning: "alert", done: "happy" } as const;
const STATE_LABEL: Readonly<Record<AvatarState, string>> = { sniffing: t("ask.trail.lykoIsSniffingOutTheDetails"), found: t("ask.trail.lykoFoundSomething"), warning: t("ask.trail.lykoFlagsSomethingForYou"), done: t("ask.trail.lykoIsDone") };

/** Lyko's face with a small state mark: scent dots while sniffing, a spark when found, a flag on warning, a check when done. */
export function LykoAvatar({ state, size = 40 }: { readonly state: AvatarState; readonly size?: number }) {
  return (
    <span className="m-lyko" data-state={state} style={{ width: size, height: size }} role="img" aria-label={STATE_LABEL[state]}>
      <LykoTile mood={MOOD[state]} size={size} />
      <span className="m-lyko__mark" aria-hidden="true">
        {state === "sniffing" ? (
          <span className="m-lyko__scent"><i /><i /><i /></span>
        ) : (
          <span className="m-lyko__badge">
            <Mark name={state === "done" ? "check" : state === "warning" ? "bang" : "spark"} size={9} />
          </span>
        )}
      </span>
    </span>
  );
}
