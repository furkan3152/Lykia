/**
 * A League coin: struck stone by stone, then it turns over to show the
 * city's emblem. Hover, focus or tap turns it back to the League's shared
 * face (Lyko). Under reduced motion it shows the emblem and swaps faces
 * without turning.
 */
import type { LeagueEmblem, LeagueState } from "@lykia/core";
import { useEffect, useId, useMemo, useState } from "react";

import { useReducedMotion } from "../../motion/useReducedMotion";
import { MosaicCanvas, cx } from "../../mosaic";
import { COIN, coinObverse, coinReverse } from "./art";
import { t } from "../../i18n";

export interface CoinProps {
  readonly state: LeagueState;
  readonly emblem: LeagueEmblem;
  /** The Lycian codename, struck small along the reverse's rim. */
  readonly codename?: string | null;
  readonly name: string;
  readonly size?: number;
  /** Milliseconds before the coin turns to its emblem after being struck. */
  readonly delay?: number;
  /** Turn on tap (cards); a static coin ignores taps. */
  readonly interactive?: boolean;
}

export function Coin({ state, emblem, codename, name, size = 132, delay = 0, interactive = true }: CoinProps) {
  const reduced = useReducedMotion();
  const id = useId().replace(/:/gu, "");
  const [turned, setTurned] = useState(reduced);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (reduced) return undefined;
    const timer = window.setTimeout(() => setTurned(true), 1250 + delay);
    return () => window.clearTimeout(timer);
  }, [reduced, delay]);
  const obverse = useMemo(() => coinObverse(state), [state]);
  const reverse = useMemo(() => coinReverse(state, emblem), [state, emblem]);
  const showReverse = (reduced || turned) && !held;
  const ring = `· ${(codename ?? "").toUpperCase()} · ${name.toUpperCase()} ·`;
  const faces = (
    <span className="lg-coin__inner">
      <span className="lg-coin__face lg-coin__face--ob" aria-hidden="true">
        <MosaicCanvas build={() => obverse} width={COIN} height={COIN} tile={4} gap={0.7} jitter={0.05} fps={0} assembleKey={`${name}-ob`} dataKey={state} label="" />
      </span>
      <span className="lg-coin__face lg-coin__face--rev" aria-hidden="true">
        <MosaicCanvas build={() => reverse} width={COIN} height={COIN} tile={4} gap={0.7} jitter={0.05} fps={0} assemble={false} dataKey={`${state}-${emblem}`} label="" />
        {codename ? (
          <svg viewBox="0 0 176 176" className="lg-coin__ring">
            <defs>
              <path id={`coin-${id}`} d="M88,88 m-79,0 a79,79 0 1,1 158,0 a79,79 0 1,1 -158,0" />
            </defs>
            <text fontFamily="Silkscreen" fontSize="9" letterSpacing="2.4">
              <textPath href={`#coin-${id}`} startOffset="25%" textAnchor="middle">{ring}</textPath>
            </text>
          </svg>
        ) : null}
      </span>
    </span>
  );
  const label = `${t(codename ? "league.coin.coinStruckAt" : "league.coin.coin", { name, codename, state: t(`league.coin.state.${state}`) })} ${showReverse ? t("league.coin.showingTheCitySEmblem") : t("league.coin.showingTheLeagueSSharedFace")}`;
  const className = cx("lg-coin", `lg-coin--${state}`, showReverse && "is-turned", reduced && "is-still");
  const style = { width: size, height: size };
  if (!interactive) {
    return (
      <span className={className} style={style} role="img" aria-label={label}>
        {faces}
      </span>
    );
  }
  return (
    <button type="button" className={className} style={style} aria-label={t("league.coin.turnTheCoinOver", { label })} aria-pressed={!showReverse} onClick={() => setHeld((h) => !h)} onPointerEnter={(e) => e.pointerType === "mouse" && setHeld(true)} onPointerLeave={(e) => e.pointerType === "mouse" && setHeld(false)}>
      {faces}
    </button>
  );
}
