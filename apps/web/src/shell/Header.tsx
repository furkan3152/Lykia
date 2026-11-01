import React from "react";

import { Link } from "../app/routes/Link";
import type { RouteId, RouteKind } from "../app/routes/routeTable";
import { useUiStore } from "../app/state/uiStore";
import { useLang } from "../lib/i18n";
import { Medallion, MeanderBand, Toggle } from "../mosaic";
import { usePalette } from "./palette";
import { NAV } from "./nav";
import { YouMenu } from "./YouMenu";

const WalletButton = React.lazy(() => import("./WalletButton"));

export function Header({ kind, routeId }: { readonly kind: RouteKind; readonly routeId: RouteId }) {
  const lang = useLang();
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const openPalette = usePalette((s) => s.open);
  return (
    <header className="m-header">
      <div className="m-wrap--wide m-wrap m-header__in">
        <Link to="/" className="m-logo" aria-label="Lykia home">
          <Medallion size={38} />
          LYKIA
        </Link>
        <nav className="m-nav" aria-label="Main">
          {NAV.map((item) => (
            <Link key={item.id} to={item.href} aria-current={item.match.includes(routeId) ? "page" : undefined}>
              {(lang === "tr" ? item.tr : item.en).toUpperCase()}
            </Link>
          ))}
        </nav>
        <div className="m-header__act">
          <button type="button" className="m-askbtn" onClick={() => openPalette()} aria-label="Ask Lyko or run a command">
            <span>{lang === "tr" ? "SOR" : "ASK"}</span>
            <kbd>⌘K</kbd>
          </button>
          <Toggle label="Network" value={mode} onChange={(m) => setMode(m)} options={[{ value: "mainnet", label: "MAINNET" }, { value: "testnet", label: "TESTNET" }]} />
          <YouMenu />
          {kind === "app" ? (
            <React.Suspense fallback={<span className="m-btn m-btn--sm">…</span>}>
              <WalletButton />
            </React.Suspense>
          ) : (
            <Link to="/app" className="m-btn m-btn--sm">
              {lang === "tr" ? "AÇ" : "OPEN"}
            </Link>
          )}
        </div>
      </div>
      <MeanderBand flow thin />
    </header>
  );
}
