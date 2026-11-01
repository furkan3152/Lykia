import React, { Suspense, useEffect } from "react";

import type { RouteId, RouteKind } from "../app/routes/routeTable";
import { useLykiaStore, whistleOn } from "../lib/lykiaStore";
import { useProfile } from "../lib/profile";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { MobileTabs } from "./MobileTabs";
import { PulseDriver } from "./PulseDriver";
import { PulseStrip } from "./PulseStrip";

/** Pages that own the whole viewport below the header (no strip, no footer). */
const FULL_BLEED: ReadonlySet<RouteId> = new Set(["ask"]);

export function Shell({ kind, routeId, children }: { readonly kind: RouteKind; readonly routeId: RouteId; readonly children: React.ReactNode }) {
  const whistle = useLykiaStore((s) => whistleOn(s.fence));
  const theme = useProfile((s) => s.profile.theme);
  const prefersDark = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const night = whistle || theme === "night" || (theme === "auto" && prefersDark);
  useEffect(() => {
    document.documentElement.dataset.night = night ? "on" : "off";
  }, [night]);
  const full = FULL_BLEED.has(routeId);
  return (
    <>
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <PulseDriver />
      <Header kind={kind} routeId={routeId} />
      {!full ? <PulseStrip /> : null}
      <main id="main" style={{ minHeight: full ? undefined : "60vh" }}>
        <Suspense fallback={null}>{children}</Suspense>
      </main>
      {!full ? <Footer /> : null}
      <MobileTabs routeId={routeId} />
    </>
  );
}
