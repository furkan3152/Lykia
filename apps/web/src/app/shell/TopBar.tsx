import { useShortcutsStore } from "../keyboard/shortcutsStore";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Popover } from "../../ui/Popover";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { useRoute } from "../routes/useRoute";
import { PulseStrip } from "./PulseStrip";
import { LangToggle } from "./LangToggle";
import { useLang } from "../../lib/i18n";
import { HeaderGrid, NAV_LINK, WhereToTrigger } from "./HeaderGrid";
import { ModeBadge } from "./ModeBadge";
import { MotionToggle } from "./MotionToggle";
import { MORE_NAV, PRIMARY_NAV } from "./navItems";
import { sheetLabel } from "./sheets";
import { ThemeToggle } from "./ThemeToggle";
import { WalletButton } from "./WalletButton";

export { WhereToTrigger } from "./HeaderGrid";

/**
 * The deck's header on the centre axis: pixel Lyko and LYKIA left, DECK ·
 * FLOCK · FENCE · SCENT · MORE centred, the whistle box ⌘K, EN/TR,
 * DAY/NIGHT, Motion and the wallet right. Under it the thin strip: the stop
 * label, Arc's pulse centred, and the network mode.
 */
export function TopBar() {
  const { route } = useRoute();
  const openShortcuts = useShortcutsStore((state) => state.setOpen);
  const moreActive = MORE_NAV.some((item) => route.id === item.id);
  const lang = useLang();
  return (
    <HeaderGrid
      sticky
      home={routeHref("deck")}
      homeLabel="Lykia deck"
      navLabel="Deck"
      nav={
        <>
          {PRIMARY_NAV.map((item) => (
            <Link key={item.id} to={item.href} match={item.match ?? "prefix"} className={cx(NAV_LINK, FOCUS_RING)}>
              {lang === "tr" ? item.tr : item.label}
            </Link>
          ))}
          <Popover
            label="More destinations"
            align="end"
            trigger={(props) => (
              <button type="button" {...props} className={cx(NAV_LINK, moreActive && "text-ink after:opacity-100", FOCUS_RING)}>
                More <span aria-hidden="true">▾</span>
              </button>
            )}
          >
            {(close) => (
              <div className="flex w-[440px] flex-col gap-3">
                <ul className="grid grid-cols-2 gap-2">
                  {MORE_NAV.map((item) => (
                    <li key={item.id}>
                      <Link to={item.href} onClick={close} className={cx("flex h-full flex-col gap-0.5 p-2 hover:bg-paper-2 aria-[current=page]:bg-signal/40", FOCUS_RING)}>
                        <span className="font-tag text-[12px] uppercase text-ink">{lang === "tr" ? item.tr : item.label}</span>
                        <span className="text-xs leading-snug text-ink-2">{item.hint}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => openShortcuts(true)} className={cx("self-center font-tag text-[11px] uppercase text-ink-2 underline decoration-2 underline-offset-4 hover:text-ink", FOCUS_RING)}>
                  Keyboard shortcuts · ?
                </button>
              </div>
            )}
          </Popover>
        </>
      }
      actions={
        <>
          <WhereToTrigger className="hidden md:inline-flex" />
          <LangToggle className="hidden sm:inline-flex" />
            <ThemeToggle compact />
          <MotionToggle compact className="hidden xl:inline-flex" />
          <WalletButton compact />
        </>
      }
      strip={
        <>
          <span className="hidden truncate justify-self-start text-ink-2 sm:block">{sheetLabel(route.id)}</span>
          <PulseStrip className="hidden justify-self-center sm:inline-flex" />
          <PulseStrip compact className="justify-self-start sm:hidden" />
          <span className="justify-self-end">
            <ModeBadge compact className="h-6 sm:hidden" />
            <ModeBadge className="hidden h-6 sm:inline-flex" />
          </span>
        </>
      }
    />
  );
}
