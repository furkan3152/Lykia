/**
 * Flock · the position map. Every venue is a pen (its tile, its total and a
 * state stone); every position a row with its assets, amount and value, a
 * state badge and one line of what it is doing. A row opens onto the detail:
 * a health gauge, a range bar, fees to collect, the block it was read at,
 * an explorer link and one-tap Lyko actions. The pasture above draws the
 * positions as tesserae sized by value and coloured by state; a tile
 * scrolls to its row. Venues fill in as they answer; one that cannot be read
 * says so calmly, with a retry, and is never drawn as zero.
 */
import { actionPreview, apyMeaning, healthMeaning, ltvMeaning, MEANINGS, positionKindInfo, rangeMeaning, STATE_MEANINGS, type Position, type PositionAction, type PositionState } from "@lykia/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, LykoFace, cx } from "../../../mosaic";
import type { PositionMap as PositionMapData, VenueSlot } from "../data";
import { ago, amountText, compactMoney, healthGauge, money, orderPens, penOf, positionPasture, rangeBar, rowDomId, STATE_COLOR, stateLabel, SUMMARY_STATES, type Pen } from "../positionsModel";
import { AssetStone, StateIcon, VenueTile } from "./art";
import { PositionBlocks } from "./Blocks";
import { Hint } from "../../help/Help";
import { intlLocale, t as msg } from "../../../i18n";

