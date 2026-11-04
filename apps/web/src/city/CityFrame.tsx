/**
 * The frame every city shares: the city's own top bar (its coin, its name,
 * the wallet), a small "a Lykia city" mark, the city's tabs (a bottom bar
 * with large targets on phones, a segmented row on wider screens) and a
 * sticky primary action in the thumb zone. The palette accent comes from the
 * city's project brand; the stones are Mosaic's.
 */
import type { LeagueCity } from "@lykia/core";
import React from "react";

import { Coin } from "../features/league/Coin";
import { cx } from "../mosaic";
import { cityAccent } from "./model";
import { PixelIcon, type PixelIconName } from "./PixelIcon";

const WalletButton = React.lazy(() => import("../shell/WalletButton"));

export interface CityTab<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon: PixelIconName;
}

export function CityFrame<T extends string>({ city, home, tab, tabs, onTab, action, children }: { readonly city: LeagueCity; readonly home: string; readonly tab?: T; readonly tabs?: readonly CityTab<T>[]; readonly onTab?: (t: T) => void; readonly action?: React.ReactNode; readonly children: React.ReactNode }) {
  const { primary, accent } = cityAccent(city);
  const style = { "--city": primary, "--city-2": accent } as React.CSSProperties;
  return (
    <div className={cx("ct", `ct--${city.league.category}`, tabs && "ct--tabs", Boolean(action) && "ct--action")} style={style}>
      <header className="ct-top">
        <div className="ct-top__in">
          <a href="#main" className="sr-only">{"Skip to content"}</a>
          <div className="ct-brand">
            <Coin state={city.league.state} emblem={city.league.emblem} codename={null} name={city.project.name} size={40} interactive={false} />
            <div className="ct-brand__t">
              <b>{city.project.name}</b>
              <a className="ct-mark" href={home} title="Lykia: the policy layer for money on Arc">{"a Lykia city"}{city.league.codename ? ` · ${city.league.codename}` : ""}</a>
            </div>
          </div>
          {tabs && onTab ? (
            <nav className="ct-seg" aria-label={`${city.project.name} sections`}>
              {tabs.map((t) => (
                <button key={t.id} type="button" aria-current={t.id === tab ? "page" : undefined} onClick={() => onTab(t.id)}>{t.label}</button>
              ))}
            </nav>
          ) : null}
          <div className="ct-top__act">
            <React.Suspense fallback={<span className="m-btn m-btn--sm">…</span>}>
              <WalletButton />
            </React.Suspense>
          </div>
        </div>
        <div className="ct-band" aria-hidden="true" />
      </header>
      <main id="main" className="ct-main">{children}</main>
      <footer className="ct-foot">
        <a href={home}>{"Built on Lykia"}</a>
        <span>{" · Built on Arc Network · Lykia never holds your funds or keys · "}</span>
        <a href={`${home}/league`}>{"The League"}</a>
      </footer>
      {action ? <div className="ct-action">{action}</div> : null}
      {tabs && onTab ? (
        <nav className="ct-bar" aria-label={`${city.project.name} (mobile)`}>
          {tabs.map((t) => (
            <button key={t.id} type="button" aria-current={t.id === tab ? "page" : undefined} onClick={() => onTab(t.id)}>
              <PixelIcon name={t.icon} size={20} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
