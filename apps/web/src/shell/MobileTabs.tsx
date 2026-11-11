import { Link } from "../app/routes/Link";
import type { RouteId } from "../app/routes/routeTable";
import { useFoldBadge } from "../features/fold/badge";
import { AREAS, areaOf, navTileText } from "./nav";
import { NavTileBody } from "./NavTile";
import { t } from "../i18n";

/** The three areas as a bottom bar of stone tiles on small screens (Ask · Fold · Forge), with Lyko's badge on the Fold. */
export function MobileTabs({ routeId }: { readonly routeId: RouteId }) {
  const current = areaOf(routeId)?.id;
  const badge = useFoldBadge((s) => s.count);
  return (
    <nav className="m-dock" aria-label={t("shell.mobileTabs.mainMobile")}>
      {AREAS.map((area) => {
        const count = area.id === "fold" ? badge : 0;
        return (
          <Link key={area.id} to={area.href} className="m-navtile m-navtile--dock" data-area={area.id} aria-current={area.id === current ? "page" : undefined} aria-label={navTileText(area, count).ariaLabel}>
            <NavTileBody area={area} badge={count} short />
          </Link>
        );
      })}
    </nav>
  );
}
