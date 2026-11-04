/**
 * The Fold bar: net worth with rolling digits (only the digits that changed
 * roll), the allocation as a strip of tesserae by venue type, today's Fence
 * headroom as a gauge, one line of counts, and the two ways to act: ask
 * Lyko, or blow the Whistle.
 */
import type { FoldCard } from "@lykia/core";
import type { FlockHolding } from "@lykia/core/api/flock";
import { useState } from "react";

import { Button, LykoFace, cx } from "../../mosaic";
import { allocationStones, BUCKET_COLOR, compactUsd, countsLine, usd, type FoldCounts, type Headroom, rollingChars } from "./model";

export function RollingNumber({ value, label }: { readonly value: string; readonly label: string }) {
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

export function AllocationStrip({ holdings, of = 40 }: { readonly holdings: readonly FlockHolding[]; readonly of?: number }) {
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
      <div className="fd-gauge__row" role="meter" aria-valuemin={0} aria-valuemax={h.cap ?? 0} aria-valuenow={h.spent} aria-label={`Fence headroom today: ${usd(h.spent, 0)} spent of ${h.cap === null ? "no cap" : usd(h.cap, 0)}`}>
        {Array.from({ length: stones }, (_, i) => (
          <i key={i} data-f={i < filled} />
        ))}
      </div>
      <div className="fd-gauge__legend">
        <span className="num">{usd(h.spent, 0)} spent</span>
        <span className="num">{h.left === null ? "no daily cap" : `${usd(h.left, 0)} left`}</span>
      </div>
      {large ? (
        <dl className="fd-gauge__caps">
          <div><dt>{"Fence daily cap"}</dt><dd className="num">{h.fenceCap === null ? "none" : usd(h.fenceCap, 0)}</dd></div>
          <div><dt>{"Beta daily cap"}</dt><dd className="num">{h.betaCap === null ? "off" : usd(h.betaCap, 0)}</dd></div>
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
              <span className="m-kick">{p.sample ? "NET WORTH · SAMPLE FLOCK" : "NET WORTH"}</span>
              <div className="fd-bar__big">{p.loading ? <span className="m-skel" style={{ display: "inline-block", width: 220, height: 40 }} /> : <RollingNumber value={worth} label={`Net worth ${worth}`} />}</div>
              {p.unpriced ? <span className="m-small m-muted">{"Something is unpriced: shown as unpriced, never as zero."}</span> : null}
            </>
          ) : null}
          {show("allocation") ? <AllocationStrip holdings={p.holdings} /> : null}
        </div>
      ) : null}
      {show("headroom") ? (
        <div className="fd-bar__room">
          <span className="m-kick">{"FENCE HEADROOM TODAY"}</span>
          <HeadroomGauge h={p.headroom} />
          <span className="m-small m-muted">{p.headroom.cap === null ? "Your Fence sets no daily cap." : `${p.headroom.capLabel}: ${compactUsd(p.headroom.cap)}`}</span>
        </div>
      ) : null}
      <div className="fd-bar__act">
        {show("counts") ? <p className="fd-bar__counts">{countsLine(p.counts)}</p> : null}
        <div className="fd-bar__btns">
          <Button onClick={p.onAsk} aria-keyshortcuts="/">
            <LykoFace mood="happy" scale={1} label="" />
            {"ASK LYKO"} <kbd className="fd-kbd">/</kbd>
          </Button>
          <Button tone={p.whistle ? "ochre" : "navy"} onClick={p.onWhistle} aria-pressed={p.whistle}>
            {p.whistle ? "RELEASE" : "WHISTLE"}
          </Button>
        </div>
      </div>
    </section>
  );
}
