/**
 * Fence · rules. The active Fence in human words, today's headroom, the
 * recent verdicts with why anything was refused, and changes made by asking
 * Lyko, who proposes a Fence edit. Tightening applies at once; loosening
 * needs the owner's wallet.
 */
import { fenceHash, type Fence } from "@lykia/core";
import type { FoldTrailEntry } from "@lykia/core/api/fold";

import { Link } from "../../../app/routes/Link";
import { Button, Seal, Tag } from "../../../mosaic";
import { HeadroomGauge } from "../FoldBar";
import { fenceInWords, fenceSuggestions, type Headroom } from "../model";

export function FenceTab({ fence, headroom, verdicts, onSuggest, onAsk, onWhistle, busy }: { readonly fence: Fence; readonly headroom: Headroom; readonly verdicts: readonly FoldTrailEntry[]; readonly onSuggest: (label: string, patch: Record<string, unknown>) => void; readonly onAsk: () => void; readonly onWhistle: () => void; readonly busy: boolean }) {
  const words = fenceInWords(fence);
  const suggestions = fenceSuggestions(fence);
  const whistle = fence.mode === "whistle";
  const refused = verdicts.filter((v) => v.kind === "refused");
  return (
    <div className="fd-grid2 fd-grid2--fence">
      <section className="fd-card m-frame m-frame--thin" aria-labelledby="fence-h">
        <header className="fd-card__head fd-card__head--row">
          <div>
            <h3 id="fence-h">{fence.label ? `Your Fence · ${fence.label}` : "Your Fence"}</h3>
            <span className="m-kick num">{fenceHash(fence).slice(0, 26)}…</span>
          </div>
          <Tag tone={whistle ? "wolf" : fence.mode === "dry-run" ? "ochre" : "ok"}>{whistle ? "WHISTLE BLOWN" : (fence.mode ?? "live").toUpperCase()}</Tag>
        </header>
        <ul className="fd-rules">
          {words.map((w) => (
            <li key={w.rule}>
              <span className="m-kick">{w.rule}</span>
              <span>{w.text}</span>
            </li>
          ))}
        </ul>
        <p className="m-small m-muted">{"Missing facts deny. The same rules are checked before signing, compiled into your Circle wallet policy, and enforced on chain by your Lykia account."}</p>
      </section>
      <div className="fd-stack">
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="room-h">
          <header className="fd-card__head">
            <h3 id="room-h">{"Headroom today"}</h3>
            <span className="m-kick">{"RESETS AT 00:00 UTC"}</span>
          </header>
          <HeadroomGauge h={headroom} large />
        </section>
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="change-h">
          <header className="fd-card__head">
            <h3 id="change-h">{"Change it by asking"}</h3>
            <span className="m-kick">{"LYKO PROPOSES · LOOSENING NEEDS YOUR WALLET"}</span>
          </header>
          <div className="fd-suggest">
            {suggestions.map((s) => (
              <button key={s.label} type="button" className="m-chip" disabled={busy} onClick={() => onSuggest(s.label, s.patch)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
            <Button size="sm" onClick={onAsk}>{"ASK LYKO TO CHANGE IT"}</Button>
            <Button size="sm" tone={whistle ? "ochre" : "navy"} onClick={onWhistle}>{whistle ? "THAT'LL DO · RELEASE" : "BLOW THE WHISTLE"}</Button>
          </div>
          <p className="m-small m-muted" style={{ marginTop: 10 }}>
            <Link to="/app/scent">{"Check a token"}</Link>{" · "}<Link to="/app/security">{"The watch: six checks before your wallet"}</Link>
          </p>
        </section>
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="why-h">
          <header className="fd-card__head">
            <h3 id="why-h">{"Why refused"}</h3>
            <span className="m-kick">{`${refused.length} RECENT`}</span>
          </header>
          {refused.length === 0 ? (
            <p className="fd-quiet">{"Nothing was refused lately. When the Fence says no, the reason shows here in plain words."}</p>
          ) : (
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
          )}
        </section>
      </div>
    </div>
  );
}
