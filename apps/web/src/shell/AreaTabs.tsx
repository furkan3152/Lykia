/** The section tabs of the current area (or of the account pages), under the header. */
import { Link } from "../app/routes/Link";
import type { RouteId } from "../app/routes/routeTable";
import { areaOf, sectionIsCurrent, tabsFor } from "./nav";

export function AreaTabs({ routeId }: { readonly routeId: RouteId }) {
  const tabs = tabsFor(routeId);
  if (!tabs) return null;
  const label = areaOf(routeId)?.label ?? "Account";
  return (
    <nav className="m-subnav" aria-label={`${label} sections`}>
      <div className="m-wrap m-wrap--wide m-subnav__in">
        {tabs.map((s) => (
          <Link key={s.id} to={s.href} className="m-subnav__tab" aria-current={sectionIsCurrent(s, routeId) ? "page" : undefined}>
            <span className="m-subnav__l">{s.label.toUpperCase()}</span>
            {s.sub.toLowerCase() !== s.label.toLowerCase() ? <span className="m-subnav__s">{s.sub}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
