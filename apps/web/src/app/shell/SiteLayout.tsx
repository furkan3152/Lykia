import React, { useLayoutEffect } from "react";

import { TopoBackdrop } from "../../pixel/TopoBackdrop";
import { TopoDefs } from "../../topo/TopoDefs";
import { setThemeSurface } from "../state/documentSync";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * Layout chunk for marketing and public pages (landing, /developers,
 * /developers, /system). Wallet-free by design: it must never import the
 * wallet stack. The site is the DAY sheet unless the visitor chose NIGHT.
 */
export default function SiteLayout({ children }: { readonly children: React.ReactNode }) {
  useLayoutEffect(() => setThemeSurface("site"), []);
  return (
    <div className="relative isolate min-h-[100dvh] overflow-x-clip bg-paper">
      <TopoDefs />
      <TopoBackdrop />
      <a href="#main-content" className="sr-only z-[100] bg-signal px-4 py-2 font-tag text-[#1B1714] px-frame-thin focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="relative z-10 outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
