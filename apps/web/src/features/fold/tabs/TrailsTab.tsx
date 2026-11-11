/**
 * Trails · activity. The timeline of everything that happened, grouped by
 * day and filterable, beside the yield and PnL explanation the server
 * writes as a structured artifact.
 */
import type { FoldExplainArtifact, FoldTrailEntry } from "@lykia/core/api/fold";
import { useState } from "react";

import { Link } from "../../../app/routes/Link";
import { EmptyState, Seal, Tag, cx } from "../../../mosaic";
import { TRAIL_FEE_WINDOW_DAYS } from "@lykia/core";
import { askWhyTrail, byDay, filterTrails, trailLink, TRAIL_FILTERS, withTrailFees, type TrailFilter } from "../model";
import { intlLocale, t as msg } from "../../../i18n";

const KIND: Readonly<Record<FoldTrailEntry["kind"], { label: string; tone: "ok" | "bad" | "sea" | "ghost" | "ochre" }>> = {
  settled: { label: msg("fold.tabs.trailsTab.settled"), tone: "ok" },
  planned: { label: msg("fold.tabs.trailsTab.planned"), tone: "ghost" },
  running: { label: msg("fold.tabs.trailsTab.running"), tone: "sea" },
  failed: { label: msg("fold.tabs.trailsTab.failed"), tone: "bad" },
  refused: { label: msg("fold.tabs.trailsTab.refused"), tone: "bad" },
  order: { label: msg("fold.tabs.trailsTab.order"), tone: "ochre" },
  alert: { label: msg("fold.tabs.trailsTab.watch"), tone: "ochre" },
  proposal: { label: msg("fold.tabs.trailsTab.draft"), tone: "ghost" },
};

/** A trail row's way out: its Herding row or transaction, and "Ask why" to Lyko on watch. */
function TrailActions({ t, onAskWhy }: { readonly t: FoldTrailEntry; readonly onAskWhy: ((question: string, context: string) => void) | undefined }) {
  const link = trailLink(t);
  if (!link && !onAskWhy) return null;
  return (
    <div className="fd-trail__acts">
      {link ? (
        link.external ? (
          <a className="ps-act ps-act--go" href={link.href} target="_blank" rel="noreferrer">{`${link.label} ↗`}</a>
        ) : (
          <Link to={link.href} className="ps-act ps-act--go">{`${link.label} ›`}</Link>
        )
      ) : null}
      {onAskWhy ? (
        <button type="button" className="ps-act" onClick={() => { const q = askWhyTrail(t); onAskWhy(q.question, q.context); }}>{msg("fold.tabs.trailsTab.askWhy")}</button>
      ) : null}
    </div>
  );
}

