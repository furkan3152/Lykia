/**
 * Ask Lyko's starting points and the step after an answer. The tiles are
 * tesserae: a pixel icon on its own coloured stone, one word, and what the
 * tap will do. A "fill" tile drops a sentence with blanks into the composer;
 * an "ask" tile sends the question at once.
 */
import { Link } from "../../app/routes/Link";
import { cx } from "../../mosaic/cx";
import { PixelArt } from "../../mosaic/PixelArt";
import { INTENT_ART, INTENT_PAL } from "../../mosaic/pixelArtData";
import type { ChatMessage } from "./model";
import { ASK_STARTERS, DO_STARTERS, followUps, nextStep, type Starter } from "./starters";

export function IntentIcon({ icon, size = 24 }: { readonly icon: Starter["icon"]; readonly size?: number }) {
  return <PixelArt art={INTENT_ART[icon]} palette={INTENT_PAL} size={size} grout />;
}

/** The blank in a tile's sentence, drawn as an empty slot. */
function SentenceWithSlots({ text }: { readonly text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("[") ? <span key={i} className="m-slot">{p.slice(1, -1)}</span> : <span key={i}>{p}</span>))}
    </>
  );
}

export function StarterGrid({ onPick }: { readonly onPick: (s: Starter) => void }) {
  return (
    <div className="m-startgrid">
      <div className="m-startgrid__group" role="group" aria-label="Do something">
        <p className="m-startgrid__label"><span className="m-kick">{"DO SOMETHING"}</span><span>{"You fill the blanks"}</span></p>
        <div className="m-startgrid__row m-startgrid__row--do">
          {DO_STARTERS.map((s, i) => (
            <button key={s.id} type="button" className="m-start" data-icon={s.icon} style={{ "--i": i } as React.CSSProperties} onClick={() => onPick(s)}>
              <span className="m-start__stone"><IntentIcon icon={s.icon} size={26} /></span>
              <span className="m-start__body">
                <b>{s.label}</b>
                <small><SentenceWithSlots text={s.text} /></small>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="m-startgrid__group" role="group" aria-label="Ask a question">
        <p className="m-startgrid__label"><span className="m-kick">{"OR ASK"}</span><span>{"One tap sends it"}</span></p>
        <div className="m-startgrid__row m-startgrid__row--ask">
          {ASK_STARTERS.map((s, i) => (
            <button key={s.id} type="button" className="m-start m-start--ask" data-icon={s.icon} style={{ "--i": i + 4 } as React.CSSProperties} onClick={() => onPick(s)}>
              <span className="m-start__stone"><IntentIcon icon={s.icon} size={22} /></span>
              <span className="m-start__body">
                <b>{s.label}</b>
                <small>{s.line}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Phones: the starting points or the follow-ups as one row of small
 * chips that sits right above the message box and scrolls sideways.
 */
export function StarterChips({ items, onPick }: { readonly items: readonly Starter[]; readonly onPick: (s: Starter) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="m-dockchips" role="group" aria-label="Suggestions">
      {items.map((s, i) => (
        <button key={s.id} type="button" className="m-dockchip" data-icon={s.icon} data-kind={s.kind} style={{ "--i": i } as React.CSSProperties} onClick={() => onPick(s)}>
          <span className="m-dockchip__stone"><IntentIcon icon={s.icon} size={20} /></span>
          <span className="m-dockchip__label">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * After Lyko answers: the one next step (the Fold where the result now
 * lives), then two or three follow-ups. A plan carries its own "Review and
 * sign" and a question its own options, so neither gets anything here:
 * one thing to do at a time.
 */
export function NextStepBar({ m, onPick, chips = true }: { readonly m: ChatMessage; readonly onPick: (s: Starter) => void; readonly chips?: boolean }) {
  const step = nextStep(m);
  if (step.kind === "choose" || step.kind === "review" || m.proposals.length > 0 || m.program) return null;
  const more = !chips ? [] : followUps(m);
  if (step.kind !== "fold" && more.length === 0) return null;
  return (
    <div className="m-nextbar" role="group" aria-label="What next">
      {step.kind === "fold" ? (
        <Link to={step.href} className="m-btn m-btn--navy m-nextbar__go">
          {step.label.toUpperCase()}
        </Link>
      ) : null}
      {more.length > 0 ? (
        <div className={cx("m-nextbar__more", step.kind !== "none" && "m-nextbar__more--after")}>
          <span className="m-kick">{"NEXT, YOU COULD"}</span>
          <div className="m-nextbar__chips">
            {more.map((s) => (
              <button key={s.id} type="button" className="m-chip m-nextbar__chip" onClick={() => onPick(s)}>
                <IntentIcon icon={s.icon} size={14} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
