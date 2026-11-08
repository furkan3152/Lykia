/**
 * Fence · your spending rules. The rules as plain sentences, Lykia's beta
 * limit set apart from them (what it is, why, that it sits above every
 * Fence and never limits money coming home), the room left today, and
 * changes made by picking a preset (with a "what changes" preview) or by
 * asking Lyko. Tightening applies at once; loosening needs the owner's
 * wallet. The one-tap tweaks sit behind "Adjust".
 */
import { fenceHash, fencePresetOf, fencePresetPreview, fenceSentences, FENCE_PRESET_IDS, FENCE_PRESETS, LYKIA_TERMS, MEANINGS, type BetaCap, type Fence, type FencePresetId } from "@lykia/core";
import type { FoldTrailEntry } from "@lykia/core/api/fold";
import { useState } from "react";

import { Link } from "../../../app/routes/Link";
import { Button, Seal, cx } from "../../../mosaic";
import { BetaCapNote, Hint, Meaning } from "../../help/Help";
import { HeadroomGauge } from "../FoldBar";
import { fenceSuggestions, roomLine, type Headroom } from "../model";

export interface FenceTabProps {
  readonly fence: Fence;
  readonly headroom: Headroom;
  /** Lykia's beta limit on this network (mainnet), or null. */
  readonly beta: BetaCap | null;
  readonly verdicts: readonly FoldTrailEntry[];
  readonly onSuggest: (label: string, patch: Record<string, unknown>) => void;
  readonly onAsk: () => void;
  readonly onWhistle: () => void;
  readonly busy: boolean;
}

