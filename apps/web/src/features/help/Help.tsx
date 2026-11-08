/**
 * Plain-words helpers used on every surface:
 *  - Hint: a small "?" that explains one figure, badge or word on hover, focus or tap;
 *  - HowItWorks: a quiet "?" per area that opens three bullets and "Ask Lyko about this";
 *  - Term: Lykia's own word with its plain subtitle ("Fence · your spending rules");
 *  - BetaCapNote: the beta limit with what it is, why, who it applies to and what it never limits.
 */
import { betaCapExplain, LYKIA_TERMS, type BetaCap, type LykiaTerm } from "@lykia/core";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { navigate } from "../../app/routes/history";
import { cx } from "../../mosaic/cx";
import { useAsk } from "../ask/store";
import { HELP, type HelpArea } from "./help";

export function Hint({ text, label = "What does this mean?", className }: { readonly text: string; readonly label?: string; readonly className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={ref} className={cx("p-hint", className)} data-open={open || undefined} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="p-hint__btn" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        ?
      </button>
      {open ? (
        <span id={id} role="tooltip" className="p-hint__pop">
          {text}
        </span>
      ) : null}
    </span>
  );
}

/** One plain line under a figure: "what this means for you". */
export function Meaning({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <span className={cx("p-mean", className)}>{children}</span>;
}

export function Term({ t, className }: { readonly t: LykiaTerm; readonly className?: string }) {
  const term = LYKIA_TERMS[t];
  return (
    <span className={cx("p-term", className)} title={term.line}>
      <b>{term.word}</b>
      <span>{` · ${term.plain}`}</span>
    </span>
  );
}

export function HowItWorks({ area, inAsk = false, className }: { readonly area: HelpArea; readonly inAsk?: boolean; readonly className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const setPrefill = useAsk((s) => s.setPrefill);
  const entry = HELP[area];
  return (
    <div className={cx("p-how", className)} data-open={open || undefined}>
      <button type="button" className="p-how__btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">?</span>
        {"How this works"}
      </button>
      {open ? (
        <div id={id} className="p-how__panel" role="region" aria-label={`How this works: ${entry.title}`}>
          <b className="p-how__title">{entry.title}</b>
          <ul>
            {entry.bullets.slice(0, 3).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <button
            type="button"
            className="m-chip p-how__ask"
            onClick={() => {
              setPrefill(entry.ask);
              setOpen(false);
              if (!inAsk) navigate("/app");
            }}
          >
            {`Ask Lyko about this: “${entry.ask}”`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The beta limit, never as a bare number: what it is, why it exists, who it applies to and what it never limits. */
export function BetaCapNote({ cap, compact = false, className }: { readonly cap: BetaCap; readonly compact?: boolean; readonly className?: string }) {
  const b = betaCapExplain(cap);
  return (
    <div className={cx("p-beta", compact && "p-beta--compact", className)} role="note" data-beta-explained="">
      <span className="p-beta__tag">{"LYKIA'S BETA LIMIT"}</span>
      <p className="p-beta__lead">{b.sentence}</p>
      {compact ? (
        <p className="p-beta__more">{`${b.why} ${b.home}`}</p>
      ) : (
        <ul className="p-beta__list">
          <li>{b.why}</li>
          <li>{b.scope}</li>
          <li>{b.home}</li>
        </ul>
      )}
    </div>
  );
}
