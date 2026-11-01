import { Link } from "../app/routes/Link";
import type { RouteId } from "../app/routes/routeTable";
import { NAV } from "./nav";

export function MobileTabs({ routeId }: { readonly routeId: RouteId }) {
  return (
    <nav className="m-tabsbar" aria-label="Main (mobile)">
      {NAV.map((item) => (
        <Link key={item.id} to={item.href} aria-current={item.match.includes(routeId) ? "page" : undefined}>
          {(item.en).toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}
