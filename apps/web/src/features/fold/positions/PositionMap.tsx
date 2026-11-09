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

import { Button, cx } from "../../../mosaic";
import type { PositionMap as PositionMapData, VenueSlot } from "../data";
import { ago, amountText, compactMoney, healthGauge, money, orderPens, penOf, positionPasture, rangeBar, rowDomId, STATE_COLOR, stateLabel, SUMMARY_STATES, type Pen } from "../positionsModel";
import { AssetStone, StateIcon, VenueTile } from "./art";
import { PositionBlocks } from "./Blocks";
import { Hint } from "../../help/Help";

export interface PositionMapProps {
  readonly map: PositionMapData;
  readonly signedIn: boolean;
  readonly onSignIn: () => void;
  readonly onAction: (p: Position, a: PositionAction) => void;
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
    <section className="ps-summary m-frame m-frame--thin" aria-label="Summary of your positions">
      <div className="ps-summary__net">
        <span className="m-kick">{map.sample ? "SAMPLE · NET WORTH" : "NET ACROSS VENUES"}</span>
        <b className="num">{s.positions === 0 && s.unavailable.length > 0 ? "—" : money(Number(s.netUsd ?? s.pricedNetUsd))}</b>
        <span className="m-small m-muted">{`${s.positions} position${s.positions === 1 ? "" : "s"} · ${read} of ${map.slots.length} venues read`}</span>
        {s.unpriced > 0 ? <span className="ps-summary__unpriced">{`plus ${s.unpriced} unpriced position${s.unpriced === 1 ? "" : "s"}, left out rather than counted as zero`}</span> : null}
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
          <dt>{"Average yearly return"}<Hint text={`${MEANINGS.apy} This is the average over everything that earns, weighted by size.`} /></dt>
          <dd className="num">{s.weightedApyPercent === null ? "—" : `${s.weightedApyPercent}%`}</dd>
        </div>
        <div>
          <dt>{"Earned in a year, at today's rates"}<Hint text="What everything that earns would make in a year at today's rates, minus what your loans cost. An estimate: rates move every day." /></dt>
          <dd className="num" data-tone={s.yearlyYieldUsd !== null && Number(s.yearlyYieldUsd) < 0 ? "bad" : undefined}>{s.yearlyYieldUsd === null ? "—" : money(Number(s.yearlyYieldUsd))}</dd>
        </div>
        <div>
          <dt>{"Safest loan margin"}<Hint text={MEANINGS.healthFactor} /></dt>
          <dd className="num" data-tone={hf !== null && hf < Math.max(1.1, floor) ? "bad" : undefined}>{hf === null ? "no loans" : `health ${hf.toFixed(2)}`}</dd>
        </div>
      </dl>
      {s.unavailable.length > 0 ? <p className="ps-summary__miss">{`Not read right now: ${s.unavailable.join(", ")}. Their money is not in these totals.`}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------- pasture */

function Pasture({ map, onPick }: { readonly map: PositionMapData; readonly onPick: (id: string) => void }) {
  const { groups, tiles } = useMemo(() => positionPasture(map.slots.map((s) => ({ name: s.info.name, read: s.read }))), [map.slots]);
  if (tiles.length === 0) {
    return <div className="ps-pasture ps-pasture--empty">{map.loading ? <span className="m-small m-muted">{"Laying the stones as each venue answers…"}</span> : <span className="m-small m-muted">{"Nothing priced to draw yet."}</span>}</div>;
  }
  return (
    <div className="ps-pasture" role="group" aria-label="Your positions as stones, sized by value and coloured by state">
      {tiles.map((t, i) => (
        <button key={t.id} type="button" className={cx("ps-tile", t.debt && "ps-tile--debt")} data-state={t.state} style={{ left: `${t.x}%`, top: `${t.y}%`, width: `${t.w}%`, height: `${t.h}%`, ["--tile" as string]: STATE_COLOR[t.state], animationDelay: `${Math.min(i, 14) * 35}ms` }} onClick={() => onPick(t.id)} aria-label={`${t.label}: ${money(t.debt ? -t.usd : t.usd)}, ${stateLabel(t.state)}. Show the row.`}>
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
    <ul className="ps-legend" aria-label="What the colours mean">
      {(["earning", "idle", "borrowing", "at-risk", "out-of-range", "pending", "escrowed", "committed", "watching"] as const).filter((k) => present.has(k)).map((k) => (
        <li key={k} title={STATE_MEANINGS[k]}>
          <StateIcon state={k} size={9} />
          {STATE_MEANINGS[k]}
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
        <span className="m-kick">{"LOAN HEALTH"}<Hint text={MEANINGS.healthFactor} /></span>
        <b className="num">{factor.toFixed(2)}</b>
      </div>
      <div className="ps-health__row" style={{ ["--floor" as string]: `${g.floorAt * 100}%` }}>
        {Array.from({ length: n }, (_, i) => (
          <i key={i} data-f={i < filled} style={{ animationDelay: `${i * 18}ms` }} />
        ))}
        <span className="ps-health__floor" aria-hidden="true" />
      </div>
      <div className="ps-health__legend">
        <span>{"1.00 liquidation"}</span>
        <span>{`your floor ${floor}`}</span>
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
        <span className="m-kick">{`PRICE BAND · ${p.quote.toUpperCase()}`}<Hint text={MEANINGS.range} /></span>
        <b>{p.inRange ? "in range: earning" : "out of range: earning nothing"}</b>
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

function Detail({ p, floor, now, onAction, busy }: { readonly p: Position; readonly floor: number; readonly now: number; readonly onAction: (p: Position, a: PositionAction) => void; readonly busy?: boolean }) {
  const hf = p.health?.factor ? Number(p.health.factor) : null;
  return (
    <div className="ps-detail">
      <div className="ps-detail__viz">
        {hf !== null ? <HealthGauge factor={hf} floor={Number(p.health?.floor ?? floor)} liquidationAt={p.health?.liquidationAtPercent ?? null} ltv={p.health?.ltvPercent ?? null} /> : null}
        {p.range ? <RangeBar p={p.range} /> : null}
        {p.blocks && p.blocks.length > 0 ? <PositionBlocks blocks={p.blocks} now={now} /> : null}
        {p.fees ? (
          <div className="ps-fees">
            <span className="m-kick">{"FEES TO COLLECT"}</span>
            {p.fees.assets.length === 0 ? <span className="m-small m-muted">{"None accrued yet."}</span> : (
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
            <dt>{p.apy.kind === "borrow" ? "Borrowing costs" : p.apy.kind === "nav" ? "Fund growth" : "Yearly return"}<Hint text={apyMeaning(Number(p.apy.percent), p.apy.kind, p.valueUsd === null ? null : Number(p.valueUsd))} /></dt>
            <dd className="num">{`${Number(p.apy.percent) < 0.01 && Number(p.apy.percent) > 0 ? Number(Number(p.apy.percent).toPrecision(1)) : Number(p.apy.percent).toFixed(2)}%`} <small>{p.apy.source}</small></dd>
          </div>
        ) : null}
        {p.earned ? (
          <div>
            <dt>{"Earned"}</dt>
            <dd className="num">{`+${money(Number(p.earned.usd))}`} <small>{`since ${new Date(p.earned.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}</small></dd>
          </div>
        ) : null}
        {p.collateral !== undefined ? (
          <div>
            <dt>{"Backs a loan"}<Hint text="Collateral is what you put up so you can borrow. If the loan gets too risky, part of it can be sold to repay." /></dt>
            <dd>{p.collateral ? "yes, it is collateral" : "no"}</dd>
          </div>
        ) : null}
        {(p.facts ?? []).filter((f) => f.label !== "Stage").map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
        <div>
          <dt>{"Read"}</dt>
          <dd>
            {p.block ? <span className="num">{`block ${Number(p.block).toLocaleString("en-US")} · `}</span> : null}
            {`${ago(p.readAt, now)} · from ${p.source === "chain" ? "the chain" : p.source === "api" ? "Circle's API" : "your Lykia history"}`}
            {p.explorer ? (
              <>
                {" · "}
                <a href={p.explorer} target="_blank" rel="noreferrer">
                  {"explorer ↗"}
                </a>
              </>
            ) : null}
          </dd>
        </div>
      </dl>
      {p.actions.length > 0 ? (
        <div className="ps-actions">
          <span className="m-kick">{"WHAT LYKO CAN DO"}</span>
          <ul className="ps-actions__list">
            {p.actions.map((a, i) => (
              <li key={a.kind + a.label}>
                <Button size="sm" tone={i === 0 ? "terra" : "ghost"} disabled={busy} onClick={() => onAction(p, a)}>
                  {a.mode === "ask" ? `${a.label} · ask Lyko` : a.label}
                </Button>
                <span className="m-small">{actionPreview(a)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ rows */

function Row({ p, open, flash, floor, now, onToggle, onAction, busy }: { readonly p: Position; readonly open: boolean; readonly flash: boolean; readonly floor: number; readonly now: number; readonly onToggle: () => void; readonly onAction: (p: Position, a: PositionAction) => void; readonly busy?: boolean }) {
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
        {!open && p.actions[0] ? <span className="ps-row__next">{`Next: ${p.actions[0].label.toLowerCase()}${p.actions[0].mode === "ask" ? " (ask Lyko)" : ""}`}</span> : null}
        <span className="ps-row__chev" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? <Detail p={p} floor={floor} now={now} onAction={onAction} busy={busy} /> : null}
    </li>
  );
}

/* ------------------------------------------------------------------ pens */

function PenCard({ pen, slot, open, flash, floor, now, signedIn, onSignIn, onToggle, onAction, busy, index }: { readonly pen: Pen; readonly slot: VenueSlot; readonly open: ReadonlySet<string>; readonly flash: string | null; readonly floor: number; readonly now: number; readonly signedIn: boolean; readonly onSignIn: () => void; readonly onToggle: (id: string) => void; readonly onAction: (p: Position, a: PositionAction) => void; readonly busy?: boolean; readonly index: number }) {
  const read = pen.read;
  if (!read) {
    return (
      <section className="ps-pen ps-pen--loading m-frame m-frame--thin" aria-busy="true" aria-label={`${pen.name}: reading`}>
        <header className="ps-pen__head">
          <VenueTile venue={pen.venue} kind={pen.kind} name={pen.name} />
          <div className="ps-pen__title">
            <h3>{pen.name}</h3>
            <span className="m-small m-muted">{"Reading the chain…"}</span>
          </div>
        </header>
        <div className="m-skel" style={{ height: 46 }} />
      </section>
    );
  }
  if (read.status === "unavailable") {
    return (
      <section className="ps-pen ps-pen--off" aria-label={`${pen.name}: could not be read`}>
        <header className="ps-pen__head">
          <VenueTile venue={pen.venue} kind={pen.kind} name={pen.name} />
          <div className="ps-pen__title">
            <h3>{`Couldn't read ${pen.name} right now`}</h3>
            <span className="m-small m-muted">{read.reason ?? "The read failed."} {"Its money is left out of the totals, not counted as zero."}</span>
          </div>
          <Button size="sm" tone="ghost" onClick={slot.refetch}>{"Retry"}</Button>
        </header>
      </section>
    );
  }
  if (read.status === "private") {
    return (
      <section className="ps-pen ps-pen--private" aria-label={`${pen.name}: owner only`}>
        <header className="ps-pen__head">
          <VenueTile venue={pen.venue} kind={pen.kind} name={pen.name} />
          <div className="ps-pen__title">
            <h3>{pen.name}</h3>
            <span className="m-small m-muted">{"Owner only: Lykia's own records. Sign in as this address to see them."}</span>
          </div>
          {!signedIn ? <Button size="sm" tone="ghost" onClick={onSignIn}>{"Sign in"}</Button> : null}
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
          <span className="m-small m-muted">{`${positionKindInfo(pen.kind).plain} · ${pen.positions.length} position${pen.positions.length === 1 ? "" : "s"}${read.coverage ? " · still scanning" : ""}`}</span>
        </div>
        <div className="ps-pen__total">
          {pen.positions.length > 0 && pen.positions.every((p) => p.counts === "overlay") && pen.overlayUsd === 0 ? (
            <small>{"no money at stake"}</small>
          ) : pen.overlayUsd > 0 && pen.positions.every((p) => p.counts === "overlay") ? (
            <>
              <b className="num">{money(pen.overlayUsd)}</b>
              <small>{"spoken for, still in the wallet"}</small>
            </>
          ) : (
            <>
              <b className="num" data-tone={pen.pricedUsd < 0 ? "bad" : undefined}>{pen.unpriced > 0 && pen.pricedUsd === 0 ? "unpriced" : money(pen.pricedUsd)}</b>
              {pen.unpriced > 0 && pen.pricedUsd !== 0 ? <small>{`+ ${pen.unpriced} unpriced`}</small> : null}
              {pen.overlayUsd > 0 ? <small className="num">{`+ ${money(pen.overlayUsd)} spoken for`}</small> : null}
            </>
          )}
          {pen.stone ? (
            <span className="ps-pen__stone" title={`Most urgent: ${stateLabel(pen.stone)}`} style={{ ["--sc" as string]: STATE_COLOR[pen.stone] }}>
              <StateIcon state={pen.stone} size={9} color="#fff6de" />
            </span>
          ) : null}
        </div>
      </header>
      <ul className="ps-rows">
        {pen.positions.map((p) => (
          <Row key={p.id} p={p} open={open.has(p.id)} flash={flash === p.id} floor={floor} now={now} onToggle={() => onToggle(p.id)} onAction={onAction} busy={busy} />
        ))}
      </ul>
      {read.coverage ? <p className="ps-pen__note">{read.coverage}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------------- map */

export function PositionMap({ map, signedIn, onSignIn, onAction, busy }: PositionMapProps) {
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
  const empty = pens.filter((p) => p.read?.status === "ok" && p.positions.length === 0);
  const floor = Number(map.healthFloor);

  return (
    <div className="ps">
      <div className="ps__grid">
        <Summary map={map} />
        <section className="ps-map m-frame m-frame--thin" aria-labelledby="ps-map-h">
          <header className="fd-card__head fd-card__head--row">
            <h3 id="ps-map-h">{"Your money at a glance"}</h3>
            <span className="m-kick">{map.sample ? "SAMPLE · NOT READ FROM ARC" : map.block ? `READ AT BLOCK ${Number(map.block).toLocaleString("en-US")}` : map.loading ? "READING…" : "READ JUST NOW"}</span>
          </header>
          <p className="m-small m-muted ps-map__mean">{"Each stone is a position, sized by what it is worth and coloured by what it is doing. Tap one to see its row."}</p>
          <Pasture map={map} onPick={pick} />
          <Legend map={map} />
        </section>
        <div className="ps-pens">
          {full.map((pen, i) => (
            <PenCard key={pen.venue} index={i} pen={pen} slot={slotOf(pen.venue)} open={open} flash={flash} floor={floor} now={now} signedIn={signedIn} onSignIn={onSignIn} onToggle={toggle} onAction={onAction} busy={busy} />
          ))}
        </div>
        {empty.length > 0 ? (
          <p className="ps-empty">
            <span className="m-kick">{"NOTHING AT"}</span> {empty.map((p) => p.name).join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
