/**
 * The League · Lykia's cities. The Lycian League was a union of cities that
 * minted one coinage; Lykia's sub-products are its cities. Each is a real
 * project built in The Forge, listed by the Lykia team or approved by it.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Link } from "../../app/routes/Link";
import { coast, COAST_H, COAST_W, harbourSlots, shoreAt } from "../../features/league/art";
import { CityCard } from "../../features/league/CityCard";
import { ForgeStrike } from "../../features/league/ForgeStrike";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { STATE_LABEL } from "../../features/league/model";
import { useLeague } from "../../features/league/useLeague";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { usePulse } from "../../lib/pulseStore";
import { EmptyState, PageHead, Skeleton, Stat } from "../../mosaic";
import { intlLocale, t as msg } from "../../i18n";

export default function LeaguePage() {
  const league = useLeague();
  const lit = usePulse((s) => s.lit);
  const cities = useMemo(() => league.data?.cities ?? [], [league.data]);
  const slots = harbourSlots(cities.length);
  const live = cities.filter((c) => c.league.state === "live").length;
  const requests = cities.reduce((n, c) => n + c.usage.last7Days.requests, 0);
  const labels = cities.map((c, i) => ({ x: (slots[i]! / COAST_W) * 100, y: ((shoreAt(slots[i]!) + 13) / COAST_H) * 100, text: `${c.league.codename ? `${c.league.codename.toUpperCase()} · ` : ""}${c.project.name.replace(/^Lykia /u, "").toUpperCase()}`, tone: c.league.state === "live" ? ("ok" as const) : c.league.state === "paused" ? ("bad" as const) : ("ochre" as const), priority: 5 - i / 10 }));
  const dataKey = `${cities.map((c) => c.league.state).join(",")}|${lit}`;
  return (
    <div>
      <PageHead kicker={msg("league.theForgeLeague")} title={<>{msg("league.theLeague")} <em>{msg("league.lykiaSCities")}</em></>} sub={msg("league.theLycianLeagueWasAUnion")} mood="proud" />

      <section className="m-wrap" style={{ marginTop: 26 }} aria-label={msg("league.theCoastOfTheLeague")}>
        <SceneFrame build={(t) => coast(cities.map((c) => ({ state: c.league.state })), t)} width={COAST_W} height={COAST_H} dataKey={dataKey} assembleKey={cities.length} labels={labels} label={msg("league.theLycianCoastWithHarboursOne", { length: cities.length, live })} />
        {/* The counts appear once there is a city to count; an empty League shows the anvil instead. */}
        {cities.length > 0 ? (
          <div className="m-grid-3 lg-stats">
            <Stat label={msg("league.cities")} value={String(cities.length)} hint={msg("league.listedInTheLeague")} />
            <Stat label={msg("league.litHarbours")} value={String(live)} hint={msg("league.citiesLiveOnArc")} />
            <Stat label={msg("league.requests7Days")} value={requests.toLocaleString(intlLocale())} hint={msg("league.throughTheCitiesOwnKeys")} />
          </div>
        ) : null}
      </section>

      <section className="m-wrap" style={{ marginTop: 32 }} aria-labelledby="lg-coins">
        <div className="m-center">
          <span className="m-kick">{msg("league.theCoinage")}</span>
          <h2 id="lg-coins" className="m-h2" style={{ marginTop: 8 }}>{msg("league.oneFaceForTheLeagueOne")}</h2>
          {cities.length > 0 ? <p className="m-small m-muted" style={{ marginTop: 6 }}>{msg("league.everyCoinCarriesLykoOnThe")}</p> : null}
        </div>
        {league.isLoading ? (
          <div className="lg-grid" style={{ marginTop: 22 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={420} />)}</div>
        ) : league.isError ? (
          <EmptyState mood="alert" title={msg("league.theLeagueDidNotAnswer")}>{msg("league.theApiCouldNotBeReached")}</EmptyState>
        ) : cities.length === 0 ? (
          <StrikeTheFirst />
        ) : (
          <CoinCarousel>
            {cities.map((c, i) => <CityCard key={c.slug} city={c} index={i} />)}
          </CoinCarousel>
        )}
      </section>

      {cities.length === 0 && !league.isError ? null : (
      <section className="m-wrap" style={{ marginTop: 40 }} aria-labelledby="lg-found">
        <div className="m-frame m-card lg-found">
          <div>
            <span className="m-kick">{msg("league.foundACity")}</span>
            <h2 id="lg-found" className="m-h2" style={{ marginTop: 6, fontSize: 26 }}>{msg("league.strikeYourOwnCoinInThe")}</h2>
            <p className="m-small" style={{ marginTop: 6 }}>{msg("league.leaguePage.howToList")}</p>
          </div>
          <div className="lg-found__acts">
            <Link to="/forge/strike" className="m-btn">{msg("league.strikeACity")}</Link>
            <Link to="/forge/cities" className="m-btn m-btn--ghost">{msg("league.yourCities")}</Link>
          </div>
        </div>
        <p className="m-small m-muted m-center" style={{ marginTop: 12 }}>{msg("league.statesUsageCountsAreRealRequests", { value: Object.values(STATE_LABEL).join(", ").toLowerCase() })}</p>
      </section>
      )}
    </div>
  );
}

