import { Link } from "../app/routes/Link";
import type { RouteId } from "../app/routes/routeTable";
import { useLang } from "../lib/i18n";
import { NAV } from "./nav";

export function MobileTabs({ routeId }: { readonly routeId: RouteId }) {
  const lang = useLang();
  return (
    <nav className="m-tabsbar" aria-label="Main (mobile)">
      {NAV.map((item) => (
        <Link key={item.id} to={item.href} aria-current={item.match.includes(routeId) ? "page" : undefined}>
          {(lang === "tr" ? item.tr : item.en).toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}
