import React, { useLayoutEffect } from "react";

import { TopoBackdrop } from "../../pixel/TopoBackdrop";
import { TopoDefs } from "../../topo/TopoDefs";
import { setThemeSurface } from "../state/documentSync";
import { AppFooter } from "./SiteFooter";
import { MobileBar } from "./MobileBar";
import { TopBar } from "./TopBar";

/**
 * The deck's frame (Pixel Survey): the faint pixel contour backdrop, the centred header (nav, the whistle box, switches, wallet,
 * strip with Arc's pulse), the page outlet, a title-block
 * footer, and signpost tabs on phones. Pages render inside `<main>` with
 * `Page` (src/app/shell/Page.tsx).
 */
export function AppShell({ children }: { readonly children: React.ReactNode }) {
  useLayoutEffect(() => setThemeSurface("app"), []);
  return (
    <div className="relative isolate min-h-[100dvh] overflow-x-clip bg-paper">
      <TopoDefs />
      <TopoBackdrop />
      <a href="#main-content" className="sr-only z-[100] bg-signal px-4 py-2 font-tag text-[#1B1714] px-frame-thin focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <TopBar />
      <main id="main-content" tabIndex={-1} className="relative min-w-0 pb-24 outline-none md:pb-6">
        {children}
      </main>
      <AppFooter />
      <MobileBar />
    </div>
  );
}