/**
 * An empty League, honestly: the Forge's anvil strikes, a shelf of blank coins
 * waits, and one call to action founds the first city. No city is invented.
 */
function StrikeTheFirst() {
  const reduced = useReducedMotion();
  const [strike, setStrike] = useState(0);
  useEffect(() => {
    if (reduced) return undefined;
    const t = window.setInterval(() => setStrike((k) => k + 1), 4200);
    return () => window.clearInterval(t);
  }, [reduced]);
  return (
    <div className="lg-first m-frame" style={{ marginTop: 22 }}>
      <div className="lg-first__forge">
        <ForgeStrike strikeKey={strike} label={msg("league.theForgeSAnvilStrikingA")} />
        <div className="lg-first__shelf" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="lg-blank" style={{ ["--i" as string]: i }} />)}
        </div>
      </div>
      <div className="lg-first__copy">
        <span className="m-kick">{msg("league.theAnvilIsHotTheShelf")}</span>
        <h3 className="m-h2">{msg("league.noCityIsListedYet")}</h3>
        <p>{msg("league.theLeagueHostsCitiesOfficialCities")}</p>
        <div className="lg-first__acts">
          <Link to="/forge/strike" className="m-btn m-btn--lg">{msg("league.strikeTheFirstCity")}</Link>
          <Link to="/forge/cities" className="m-btn m-btn--ghost">{msg("league.yourCities")}</Link>
        </div>
        <p className="m-small m-muted">{msg("league.leaguePage.howToListShort")}</p>
      </div>
    </div>
  );
}

/**
 * The coins: a grid on wide screens, a swipeable carousel on phones (scroll
 * snapping, one coin centred, the next one peeking), with stone dots that
 * follow the swipe and jump to a coin when tapped.
 */
function CoinCarousel({ children }: { readonly children: React.ReactNode[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const onScroll = () => {
    const el = ref.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    setIndex(Math.round(el.scrollLeft / (first.offsetWidth + 16)));
  };
  const go = (i: number) => {
    const el = ref.current;
    const target = el?.children[i] as HTMLElement | undefined;
    if (el && target) el.scrollTo({ left: target.offsetLeft - (el.clientWidth - target.offsetWidth) / 2, behavior: "smooth" });
  };
  return (
    <>
      <div ref={ref} className="lg-grid lg-carousel" style={{ marginTop: 22 }} onScroll={onScroll} aria-roledescription={msg("league.carousel")} aria-label={msg("league.citiesOfTheLeague")}>
        {children}
      </div>
      <div className="lg-dots" aria-label={msg("league.chooseACity")}>
        {children.map((_, i) => <button key={i} type="button" aria-label={msg("league.cityOf", { value: i + 1, length: children.length })} aria-current={i === index ? "true" : undefined} onClick={() => go(i)} />)}
      </div>
    </>
  );
}