export interface PositionMapProps {
  readonly map: PositionMapData;
  readonly signedIn: boolean;
  readonly onSignIn: () => void;
  readonly onAction: (p: Position, a: PositionAction) => void;
  /** "Ask about this": a scoped question to Lyko on watch, with the position as context. */
  readonly onAskAbout?: (p: Position) => void;
  readonly busy?: boolean;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* -------------------------------------------------------------- badges */

export function StateBadge({ state, small }: { readonly state: PositionState; readonly small?: boolean }) {
  return (
    <span className={cx("ps-badge", small && "ps-badge--sm")} data-state={state} style={{ ["--sc" as string]: STATE_COLOR[state] }} title={STATE_MEANINGS[state]}>
      <StateIcon state={state} size={small ? 9 : 11} color="currentColor" />
      {stateLabel(state)}
    </span>
  );
}

/* ------------------------------------------------------------- summary */

function Summary({ map }: { readonly map: PositionMapData }) {
  const s = map.summary;
  const read = map.slots.filter((x) => x.read !== null).length;
  const hf = s.lowestHealth ? Number(s.lowestHealth.factor) : null;
  const floor = Number(map.healthFloor);
  return (
    <section className="ps-summary m-frame m-frame--thin" aria-label={msg("fold.positions.positionMap.summaryOfYourPositions")}>
      <div className="ps-summary__net">
        <span className="m-kick">{msg("fold.positions.positionMap.netAcrossVenues")}</span>
        <b className="num">{s.positions === 0 && s.unavailable.length > 0 ? "—" : money(Number(s.netUsd ?? s.pricedNetUsd))}</b>
        <span className="m-small m-muted">{msg("fold.positions.positionMap.positionsVenuesRead", { n: s.positions, read, total: map.slots.length })}</span>
        {s.unpriced > 0 ? <span className="ps-summary__unpriced">{msg("fold.positions.positionMap.plusUnpriced", { n: s.unpriced })}</span> : null}
        <span className="ps-laying" aria-hidden="true">
          {map.slots.map((x) => (
            <i key={x.info.id} data-on={x.read !== null} data-bad={x.read?.status === "unavailable"} />
          ))}
        </span>
      </div>
      <ul className="ps-summary__states">
        {SUMMARY_STATES.filter((k) => Number(s.byState[k]) > 0).map((k) => {
          const v = Number(s.byState[k]);
          return (
            <li key={k} data-zero={v === 0} style={{ ["--sc" as string]: STATE_COLOR[k] }} title={STATE_MEANINGS[k]}>
              <StateIcon state={k} size={11} />
              <span>{stateLabel(k)}</span>
              <b className="num">{v === 0 ? "—" : compactMoney(v)}</b>
            </li>
          );
        })}
      </ul>
      <dl className="ps-summary__facts">
        <div>
          <dt>{msg("fold.positions.positionMap.averageYearlyReturn")}<Hint text={msg("fold.positions.positionMap.thisIsTheAverageOverEverything", { apy: MEANINGS.apy, healthFactor: MEANINGS.healthFactor })} /></dt>
          <dd className="num">{s.weightedApyPercent === null ? "—" : `${s.weightedApyPercent}%`}</dd>
        </div>
        <div>
          <dt>{msg("fold.positions.positionMap.earnedInAYearAtToday")}</dt>
          <dd className="num" data-tone={s.yearlyYieldUsd !== null && Number(s.yearlyYieldUsd) < 0 ? "bad" : undefined}>{s.yearlyYieldUsd === null ? "—" : money(Number(s.yearlyYieldUsd))}</dd>
        </div>
        <div>
          <dt>{msg("fold.positions.positionMap.safestLoanMargin")}</dt>
          <dd className="num" data-tone={hf !== null && hf < Math.max(1.1, floor) ? "bad" : undefined}>{hf === null ? msg("fold.positions.positionMap.noLoans") : msg("fold.positions.positionMap.health", { value: hf.toFixed(2) })}</dd>
        </div>
      </dl>
      {s.unavailable.length > 0 ? <p className="ps-summary__miss">{msg("fold.positions.positionMap.notReadRightNowTheirMoney", { value: s.unavailable.join(", ") })}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------- pasture */

function Pasture({ map, onPick }: { readonly map: PositionMapData; readonly onPick: (id: string) => void }) {
  const { groups, tiles } = useMemo(() => positionPasture(map.slots.map((s) => ({ name: s.info.name, read: s.read }))), [map.slots]);
  if (tiles.length === 0) {
    return <div className="ps-pasture ps-pasture--empty">{map.loading ? <span className="m-small m-muted">{msg("fold.positions.positionMap.layingTheStonesAsEachVenue")}</span> : <span className="m-small m-muted">{msg("fold.positions.positionMap.nothingPricedToDrawYet")}</span>}</div>;
  }
  return (
    <div className="ps-pasture" role="group" aria-label={msg("fold.positions.positionMap.yourPositionsAsStonesSizedBy")}>
      {tiles.map((t, i) => (
        <button key={t.id} type="button" className={cx("ps-tile", t.debt && "ps-tile--debt")} data-state={t.state} style={{ left: `${t.x}%`, top: `${t.y}%`, width: `${t.w}%`, height: `${t.h}%`, ["--tile" as string]: STATE_COLOR[t.state], animationDelay: `${Math.min(i, 14) * 35}ms` }} onClick={() => onPick(t.id)} aria-label={msg("fold.positions.positionMap.showTheRow", { label: t.label, money: money(t.debt ? -t.usd : t.usd), stateLabel: stateLabel(t.state) })}>
          <span className="ps-tile__l">{t.short}</span>
          <span className="ps-tile__v num">{compactMoney(t.debt ? -t.usd : t.usd)}</span>
        </button>
      ))}
      {groups.map((g) => (
        <span key={g.venue} className="ps-pasture__pen" style={{ left: `${g.x}%`, width: `${g.w}%` }}>
          {g.name}
        </span>
      ))}
    </div>
  );
}

function Legend({ map }: { readonly map: PositionMapData }) {
  const present = new Set(map.slots.flatMap((x) => (x.read?.positions ?? []).map((p) => p.state)));
  return (
    <ul className="ps-legend" aria-label={msg("fold.positions.positionMap.whatTheColoursMean")}>
      {(["earning", "idle", "borrowing", "at-risk", "out-of-range", "pending", "escrowed", "committed", "watching"] as const).filter((k) => present.has(k)).map((k) => (
        <li key={k} title={STATE_MEANINGS[k]}>
          <StateIcon state={k} size={9} />
          {stateLabel(k)}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- detail */

function HealthGauge({ factor, floor, liquidationAt, ltv }: { readonly factor: number; readonly floor: number; readonly liquidationAt: string | null; readonly ltv: string | null }) {
  const g = healthGauge(factor, floor);
  const n = 24;
  const filled = Math.round(g.fill * n);
  return (
    <div className="ps-health" data-tone={g.tone}>
      <div className="ps-health__top">
        <span className="m-kick">{msg("fold.positions.positionMap.loanHealth")}<Hint text={MEANINGS.healthFactor} /></span>
        <b className="num">{factor.toFixed(2)}</b>
      </div>
      <div className="ps-health__row" style={{ ["--floor" as string]: `${g.floorAt * 100}%` }}>
        {Array.from({ length: n }, (_, i) => (
          <i key={i} data-f={i < filled} style={{ animationDelay: `${i * 18}ms` }} />
        ))}
        <span className="ps-health__floor" aria-hidden="true" />
      </div>
      <div className="ps-health__legend">
        <span>{msg("fold.positions.positionMap.n100Liquidation")}</span>
        <span>{msg("fold.positions.positionMap.yourFloor", { floor })}</span>
        <span>{"3.00+"}</span>
      </div>
      <p className="ps-health__mean">{healthMeaning(factor, floor)}</p>
      {ltv ? <p className="m-small m-muted">{ltvMeaning(Number(ltv), liquidationAt ? Number(liquidationAt) : null)}</p> : null}
    </div>
  );
}

function RangeBar({ p }: { readonly p: NonNullable<Position["range"]> }) {
  const r = rangeBar(Number(p.lower), Number(p.upper), Number(p.price));
  return (
    <div className="ps-range" data-in={p.inRange}>
      <div className="ps-range__top">
        <span className="m-kick">{msg("fold.positions.positionMap.priceBand", { value: p.quote.toUpperCase() })}<Hint text={MEANINGS.range} /></span>
        <b>{p.inRange ? msg("fold.positions.positionMap.inRangeEarning") : msg("fold.positions.positionMap.outOfRangeEarningNothing")}</b>
      </div>
      <div className="ps-range__bar">
        <span className="ps-range__band" style={{ left: `${r.left}%`, width: `${Math.max(1.5, r.width)}%` }} />
        <span className="ps-range__now" style={{ left: `${r.marker}%` }} />
      </div>
      <div className="ps-range__legend num">
        <span>{p.lower}</span>
        <span>{`now ${p.price}`}</span>
        <span>{p.upper}</span>
      </div>
      <p className="m-small m-muted">{rangeMeaning(p.inRange, p.lower, p.upper, p.quote)}</p>
    </div>
  );
}

function Detail({ p, floor, now, onAction, onAskAbout, busy }: { readonly p: Position; readonly floor: number; readonly now: number; readonly onAction: (p: Position, a: PositionAction) => void; readonly onAskAbout?: ((p: Position) => void) | undefined; readonly busy?: boolean }) {
  const hf = p.health?.factor ? Number(p.health.factor) : null;
  return (
    <div className="ps-detail">
      <div className="ps-detail__viz">
        {hf !== null ? <HealthGauge factor={hf} floor={Number(p.health?.floor ?? floor)} liquidationAt={p.health?.liquidationAtPercent ?? null} ltv={p.health?.ltvPercent ?? null} /> : null}
        {p.range ? <RangeBar p={p.range} /> : null}
        {p.blocks && p.blocks.length > 0 ? <PositionBlocks blocks={p.blocks} now={now} /> : null}
        {p.fees ? (
          <div className="ps-fees">
            <span className="m-kick">{msg("fold.positions.positionMap.feesToCollect")}</span>
            {p.fees.assets.length === 0 ? <span className="m-small m-muted">{msg("fold.positions.positionMap.noneAccruedYet")}</span> : (
              <ul>
                {p.fees.assets.map((a) => (
                  <li key={a.symbol}>
                    <AssetStone symbol={a.symbol} size={16} />
                    <span className="num">{amountText(a.amount, a.symbol)}</span>
                    <span className="m-muted num">{a.valueUsd === null ? "unpriced" : money(Number(a.valueUsd), Number(a.valueUsd) < 1 ? 4 : 2)}</span>
                  </li>
                ))}
              </ul>
            )}
            <small className="m-muted">{p.fees.method}</small>
          </div>
        ) : null}
        {p.assets.length > 1 ? (
          <ul className="ps-split">
            {p.assets.map((a) => (
              <li key={a.symbol}>
                <AssetStone symbol={a.symbol} size={16} />
                <span className="num">{amountText(a.amount, a.symbol)}</span>
                <span className="m-muted num">{a.valueUsd === null ? "unpriced" : money(Number(a.valueUsd))}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <dl className="ps-facts">
        {p.apy ? (
          <div>
            <dt>{p.apy.kind === "borrow" ? msg("fold.positions.positionMap.borrowingCosts") : p.apy.kind === "nav" ? msg("fold.positions.positionMap.fundGrowth") : msg("fold.positions.positionMap.yearlyReturn")}<Hint text={apyMeaning(Number(p.apy.percent), p.apy.kind, p.valueUsd === null ? null : Number(p.valueUsd))} /></dt>
            <dd className="num">{`${Number(p.apy.percent) < 0.01 && Number(p.apy.percent) > 0 ? Number(Number(p.apy.percent).toPrecision(1)) : Number(p.apy.percent).toFixed(2)}%`} <small>{p.apy.source}</small></dd>
          </div>
        ) : null}
        {p.earned ? (
          <div>
            <dt>{msg("fold.positions.positionMap.earned")}</dt>
            <dd className="num">{`+${money(Number(p.earned.usd))}`} <small>{`since ${new Date(p.earned.since).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" })}`}</small></dd>
          </div>
        ) : null}
        {p.collateral !== undefined ? (
          <div>
            <dt>{msg("fold.positions.positionMap.backsALoan")}<Hint text={msg("fold.positions.positionMap.collateralIsWhatYouPutUp")} /></dt>
            <dd>{p.collateral ? msg("fold.positions.positionMap.yesItIsCollateral") : "no"}</dd>
          </div>
        ) : null}
        {(p.facts ?? []).filter((f) => f.label !== "Stage").map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
        <div>
          <dt>{msg("fold.positions.positionMap.read")}</dt>
          <dd>
            {p.block ? <span className="num">{msg("fold.positions.positionMap.block", { value: Number(p.block).toLocaleString(intlLocale()) })}</span> : null}
            {msg("fold.positions.positionMap.from", { ago: ago(p.readAt, now), value: p.source === "chain" ? msg("fold.positions.positionMap.theChain") : p.source === "api" ? msg("fold.positions.positionMap.circleSApi") : msg("fold.positions.positionMap.yourLykiaHistory") })}
            {p.explorer ? (
              <>
                {" · "}
                <a href={p.explorer} target="_blank" rel="noreferrer">
                  {msg("fold.positions.positionMap.explorer")}
                </a>
              </>
            ) : null}
          </dd>
        </div>
      </dl>
      {p.actions.length > 0 ? (
        <div className="ps-actions">
          <span className="m-kick">{msg("fold.positions.positionMap.whatLykoCanDo")}</span>
          <ul className="ps-actions__list">
            {p.actions.map((a, i) => (
              <li key={a.kind + a.label}>
                <Button size="sm" tone={i === 0 ? "terra" : "ghost"} disabled={busy} onClick={() => onAction(p, a)}>
                  {a.mode === "ask" ? msg("fold.positions.positionMap.askLyko", { label: a.label }) : a.label}
                </Button>
                <span className="m-small">{actionPreview(a)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {onAskAbout ? (
        <button type="button" className="ps-act ps-act--ask ps-act--detail" onClick={() => onAskAbout(p)}>
          <LykoFace mood="watching" scale={0.8} />
          {msg("fold.positions.positionMap.askLykoOnWatchAboutThis")}
        </button>
      ) : null}
    </div>
  );
}

/** The row's action strip: its plain next action as a real button, and "Ask about this". */
function ActionStrip({ p, onAction, onAskAbout, busy }: { readonly p: Position; readonly onAction: (p: Position, a: PositionAction) => void; readonly onAskAbout?: ((p: Position) => void) | undefined; readonly busy?: boolean | undefined }) {
  const next = p.actions[0];
  if (!next && !onAskAbout) return null;
  return (
    <div className="ps-row__strip" role="group" aria-label={msg("fold.positions.positionMap.actOn", { label: p.label })}>
      {next ? (
        <button type="button" className="ps-act ps-act--go" disabled={busy} onClick={() => onAction(p, next)} title={actionPreview(next)}>
          <span className="ps-act__k" aria-hidden="true">{msg("fold.positions.positionMap.next")}</span>
          {next.label}
          {next.mode === "ask" ? <small>{msg("fold.positions.positionMap.inAsk")}</small> : null}
        </button>
      ) : null}
      {onAskAbout ? (
        <button type="button" className="ps-act ps-act--ask" onClick={() => onAskAbout(p)} aria-label={msg("fold.positions.positionMap.askLykoOnWatchAbout", { label: p.label })}>
          <LykoFace mood="watching" scale={0.8} />
          {msg("fold.positions.positionMap.askAboutThis")}
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ rows */

function Row({ p, open, flash, floor, now, onToggle, onAction, onAskAbout, busy }: { readonly p: Position; readonly open: boolean; readonly flash: boolean; readonly floor: number; readonly now: number; readonly onToggle: () => void; readonly onAction: (p: Position, a: PositionAction) => void; readonly onAskAbout?: ((p: Position) => void) | undefined; readonly busy?: boolean }) {
  const value = p.valueUsd === null ? null : Number(p.valueUsd);
  const symbols = [...new Set(p.assets.map((a) => a.symbol))];
  return (
    <li id={rowDomId(p.id)} className={cx("ps-row", open && "ps-row--open", flash && "ps-row--flash")} data-state={p.state} style={{ ["--sc" as string]: STATE_COLOR[p.state] }}>
      <button type="button" className="ps-row__head" aria-expanded={open} onClick={onToggle}>
        <span className="ps-row__assets" aria-hidden="true">
          {symbols.slice(0, 2).map((s) => (
            <AssetStone key={s} symbol={s} />
          ))}
        </span>
        <span className="ps-row__label">
          {p.label}
        </span>
        <span className="ps-row__nums">
          <b className="num" data-tone={value !== null && value < 0 ? "bad" : undefined}>{value === null ? "unpriced" : money(value)}</b>
          <small className="num">{p.venueKind === "lp" ? p.assets.map((a) => a.symbol).join(" + ") : amountText(p.amount, p.symbol)}</small>
        </span>
        <span className="ps-row__doing">
          <StateBadge state={p.state} small />
          <span>{p.doing}</span>
        </span>
        <span className="ps-row__chev" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {!open ? <ActionStrip p={p} onAction={onAction} onAskAbout={onAskAbout} busy={busy} /> : null}
      {open ? <Detail p={p} floor={floor} now={now} onAction={onAction} onAskAbout={onAskAbout} busy={busy} /> : null}
    </li>
  );
}

/* ------------------------------------------------------------------ pens */

function PenCard({ pen, slot, open, flash, floor, now, signedIn, onSignIn, onToggle, onAction, onAskAbout, busy, index }: { readonly pen: Pen; readonly slot: VenueSlot; readonly open: ReadonlySet<string>; readonly flash: string | null; readonly floor: number; readonly now: number; readonly signedIn: boolean; readonly onSignIn: () => void; readonly onToggle: (id: string) => void; readonly onAction: (p: Position, a: PositionAction) => void; readonly onAskAbout?: ((p: Position) => void) | undefined; readonly busy?: boolean; readonly index: number }) {
  const read = pen.read;
  if (!read) {
    return (
      <section className="ps-pen ps-pen--loading m-frame m-frame--thin" aria-busy="true" aria-label={msg("fold.positions.positionMap.reading", { name: pen.name })}>
        <header className="ps-pen__head">
          <VenueTile venue={pen.venue} kind={pen.kind} name={pen.name} />
          <div className="ps-pen__title">
            <h3>{pen.name}</h3>
            <span className="m-small m-muted">{msg("fold.positions.positionMap.readingTheChain")}</span>
          </div>
        </header>
        <div className="m-skel" style={{ height: 46 }} />
      </section>
    );
  }
  if (read.status === "unavailable") {
    return (
      <section className="ps-pen ps-pen--off" aria-label={msg("fold.positions.positionMap.couldNotBeRead", { name: pen.name })}>
        <header className="ps-pen__head">
          <VenueTile venue={pen.venue} kind={pen.kind} name={pen.name} />
          <div className="ps-pen__title">
            <h3>{msg("fold.positions.positionMap.couldnTReadRightNow", { name: pen.name })}</h3>
            <span className="m-small m-muted">{read.reason ?? msg("fold.positions.positionMap.theReadFailed")} {msg("fold.positions.positionMap.itsMoneyIsLeftOutOf")}</span>
          </div>
          <Button size="sm" tone="ghost" onClick={slot.refetch}>{msg("fold.positions.positionMap.retry")}</Button>
        </header>
      </section>
    );
  }
  if (read.status === "private") {
    return (
      <section className="ps-pen ps-pen--private" aria-label={msg("fold.positions.positionMap.ownerOnly", { name: pen.name })}>
        <header className="ps-pen__head">
          <VenueTile venue={pen.venue} kind={pen.kind} name={pen.name} />
          <div className="ps-pen__title">
            <h3>{pen.name}</h3>
            <span className="m-small m-muted">{msg("fold.positions.positionMap.ownerOnlyLykiaSOwnRecords")}</span>
          </div>
          {!signedIn ? <Button size="sm" tone="ghost" onClick={onSignIn}>{msg("fold.positions.positionMap.signIn")}</Button> : null}
        </header>
      </section>
    );
  }
  return (
    <section className="ps-pen ps-pen--laid m-frame m-frame--thin" style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }} aria-labelledby={`pen-${pen.venue}`}>
      <header className="ps-pen__head">
        <VenueTile venue={pen.venue} kind={pen.kind} name={pen.name} />
        <div className="ps-pen__title">
          <h3 id={`pen-${pen.venue}`}>{pen.name}</h3>
          <span className="m-small m-muted">{`${positionKindInfo(pen.kind).plain} · ${msg("fold.positions.positionMap.positions", { n: pen.positions.length })}${read.coverage ? msg("fold.positions.positionMap.stillScanning") : ""}`}</span>
        </div>
        <div className="ps-pen__total">
          {pen.positions.length > 0 && pen.positions.every((p) => p.counts === "overlay") && pen.overlayUsd === 0 ? (
            <small>{msg("fold.positions.positionMap.noMoneyAtStake")}</small>
          ) : pen.overlayUsd > 0 && pen.positions.every((p) => p.counts === "overlay") ? (
            <>
              <b className="num">{money(pen.overlayUsd)}</b>
              <small>{msg("fold.positions.positionMap.spokenForStillInTheWallet")}</small>
            </>
          ) : (
            <>
              <b className="num" data-tone={pen.pricedUsd < 0 ? "bad" : undefined}>{pen.unpriced > 0 && pen.pricedUsd === 0 ? "unpriced" : money(pen.pricedUsd)}</b>
              {pen.unpriced > 0 && pen.pricedUsd !== 0 ? <small>{msg("fold.positions.positionMap.unpriced", { unpriced: pen.unpriced })}</small> : null}
              {pen.overlayUsd > 0 ? <small className="num">{msg("fold.positions.positionMap.spokenFor", { money: money(pen.overlayUsd) })}</small> : null}
            </>
          )}
          {pen.stone ? (
            <span className="ps-pen__stone" title={msg("fold.positions.positionMap.mostUrgent", { stateLabel: stateLabel(pen.stone) })} style={{ ["--sc" as string]: STATE_COLOR[pen.stone] }}>
              <StateIcon state={pen.stone} size={9} color="#fff6de" />
            </span>
          ) : null}
        </div>
      </header>
      <ul className="ps-rows">
        {pen.positions.map((p) => (
          <Row key={p.id} p={p} open={open.has(p.id)} flash={flash === p.id} floor={floor} now={now} onToggle={() => onToggle(p.id)} onAction={onAction} onAskAbout={onAskAbout} busy={busy} />
        ))}
      </ul>
      {read.coverage ? <p className="ps-pen__note">{read.coverage}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------------- map */

export function PositionMap({ map, signedIn, onSignIn, onAction, onAskAbout, busy }: PositionMapProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const flashTimer = useRef<number | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);
  const toggle = useCallback((id: string) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);
  const pick = useCallback((id: string) => {
    setOpen((s) => new Set(s).add(id));
    setFlash(id);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
    window.requestAnimationFrame(() => document.getElementById(rowDomId(id))?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" }));
  }, []);

  const pens = orderPens(map.slots.map((s) => penOf(s.info, s.read)));
  const slotOf = (venue: string) => map.slots.find((s) => s.info.id === venue)!;
  const full = pens.filter((p) => p.read === null || p.read.status !== "ok" || p.positions.length > 0);
  const floor = Number(map.healthFloor);

  return (
    <div className="ps">
      <div className="ps__grid">
        <Summary map={map} />
        <section className="ps-map m-frame m-frame--thin" aria-labelledby="ps-map-h">
          <header className="fd-card__head fd-card__head--row">
            <h3 id="ps-map-h">{msg("fold.positions.positionMap.yourMoneyAtAGlance")}</h3>
            <span className="m-kick">{map.sample ? msg("ask.cards.sampleBadge") : map.block ? msg("fold.positions.positionMap.blockBadge", { block: Number(map.block).toLocaleString(intlLocale()) }) : map.loading ? "READING…" : msg("fold.positions.positionMap.justNow")}</span>
          </header>
          <Pasture map={map} onPick={pick} />
          <Legend map={map} />
        </section>
        <div className="ps-pens">
          {full.map((pen, i) => (
            <PenCard key={pen.venue} index={i} pen={pen} slot={slotOf(pen.venue)} open={open} flash={flash} floor={floor} now={now} signedIn={signedIn} onSignIn={onSignIn} onToggle={toggle} onAction={onAction} onAskAbout={onAskAbout} busy={busy} />
          ))}
        </div>
      </div>
    </div>
  );
}
