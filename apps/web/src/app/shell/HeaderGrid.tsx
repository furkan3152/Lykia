import React from "react";

import { useOracleStore } from "../../oracle/oracleStore";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { isApplePlatform } from "../../ui/platform";
import { Link } from "../routes/Link";
import { LykiaLogo } from "./LykiaMark";

/** Nav link: Silkscreen caps; the current page carries a 4 px sea pixel underline. */
export const NAV_LINK =
  "relative inline-flex h-[76px] items-center font-tag text-[13px] uppercase tracking-[0.04em] text-ink-2 hover:text-ink aria-[current=page]:text-ink after:absolute after:inset-x-0 after:bottom-[20px] after:h-1 after:bg-accent after:opacity-0 aria-[current=page]:after:opacity-100";

/** "WHISTLE ⌘K": opens the command box (pages, commands, sentences). */
export function WhereToTrigger({ className }: { readonly className?: string }) {
  const apple = isApplePlatform();
  return (
    <button
      type="button"
      onClick={() => useOracleStore.getState().openOracle()}
      aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
      className={cx("inline-flex h-9 min-w-0 items-stretch bg-card text-left px-frame-thin px-drop px-press", FOCUS_RING, className)}
    >
      <span className="flex items-center bg-ink px-2.5 font-tag text-[11px] uppercase text-paper">Whistle</span>
      <span className="flex items-center gap-1 px-2" aria-hidden="true">
        <Kbd>{apple ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

export interface HeaderGridProps {
  /** Where the logo goes ("/" on the site, the deck in the app). */
  readonly home: string;
  readonly homeLabel: string;
  /** The centred nav (hidden under lg). */
  readonly nav: React.ReactNode;
  readonly navLabel: string;
  /** Right side, right-aligned. */
  readonly actions: React.ReactNode;
  /** The thin strip under the header (layer heads), centred. */
  readonly strip?: React.ReactNode;
  readonly sticky?: boolean;
}

/**
 * The header on one centre axis: logo left, nav centred, actions right, in a
 * 1fr · auto · 1fr grid so the nav sits exactly on the page axis whatever the
 * two sides hold. Card stock with a thin 2 px tone line under it (no ink
 * rule), then the layer strip: a subtle tinted band with the same line.
 */
export function HeaderGrid({ home, homeLabel, nav, navLabel, actions, strip, sticky = false }: HeaderGridProps) {
  return (
    <header className={cx("relative z-40 bg-card", sticky && "sticky top-0")}>
      <div className="mx-auto grid h-[76px] max-w-[1248px] grid-cols-[1fr_auto] items-center gap-4 px-6 lg:grid-cols-[1fr_auto_1fr]">
        <Link to={home} aria-label={homeLabel} className={cx("inline-flex justify-self-start", FOCUS_RING)}>
          <LykiaLogo size="sm" className="sm:hidden" />
          <LykiaLogo className="hidden sm:inline-flex" />
        </Link>
        <nav aria-label={navLabel} className="hidden items-center gap-7 lg:flex">
          {nav}
        </nav>
        <div className="flex min-w-0 items-center justify-self-end gap-2 sm:gap-3">{actions}</div>
      </div>
      <div aria-hidden="true" className="h-[2px] bg-rule" />
      {strip ? (
        <div className="border-b-2 border-rule bg-paper-2/60">
          <div className="mx-auto grid h-8 max-w-[1248px] grid-cols-[1fr_auto] items-center gap-3 px-6 font-tag text-[11px] uppercase sm:grid-cols-[1fr_auto_1fr]">{strip}</div>
        </div>
      ) : null}
    </header>
  );
}
