import { Link } from "../app/routes/Link";
import type { RouteId } from "../app/routes/routeTable";
import { AREAS, areaOf } from "./nav";

/** The five primary areas as a bottom bar on small screens. */
export function MobileTabs({ routeId }: { readonly routeId: RouteId }) {
  const current = areaOf(routeId)?.id;
  return (
    <nav className="m-tabsbar" aria-label="Main (mobile)">
      {AREAS.map((area) => (
        <Link key={area.id} to={area.href} aria-current={area.id === current ? "page" : undefined}>
          {area.label.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}
