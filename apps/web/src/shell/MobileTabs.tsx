import { Link } from "../app/routes/Link";
import type { RouteId } from "../app/routes/routeTable";
import { useFoldBadge } from "../features/fold/badge";
import { AREAS, areaOf } from "./nav";

/** The three areas as a one-row bottom bar on small screens (Ask · Fold · Mint), with Lyko's badge on the Fold. */
export function MobileTabs({ routeId }: { readonly routeId: RouteId }) {
  const current = areaOf(routeId)?.id;
  const badge = useFoldBadge((s) => s.count);
  return (
    <nav className="m-tabsbar" aria-label="Main (mobile)">
      {AREAS.map((area) => (
        <Link key={area.id} to={area.href} aria-current={area.id === current ? "page" : undefined} aria-label={`${area.label}, ${area.short}${area.id === "fold" && badge > 0 ? `, ${badge} new from Lyko` : ""}`}>
          <span className="m-tabsbar__l">
            {area.tab.toUpperCase()}
            {area.id === "fold" && badge > 0 ? <span className="m-tabsbar__badge" aria-hidden="true">{badge > 9 ? "9+" : badge}</span> : null}
          </span>
          <span className="m-tabsbar__s">{area.short}</span>
        </Link>
      ))}
    </nav>
  );
}
