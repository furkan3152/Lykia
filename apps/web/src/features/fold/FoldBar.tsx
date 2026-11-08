/**
 * The Fold bar: net worth with rolling digits (only the digits that changed
 * roll), the allocation as a strip of tesserae by venue type, the room left
 * today as a gauge, one line of counts, and the two ways to act: ask Lyko,
 * or blow the Whistle. Every figure carries one plain line of what it means.
 */
import { betaCapExplain, LYKIA_TERMS, MEANINGS, type FoldCard } from "@lykia/core";
import type { FlockHolding } from "@lykia/core/api/flock";
import { useState } from "react";

import { Button, LykoFace, cx } from "../../mosaic";
import { Hint, Meaning } from "../help/Help";
import { allocationStones, BUCKET_COLOR, countsLine, roomLine, usd, type FoldCounts, type Headroom, rollingChars } from "./model";

function RollingNumber({ value, label }: { readonly value: string; readonly label: string }) {
  // The value before this one, kept in state (React's "previous props" pattern), so only changed digits roll.
  const [pair, setPair] = useState({ previous: value, current: value });
  if (pair.current !== value) setPair({ previous: pair.current, current: value });
  const chars = rollingChars(pair.previous, value);
  return (
    <span className="fd-roll num" aria-label={label} role="text">
      {chars.map((c, i) => (
        <span key={`${i}-${c.char}-${c.rolls ? value : ""}`} className={cx("fd-roll__c", c.rolls && "fd-roll__c--rolls")} aria-hidden="true">
          {c.char}
        </span>
      ))}
    </span>
  );
}

function AllocationStrip({ holdings, of = 40 }: { readonly holdings: readonly FlockHolding[]; readonly of?: number }) {
  const slices = allocationStones(holdings, of);
  if (slices.length === 0) return <div className="fd-alloc fd-alloc--empty" aria-label="Nothing to allocate yet" />;
  return (
    <div className="fd-allocwrap">
      <div className="fd-alloc" role="img" aria-label={slices.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(", ")}>
        {slices.flatMap((s) => Array.from({ length: s.stones }, (_, i) => <i key={`${s.bucket}-${i}`} style={{ background: BUCKET_COLOR[s.bucket], animationDelay: `${i * 18}ms` }} />))}
      </div>
      <ul className="fd-legend">
        {slices.map((s) => (
          <li key={s.bucket}>
            <i style={{ background: BUCKET_COLOR[s.bucket] }} />
            {s.label} <b className="num">{Math.round(s.share * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HeadroomGauge({ h, large = false }: { readonly h: Headroom; readonly large?: boolean }) {
  const stones = large ? 24 : 16;
  const filled = Math.round(h.share * stones);
  return (
    <div className={cx("fd-gauge", large && "fd-gauge--lg")} data-tone={h.tone}>
      <div className="fd-gauge__row" role="meter" aria-valuemin={0} aria-valuemax={h.cap ?? 0} aria-valuenow={h.spent} aria-label={`Room left today: ${usd(h.spent, 0)} used of ${h.cap === null ? "no limit" : usd(h.cap, 0)}`}>
        {Array.from({ length: stones }, (_, i) => (
          <i key={i} data-f={i < filled} />
        ))}
      </div>
      <div className="fd-gauge__legend">
        <span className="num">{`${usd(h.spent, 0)} used`}</span>
        <span className="num">{h.left === null ? "no daily limit" : `${usd(h.left, 0)} left`}</span>
      </div>
      {large ? (
        <dl className="fd-gauge__caps">
          <div>
            <dt>{"Your daily limit"}<Hint text="The most your own rules let leave in one day. You can change it." /></dt>
            <dd className="num">{h.fenceCap === null ? "none" : usd(h.fenceCap, 0)}</dd>
          </div>
          <div>
            <dt>{"Lykia's beta limit"}<Hint text={`${betaCapExplain().why} ${betaCapExplain().scope} ${betaCapExplain().home}`} /></dt>
            <dd className="num">{h.betaCap === null ? "off on this network" : usd(h.betaCap, 0)}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

export interface FoldBarProps {
  readonly total: number | null;
  readonly unpriced: boolean;
  readonly holdings: readonly FlockHolding[];
  readonly headroom: Headroom;
  readonly counts: FoldCounts;
  readonly cards: readonly FoldCard[];
  readonly sample: boolean;
  readonly whistle: boolean;
  readonly onAsk: () => void;
  readonly onWhistle: () => void;
  readonly loading?: boolean;
}

export function FoldBar(p: FoldBarProps) {
  const show = (c: FoldCard) => p.cards.includes(c);
  const worth = p.total === null ? "—" : usd(p.total);
  return (
    <section className={cx("fd-bar m-frame", p.whistle && "fd-bar--night")} aria-label="The Fold at a glance">
      {show("networth") || show("allocation") ? (
        <div className="fd-bar__worth">
          {show("networth") ? (
            <>
              <span className="m-kick">{p.sample ? "NET WORTH · SAMPLE FLOCK" : "NET WORTH"}<Hint text={MEANINGS.netWorth} /></span>
              <div className="fd-bar__big">{p.loading ? <span className="m-skel" style={{ display: "inline-block", width: 220, height: 40 }} /> : <RollingNumber value={worth} label={`Net worth ${worth}`} />}</div>
              <Meaning>{p.unpriced ? `${MEANINGS.netWorth} Something has no price yet: it is left out, never counted as zero.` : MEANINGS.netWorth}</Meaning>
            </>
          ) : null}
          {show("allocation") ? <AllocationStrip holdings={p.holdings} /> : null}
          {show("allocation") && p.holdings.length > 0 ? <Meaning className="fd-bar__mean">{MEANINGS.allocation}</Meaning> : null}
        </div>
      ) : null}
      {show("headroom") ? (
        <div className="fd-bar__room">
          <span className="m-kick">{"ROOM LEFT TODAY"}<Hint text={MEANINGS.roomToday} /></span>
          <b className="fd-bar__roomline">{roomLine(p.headroom).replace(/^Room left today: /u, "")}</b>
          <HeadroomGauge h={p.headroom} />
          {p.headroom.capLabel === "Beta daily cap" ? <Meaning>{`${betaCapExplain().why} Money coming home is never capped.`}</Meaning> : <Meaning>{"Set by your Fence (your spending rules). Resets at midnight UTC."}</Meaning>}
        </div>
      ) : null}
      <div className="fd-bar__act">
        {show("counts") ? <p className="fd-bar__counts">{countsLine(p.counts)}<Hint text={MEANINGS.counts} /></p> : null}
        <div className="fd-bar__btns">
          <Button onClick={p.onAsk} aria-keyshortcuts="/">
            <LykoFace mood="happy" scale={1} label="" />
            {"ASK LYKO"} <kbd className="fd-kbd">/</kbd>
          </Button>
          <Button tone={p.whistle ? "ochre" : "navy"} onClick={p.onWhistle} aria-pressed={p.whistle} title={LYKIA_TERMS.whistle.line}>
            {p.whistle ? "RELEASE · LET THINGS RUN" : "WHISTLE · STOP ALL"}
          </Button>
        </div>
      </div>
    </section>
  );
}
