/** The desk's sub-navigation: orders, markets, discover, alerts, activity, what-if. */
import { Link } from "../../app/routes/Link";

const DESK = [
  { href: "/app/orders", label: "Orders" },
  { href: "/app/markets", label: "Markets" },
  { href: "/app/discover", label: "Discover" },
  { href: "/app/alerts", label: "Alerts" },
  { href: "/app/activity", label: "Activity" },
  { href: "/app/whatif", label: "What-if" },
] as const;

export function DeskTabs() {
  return (
    <nav className="m-tabs" aria-label="Desk" style={{ marginTop: 18 }}>
      {DESK.map((d) => (
        <Link key={d.href} to={d.href} className="m-desk-tab" activeClassName="is-on">
          {d.label.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}

