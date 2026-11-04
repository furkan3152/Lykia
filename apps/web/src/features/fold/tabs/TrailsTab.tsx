/**
 * Trails · activity. The timeline of everything that happened, grouped by
 * day and filterable, beside the yield and PnL explanation the server
 * writes as a structured artifact.
 */
import type { FoldExplainArtifact, FoldTrailEntry } from "@lykia/core/api/fold";
import { useState } from "react";

import { Link } from "../../../app/routes/Link";
import { EmptyState, Seal, Tag, cx } from "../../../mosaic";
import { byDay, filterTrails, TRAIL_FILTERS, type TrailFilter } from "../model";

const KIND: Readonly<Record<FoldTrailEntry["kind"], { label: string; tone: "ok" | "bad" | "sea" | "ghost" | "ochre" }>> = {
  settled: { label: "Settled", tone: "ok" },
  planned: { label: "Planned", tone: "ghost" },
  running: { label: "Running", tone: "sea" },
  failed: { label: "Failed", tone: "bad" },
  refused: { label: "Refused", tone: "bad" },
  order: { label: "Order", tone: "ochre" },
  alert: { label: "Bark", tone: "ochre" },
  proposal: { label: "Draft", tone: "ghost" },
};

export function ExplainCard({ artifact, loading, sample }: { readonly artifact: FoldExplainArtifact | undefined; readonly loading: boolean; readonly sample?: boolean }) {
  return (
    <section className="fd-card m-frame m-frame--thin fd-explain" aria-labelledby={`explain-${artifact?.kind ?? "x"}`}>
      <header className="fd-card__head">
        <h3 id={`explain-${artifact?.kind ?? "x"}`}>{artifact?.title ?? "Where your yield comes from"}</h3>
        <span className="m-kick">{sample ? "SAMPLE · " : ""}{"WRITTEN BY THE SERVER, NOT GUESSED"}</span>
      </header>
      {loading && !artifact ? <div className="m-skel" style={{ height: 160 }} /> : null}
      {artifact ? (
        <>
          <p className="fd-explain__sum">{artifact.summary}</p>
          <dl className="fd-explain__lines">
            {artifact.lines.map((l) => (
              <div key={l.label}>
                <dt>{l.label}{l.note ? <small>{l.note}</small> : null}</dt>
                <dd className="num">{l.value}</dd>
              </div>
            ))}
          </dl>
          <p className="m-small m-muted">{`Sources: ${artifact.sources.join(" · ")}`}</p>
        </>
      ) : null}
    </section>
  );
}

export function TrailsTab({ now, items, totals, explain, explainLoading, sample, signedIn, onSignIn }: { readonly now: number; readonly items: readonly FoldTrailEntry[] | undefined; readonly totals: { settled: number; failed: number; refused: number; feesUsd: string } | undefined; readonly explain: FoldExplainArtifact | undefined; readonly explainLoading: boolean; readonly sample: boolean; readonly signedIn: boolean; readonly onSignIn: () => void }) {
  const [filter, setFilter] = useState<TrailFilter>("all");
  const list = items ? filterTrails(items, filter) : [];
  const days = byDay(list, now);
  return (
    <div className="fd-grid2 fd-grid2--trails">
      <section className="fd-card m-frame m-frame--thin" aria-labelledby="trail-h">
        <header className="fd-card__head">
          <h3 id="trail-h">{"The trail"}</h3>
          <span className="m-kick">{sample ? "SAMPLE TRAIL" : `${items?.length ?? 0} ENTRIES`}</span>
        </header>
        <div className="fd-chips" role="tablist" aria-label="Filter the trail">
          {TRAIL_FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="m-chip" onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {!signedIn && !sample ? (
          <EmptyState mood="watching" title="Your trail is personal">
            {"Sign in with your wallet (one message, no transaction) to see what happened, with every memo and Fence verdict."}
            <div style={{ marginTop: 10 }}><button type="button" className="m-btn m-btn--sm" onClick={onSignIn}>{"SIGN IN"}</button></div>
          </EmptyState>
        ) : items === undefined ? (
          <div className="m-skel" style={{ height: 240 }} />
        ) : days.length === 0 ? (
          <EmptyState mood="resting" title="A quiet trail">{"Nothing here yet. What you and your agents do shows up here, with its memo and Fence verdict."}</EmptyState>
        ) : (
          <ol className="fd-trail">
            {days.map((d) => (
              <li key={d.day}>
                <span className="fd-trail__day m-kick">{d.day}</span>
                <ol>
                  {d.items.map((t) => (
                    <li key={t.id} className={cx("fd-trail__item", `fd-trail__item--${t.kind}`)}>
                      <span className="fd-trail__time num">{new Date(t.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                      <div className="fd-trail__body">
                        <div className="fd-trail__top">
                          <Tag tone={KIND[t.kind].tone}>{KIND[t.kind].label}</Tag>
                          <b>{t.title}</b>
                          {t.verdict ? <Seal decision={t.verdict.decision} stamp={false} /> : null}
                        </div>
                        <p className="m-small m-muted">{t.detail}</p>
                        {t.memo || t.feeUsd || t.transactions.length > 0 ? (
                          <div className="fd-trail__meta">
                            {t.memo ? <code title="Arc Memo: binds the step to its Fence verdict">{t.memo}</code> : null}
                            {t.verdict ? <span className="m-small">{`verdict ${t.verdict.digest.replace(/^sha256:/u, "").slice(0, 10)}…`}</span> : null}
                            {t.feeUsd ? <span className="m-small">{`fee $${t.feeUsd}`}</span> : null}
                            {t.transactions.slice(0, 2).map((h) => <span key={h} className="m-small num">{h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h}</span>)}
                          </div>
                        ) : null}
                      </div>
                      {t.link && t.link.startsWith("/app/outrun/") ? <Link to={t.link} className="fd-trail__go" aria-label={`Open the plan: ${t.title}`}>{"›"}</Link> : null}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </section>
      <div className="fd-stack">
        <ExplainCard artifact={explain} loading={explainLoading} sample={sample} />
        <section className="fd-card m-frame m-frame--thin" aria-label="Totals">
          <div className="fd-totals">
            <div><span className="m-kick">{"SETTLED"}</span><b className="num">{totals?.settled ?? "—"}</b></div>
            <div><span className="m-kick">{"REFUSED"}</span><b className="num">{totals?.refused ?? "—"}</b></div>
            <div><span className="m-kick">{"FAILED"}</span><b className="num">{totals?.failed ?? "—"}</b></div>
            <div><span className="m-kick">{"FEES PAID"}</span><b className="num">{totals ? `$${totals.feesUsd}` : "—"}</b></div>
          </div>
          <p className="m-small m-muted">{"Lykia's fee is 1% of what moves, paid on chain in the same transaction. Refusals cost nothing."}</p>
        </section>
      </div>
    </div>
  );
}
