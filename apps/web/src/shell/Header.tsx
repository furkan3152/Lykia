import React from "react";

import { Link } from "../app/routes/Link";
import type { RouteId, RouteKind } from "../app/routes/routeTable";
import { useUiStore } from "../app/state/uiStore";
import { Medallion, MeanderBand, Toggle } from "../mosaic";
import { usePalette } from "./palette";
import { AREAS, areaOf } from "./nav";
import { YouMenu } from "./YouMenu";

const WalletButton = React.lazy(() => import("./WalletButton"));

export function Header({ kind, routeId }: { readonly kind: RouteKind; readonly routeId: RouteId }) {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const openPalette = usePalette((s) => s.open);
  const current = areaOf(routeId)?.id;
  return (
    <header className="m-header">
      <div className="m-wrap--wide m-wrap m-header__in">
        <Link to="/" className="m-logo" aria-label="Lykia home">
          <Medallion size={38} />
          LYKIA
        </Link>
        <nav className="m-nav" aria-label="Main">
          {AREAS.map((area) => (
            <Link key={area.id} to={area.href} title={area.blurb} aria-current={area.id === current ? "page" : undefined}>
              <span className="m-nav__l">{area.label.toUpperCase()}</span>
              <span className="m-nav__s m-nav__s--long">{area.sub}</span>
              <span className="m-nav__s m-nav__s--short">{area.short}</span>
            </Link>
          ))}
        </nav>
        <div className="m-header__act">
          <button type="button" className="m-askbtn" onClick={() => openPalette()} aria-label="Search pages, run a command or ask">
            <span>{"SEARCH"}</span>
            <kbd>⌘K</kbd>
          </button>
          <span className="m-netwrap">
            <Toggle label="Network" value={mode} onChange={(m) => setMode(m)} options={[{ value: "mainnet", label: "MAINNET" }, { value: "testnet", label: "TESTNET" }]} />
          </span>
          <YouMenu />
          {kind === "app" ? (
            <React.Suspense fallback={<span className="m-btn m-btn--sm">…</span>}>
              <WalletButton />
            </React.Suspense>
          ) : (
            <Link to="/app" className="m-btn m-btn--sm">
              {"OPEN"}
            </Link>
          )}
        </div>
      </div>
      <MeanderBand flow thin />
    </header>
  );
}
