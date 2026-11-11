import React, { Suspense, useEffect } from "react";

import type { RouteId, RouteKind } from "../app/routes/routeTable";
import { useLykiaStore, whistleOn } from "../lib/lykiaStore";
import { useProfile } from "../lib/profile";
import { Link } from "../app/routes/Link";
import { useOwnerFence } from "../features/fence/sync";
import { AreaTabs } from "./AreaTabs";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { MobileTabs } from "./MobileTabs";
import { PulseDriver } from "./PulseDriver";
import { PulseStrip } from "./PulseStrip";
import { t } from "../i18n";

/** Pages that own the whole viewport below the header (no strip, no footer). */
const FULL_BLEED: ReadonlySet<RouteId> = new Set(["ask"]);
/** The chain strip and the beta banner belong where you manage money and build: the Fold and the Forge. */
const CHAIN_CHROME: ReadonlySet<RouteId> = new Set(["fold", "forge"]);

export function Shell({ kind, routeId, children }: { readonly kind: RouteKind; readonly routeId: RouteId; readonly children: React.ReactNode }) {
  const whistle = useLykiaStore((s) => whistleOn(s.fence));
  // The owner's Fence is the server's; the deck mirrors it for every surface that shows it.
  useOwnerFence();
  // Day unless the owner chose night: the system's dark setting does not switch it.
  const night = useProfile((s) => s.profile.theme === "night");
  useEffect(() => {
    document.documentElement.dataset.night = night ? "on" : "off";
  }, [night]);
  // The Whistle marks the shell (the header and its banner), never the content surfaces.
  useEffect(() => {
    document.documentElement.dataset.whistle = whistle ? "on" : "off";
  }, [whistle]);
  const full = FULL_BLEED.has(routeId);
  return (
    <>
      <a href="#main" className="sr-only">
        {t("shell.skipToContent")}
      </a>
      <PulseDriver />
      <Header kind={kind} routeId={routeId} />
      <AreaTabs routeId={routeId} />
      {whistle ? (
        <div className="m-whistlebar" role="status">
          <span className="m-whistlebar__lamp" aria-hidden="true" />
          <span>{t("shell.theWhistleIsBlownNothingNew")}</span>
          <Link to="/app/fold/fence">{t("shell.releaseIt")}</Link>
        </div>
      ) : null}
      {CHAIN_CHROME.has(routeId) ? <PulseStrip /> : null}
      <main id="main" style={{ minHeight: full ? undefined : "60vh" }}>
        <Suspense fallback={null}>{children}</Suspense>
      </main>
      {!full ? <Footer /> : null}
      <MobileTabs routeId={routeId} />
    </>
  );
}