function ExplainCard({ artifact, loading, sample }: { readonly artifact: FoldExplainArtifact | undefined; readonly loading: boolean; readonly sample?: boolean }) {
  return (
    <section className="fd-card m-frame m-frame--thin fd-explain" aria-labelledby={`explain-${artifact?.kind ?? "x"}`}>
      <header className="fd-card__head">
        <h3 id={`explain-${artifact?.kind ?? "x"}`}>{artifact?.title ?? msg("fold.tabs.trailsTab.whereYourYieldComesFrom")}</h3>
        <span className="m-kick">{sample ? msg("fold.tabs.trailsTab.sample") : ""}{msg("fold.tabs.trailsTab.writtenByTheServerNotGuessed")}</span>
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

export function TrailsTab({ now, items, totals, explain, explainLoading, sample, signedIn, onSignIn, onAskWhy }: { readonly now: number; readonly items: readonly FoldTrailEntry[] | undefined; readonly totals: { settled: number; failed: number; refused: number; feesUsd: string } | undefined; readonly explain: FoldExplainArtifact | undefined; readonly explainLoading: boolean; readonly sample: boolean; readonly signedIn: boolean; readonly onSignIn: () => void; readonly onAskWhy?: (question: string, context: string) => void }) {
  const [filter, setFilter] = useState<TrailFilter>("all");
  const list = items ? filterTrails(items, filter) : [];
  const days = byDay(list, now);
  return (
    <div className="fd-grid2 fd-grid2--trails">
      <section className="fd-card m-frame m-frame--thin" aria-labelledby="trail-h">
        <header className="fd-card__head">
          <h3 id="trail-h">{msg("fold.tabs.trailsTab.theTrail")}</h3>
          <span className="m-kick">{sample ? msg("fold.tabs.trailsTab.sampleTrail") : `${items?.length ?? 0} ENTRIES`}</span>
        </header>
        <div className="fd-chips" role="tablist" aria-label={msg("fold.tabs.trailsTab.filterTheTrail")}>
          {TRAIL_FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="m-chip" onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {!signedIn && !sample ? (
          <EmptyState mood="watching" title={msg("fold.tabs.trailsTab.yourTrailIsPersonal")}>
            {msg("fold.tabs.trailsTab.signInWithYourWalletOne")}
            <div style={{ marginTop: 10 }}><button type="button" className="m-btn m-btn--sm" onClick={onSignIn}>{msg("fold.tabs.trailsTab.signIn")}</button></div>
          </EmptyState>
        ) : items === undefined ? (
          <div className="m-skel" style={{ height: 240 }} />
        ) : days.length === 0 ? (
          <EmptyState mood="resting" title={msg("fold.tabs.trailsTab.aQuietTrail")}>{msg("fold.tabs.trailsTab.nothingHereYetWhatYouAnd")}</EmptyState>
        ) : (
          <ol className="fd-trail">
            {days.map((d) => (
              <li key={d.day}>
                <span className="fd-trail__day m-kick">{d.day}</span>
                <ol>
                  {d.items.map((t) => (
                    <li key={t.id} className={cx("fd-trail__item", `fd-trail__item--${t.kind}`)}>
                      <span className="fd-trail__time num">{new Date(t.at).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" })}</span>
                      <div className="fd-trail__body">
                        <div className="fd-trail__top">
                          <Tag tone={KIND[t.kind].tone}>{KIND[t.kind].label}</Tag>
                          <b>{t.title}</b>
                          {t.verdict ? <Seal decision={t.verdict.decision} stamp={false} /> : null}
                        </div>
                        <p className="m-small m-muted">{t.detail}</p>
                        {t.memo || t.feeUsd || t.transactions.length > 0 ? (
                          <div className="fd-trail__meta">
                            {t.memo ? <code title={msg("fold.tabs.trailsTab.arcMemoBindsTheStepTo")}>{t.memo}</code> : null}
                            {t.verdict ? <span className="m-small">{msg("fold.tabs.trailsTab.verdict", { value: t.verdict.digest.replace(/^sha256:/u, "").slice(0, 10) })}</span> : null}
                            {t.feeUsd ? <span className="m-small">{msg("fold.tabs.trailsTab.fee", { feeUsd: t.feeUsd })}</span> : null}
                            {t.transactions.slice(0, 2).map((h) => <span key={h} className="m-small num">{h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h}</span>)}
                          </div>
                        ) : null}
                      </div>
                      <TrailActions t={t} onAskWhy={onAskWhy} />
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </section>
      <div className="fd-stack">
        <ExplainCard artifact={explain ? withTrailFees(explain, totals?.feesUsd ?? null) : undefined} loading={explainLoading} sample={sample} />
        <section className="fd-card m-frame m-frame--thin" aria-label={msg("fold.tabs.trailsTab.totals")}>
          <div className="fd-totals">
            <div><span className="m-kick">{msg("fold.tabs.trailsTab.settled2")}</span><b className="num">{totals?.settled ?? "—"}</b></div>
            <div><span className="m-kick">{msg("fold.tabs.trailsTab.refused2")}</span><b className="num">{totals?.refused ?? "—"}</b></div>
            <div><span className="m-kick">{msg("fold.tabs.trailsTab.failed2")}</span><b className="num">{totals?.failed ?? "—"}</b></div>
            <div><span className="m-kick">{msg("fold.tabs.trailsTab.feesLastDays", { TRAIL_FEE_WINDOW_DAYS })}</span><b className="num">{totals ? `$${totals.feesUsd}` : "—"}</b></div>
          </div>
          <p className="m-small m-muted">{msg("fold.tabs.trailsTab.lykiaSFeeIs1Of")}</p>
        </section>
      </div>
    </div>
  );
}
