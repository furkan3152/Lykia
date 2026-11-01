import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { cx, FOCUS_RING } from "../../ui/cx";
import { Link } from "../routes/Link";
import { useUiStore } from "../state/uiStore";
import { NAV_ITEMS, type NavItem } from "./navItems";

function RailLink({ item, collapsed }: { readonly item: NavItem; readonly collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      match={item.match ?? "prefix"}
      title={collapsed ? `${item.label}: ${item.hint}` : item.hint}
      className={cx(
        "group relative flex rounded-xl text-text-2 transition-[background-color,color] duration-fast ease-pluck hover:bg-text-0/[0.05] hover:text-text-0",
        "aria-[current=page]:bg-violet/[0.14] aria-[current=page]:text-text-0",
        collapsed ? "mx-auto h-[58px] w-[64px] flex-col items-center justify-center gap-1" : "h-10 items-center gap-3 px-3",
        FOCUS_RING,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gold opacity-0 transition-opacity group-aria-[current=page]:opacity-100"
      />
      <Icon className="h-[18px] w-[18px] shrink-0 group-aria-[current=page]:text-violet-soft" aria-hidden="true" strokeWidth={1.75} />
      <span className={cx(collapsed ? "text-[11.5px] leading-none" : "text-sm")}>{item.label}</span>
      {!collapsed && item.keys ? (
        <span className="ml-auto hidden font-mono text-xs text-text-2 opacity-0 transition-opacity group-hover:opacity-100 lg:inline">{item.keys}</span>
      ) : null}
    </Link>
  );
}

/** Left rail of the deck (desktop): the ten destinations, Settings, and the collapse toggle. */
export function Rail() {
  const collapsed = useUiStore((state) => state.railCollapsed);
  const toggle = useUiStore((state) => state.toggleRail);
  return (
    <nav
      aria-label="Deck"
      className={cx(
        "sticky top-[var(--topbar-h)] hidden h-[calc(100dvh-var(--topbar-h))] shrink-0 flex-col border-r border-line bg-bg-0/40 py-4 backdrop-blur-sm md:flex",
        collapsed ? "w-[var(--rail-w)] px-2" : "w-[var(--rail-w-expanded)] px-3",
      )}
    >
      <ul className={cx("scrollbar-none flex flex-1 flex-col overflow-y-auto", collapsed ? "gap-1" : "gap-0.5")}>
        {NAV_ITEMS.map((item) => (
          <li key={item.id} className="relative">
            <RailLink item={item} collapsed={collapsed} />
          </li>
        ))}
      </ul>
      <div className={cx("mt-3 flex border-t border-line pt-3", collapsed ? "flex-col items-center gap-1" : "flex-col gap-0.5")}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={cx(
            "flex items-center rounded-xl text-text-2 transition-colors hover:bg-text-0/[0.05] hover:text-text-0",
            collapsed ? "mx-auto h-10 w-[64px] justify-center" : "h-10 gap-3 px-3 text-sm",
            FOCUS_RING,
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />}
          {collapsed ? null : <span>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
