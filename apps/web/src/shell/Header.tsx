import React from "react";

import { Link } from "../app/routes/Link";
import type { RouteId, RouteKind } from "../app/routes/routeTable";
import { useUiStore } from "../app/state/uiStore";
import { useWalletPresence } from "../app/state/walletPresence";
import { Medallion, MeanderBand, Toggle } from "../mosaic";
import { Mark } from "../mosaic/PixelArt";
import { usePalette } from "./palette";
import { AREAS, areaOf, navTileText } from "./nav";
import { NavTileBody } from "./NavTile";
import { useFoldBadge } from "../features/fold/badge";
import { YouMenu } from "./YouMenu";

const WalletButton = React.lazy(() => import("./WalletButton"));

export function Header({ kind, routeId }: { readonly kind: RouteKind; readonly routeId: RouteId }) {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const openPalette = usePalette((s) => s.open);
  const current = areaOf(routeId)?.id;
  const badge = useFoldBadge((s) => s.count);
  // The network switch is for people with a wallet, or already on testnet; everyone else finds it in the menu.
  const connected = useWalletPresence((s) => s.connected);
  const showNetwork = connected || mode === "testnet";
  return (
    <header className="m-header">
      <div className="m-wrap--wide m-wrap m-header__in">
        <Link to="/" className="m-logo" aria-label="Lykia home">
          <Medallion size={38} />
          LYKIA
        </Link>
        <nav className="m-nav" aria-label="Main">
          {AREAS.map((area) => {
            const text = navTileText(area, area.id === "fold" ? badge : 0);
            return (
              <Link key={area.id} to={area.href} className="m-navtile" data-area={area.id} title={text.title} aria-label={text.ariaLabel} aria-current={area.id === current ? "page" : undefined}>
                <NavTileBody area={area} badge={area.id === "fold" ? badge : 0} />
              </Link>
            );
          })}
        </nav>
        <div className="m-header__act">
          {/* One compact cluster: search, the network (when it matters) and the menu. */}
          <div className="m-cluster">
            <button type="button" className="m-askbtn m-askbtn--icon" onClick={() => openPalette()} aria-label="Search pages, run a command or ask (Ctrl K)" title="Search · ⌘K">
              <Mark name="search" size={14} />
            </button>
            {showNetwork ? (
              <span className="m-netwrap">
                <Toggle label="Network" value={mode} onChange={(m) => setMode(m)} options={[{ value: "mainnet", label: "MAINNET" }, { value: "testnet", label: "TESTNET" }]} />
              </span>
            ) : null}
            <YouMenu />
          </div>
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