export function FenceTab({ fence, headroom, beta, verdicts, onSuggest, onAsk, onWhistle, busy }: FenceTabProps) {
  const rules = fenceSentences(fence).filter((s) => s.source === "yours");
  const current = fencePresetOf(fence);
  const [picked, setPicked] = useState<FencePresetId | null>(null);
  const preview = picked ? fencePresetPreview(fence, picked, beta) : null;
  const whistle = fence.mode === "whistle";
  const refused = verdicts.filter((v) => v.kind === "refused");
  const status = whistle ? "Stopped: the Whistle is blown" : fence.mode === "dry-run" ? "Practice mode: nothing can be signed" : "On: every move is checked";
  return (
    <div className="fd-grid2 fd-grid2--fence">
      <div className="fd-stack">
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="fence-h">
          <header className="fd-card__head fd-card__head--row">
            <div>
              <h3 id="fence-h">{"Your rules"}</h3>
              <span className="m-small m-muted">{fence.label ? `${fence.label}${current ? ` · matches ${FENCE_PRESETS[current].label}` : ""}` : "Custom"}</span>
            </div>
            <span className={cx("p-fence-status", whistle && "is-stopped")}>{status}</span>
          </header>
          <p className="m-small">{"Lyko checks every move against these before you sign. If one rule says no, nothing moves."}</p>
          <ul className="p-rules">
            {rules.map((r) => (
              <li key={r.rule}>
                <span className="p-src p-src--yours">{"YOUR RULE"}</span>
                <div>
                  <b>{r.rule}</b>
                  <span>{r.text}</span>
                </div>
              </li>
            ))}
          </ul>
          {refused.length === 0 ? <p className="fd-quiet">{"Nothing was refused lately. When a rule says no, the reason shows here."}</p> : null}
          <details className="p-tech">
            <summary className="m-small">{"Technical details"}</summary>
            <p className="m-small m-muted">{"The same rules are checked before signing, compiled into your Circle wallet policy, and enforced on chain by your Lykia account. Missing facts count as a no."}</p>
            <span className="m-kick num">{fenceHash(fence)}</span>
          </details>
        </section>
        {beta ? (
          <section className="fd-card m-frame m-frame--thin p-betacard" aria-labelledby="beta-h">
            <header className="fd-card__head">
              <h3 id="beta-h">{"Lykia's beta limit"}</h3>
              <span className="p-src p-src--beta">{"NOT YOUR RULE · APPLIES TO EVERYONE"}</span>
            </header>
            <BetaCapNote cap={beta} />
          </section>
        ) : null}
      </div>
      <div className="fd-stack">
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="room-h">
          <header className="fd-card__head">
            <h3 id="room-h">
              {"Room left today"}
              <Hint text={MEANINGS.roomToday} />
            </h3>
          </header>
          <p className="p-room">{roomLine(headroom).replace(/^Room left today: /u, "")}</p>
          <HeadroomGauge h={headroom} large />
        </section>
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="change-h">
          <header className="fd-card__head">
            <h3 id="change-h">{"Change your rules"}</h3>
            <Meaning>{"Pick a level and see what changes. Lyko drafts it; stricter rules apply at once, looser ones need your wallet."}</Meaning>
          </header>
          <div className="p-presets" role="radiogroup" aria-label="Rule presets">
            {FENCE_PRESET_IDS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={picked === id} className={cx("p-preset", picked === id && "is-on", current === id && "is-current")} onClick={() => setPicked(picked === id ? null : id)}>
                <b>{FENCE_PRESETS[id].label}{current === id ? " · now" : ""}</b>
                <span>{FENCE_PRESETS[id].line}</span>
              </button>
            ))}
          </div>
          {preview ? (
            <div className="p-preview" aria-live="polite">
              <b className="m-small">{preview.summary}</b>
              {preview.changes.length > 0 ? (
                <ul>
                  {preview.changes.map((c) => (
                    <li key={c.what} data-dir={c.direction}>
                      <span>{c.what}</span>
                      <span className="num">{`${c.from} → ${c.to}`}</span>
                      <em>{c.direction === "tighter" ? "stricter" : "looser"}</em>
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.betaNote ? <p className="m-small m-muted">{preview.betaNote}</p> : null}
              {preview.changes.length > 0 ? (
                <Button size="sm" disabled={busy} onClick={() => onSuggest(`Switch my Fence to ${preview.preset.label}`, preview.preset.patch as Record<string, unknown>)}>
                  {preview.needsWallet ? `DRAFT IT · YOUR WALLET SIGNS` : "MAKE IT STRICTER NOW"}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="p-fence-actions">
            <Button size="sm" tone="ghost" onClick={onAsk}>{"OR SAY IT IN YOUR WORDS"}</Button>
          </div>
          <details className="p-adjust">
            <summary className="m-small">{"Adjust one rule"}</summary>
            <div className="fd-suggest">
              {fenceSuggestions(fence).map((s) => (
                <button key={s.label} type="button" className="m-chip" disabled={busy} onClick={() => onSuggest(s.label, s.patch)}>
                  {s.label}
                </button>
              ))}
            </div>
          </details>
        </section>
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="whistle-h">
          <header className="fd-card__head">
            <h3 id="whistle-h">{`${LYKIA_TERMS.whistle.word} · ${LYKIA_TERMS.whistle.plain}`}</h3>
          </header>
          <p className="m-small">{LYKIA_TERMS.whistle.line}</p>
          <div className="p-fence-actions">
            <Button size="sm" tone={whistle ? "ochre" : "navy"} onClick={onWhistle}>{whistle ? "RELEASE · LET THINGS RUN AGAIN" : "BLOW THE WHISTLE"}</Button>
          </div>
          <p className="m-small m-muted">
            <Link to="/app/scent">{"Check a token before you buy it"}</Link>
          </p>
        </section>
        {refused.length > 0 ? (
          <section className="fd-card m-frame m-frame--thin" aria-labelledby="why-h">
            <header className="fd-card__head">
              <h3 id="why-h">{"Recently refused, and why"}</h3>
            </header>
            <ul className="fd-why">
              {refused.slice(0, 4).map((v) => (
                <li key={v.id}>
                  <Seal decision="deny" stamp={false} />
                  <div>
                    <b>{v.title}</b>
                    <p className="m-small">{v.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
