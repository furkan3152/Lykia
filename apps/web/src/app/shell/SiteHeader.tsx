import { Menu } from "lucide-react";
import { useState } from "react";

import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { IconButton } from "../../ui/IconButton";
import { Sheet } from "../../ui/Sheet";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { useRoute } from "../routes/useRoute";
import { useUiStore } from "../state/uiStore";
import { PulseStrip } from "./PulseStrip";
import { LangToggle } from "./LangToggle";
import { useLang } from "../../lib/i18n";
import { HeaderGrid, NAV_LINK, WhereToTrigger } from "./HeaderGrid";
import { MotionSwitch, MotionToggle } from "./MotionToggle";
import { PRIMARY_NAV } from "./navItems";
import { sheetLabel } from "./sheets";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [...PRIMARY_NAV.map((item) => ({ label: item.label, to: item.href })), { label: "Developers", to: routeHref("developers") }] as const;

/** Site header on the centre axis: pixel Lyko and LYKIA, the nav centred, the whistle box ⌘K, EN/TR, DAY/NIGHT, Motion and Open the deck. Wallet-free. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { route } = useRoute();
  const mode = useUiStore((state) => state.mode);
  const lang = useLang();
  return (
    <>
      <HeaderGrid
        home="/"
        homeLabel="Lykia home"
        navLabel="Primary"
        nav={PRIMARY_NAV.map((link) => ({ label: lang === "tr" ? link.tr : link.label, to: link.href })).map((link) => (
          <Link key={link.label} to={link.to} match="prefix" className={cx(NAV_LINK, FOCUS_RING)}>
            {link.label}
          </Link>
        ))}
        actions={
          <>
            <WhereToTrigger className="hidden 2xl:inline-flex" />
            <LangToggle className="hidden sm:inline-flex" />
            <ThemeToggle compact />
            <MotionToggle compact className="hidden xl:inline-flex" />
            <ButtonLink to={routeHref("deck")} variant="primary" size="sm" className="h-9" rightIcon={<span aria-hidden="true">→</span>}>
              <span className="sm:hidden">Deck</span>
              <span className="hidden sm:inline">Open the deck</span>
            </ButtonLink>
            <IconButton label="Menu" icon={<Menu className="h-5 w-5" aria-hidden="true" />} variant="ink" size="sm" className="h-9 w-9 lg:hidden" onClick={() => setOpen(true)} />
          </>
        }
        strip={
          <>
            <span className="hidden truncate justify-self-start text-ink-2 sm:block">{sheetLabel(route.id)}</span>
            <PulseStrip className="hidden justify-self-center sm:inline-flex" />
            <PulseStrip compact className="justify-self-start sm:hidden" />
            <span className="justify-self-end text-ink-2">{mode === "testnet" ? "Practice pasture" : "Arc mainnet"}</span>
          </>
        }
      />
      <Sheet open={open} onClose={() => setOpen(false)} side="bottom" title="Lykia">
        <ul className="flex flex-col">
          {LINKS.map((link) => (
            <li key={link.label} className="border-b-2 border-dashed border-rule">
              <Link to={link.to} onClick={() => setOpen(false)} className={cx("block px-1 py-3 font-display text-2xl font-bold text-ink hover:bg-paper-2", FOCUS_RING)}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex items-center justify-between gap-3 bg-card p-3 px-frame-thin">
          <MotionSwitch />
          <ThemeToggle />
        </div>
      </Sheet>
    </>
  );
}
