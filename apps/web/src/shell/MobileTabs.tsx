import { Link } from "../app/routes/Link";
import type { RouteId } from "../app/routes/routeTable";
import { AREAS, areaOf } from "./nav";

/** The five primary areas as a one-row bottom bar on small screens: the metaphor, and one plain word under it. */
export function MobileTabs({ routeId }: { readonly routeId: RouteId }) {
  const current = areaOf(routeId)?.id;
  return (
    <nav className="m-tabsbar" aria-label="Main (mobile)">
      {AREAS.map((area) => (
        <Link key={area.id} to={area.href} aria-current={area.id === current ? "page" : undefined} aria-label={`${area.label}, ${area.sub}`}>
          <span className="m-tabsbar__l">{area.label.toUpperCase()}</span>
          <span className="m-tabsbar__s">{area.short}</span>
        </Link>
      ))}
    </nav>
  );
}
