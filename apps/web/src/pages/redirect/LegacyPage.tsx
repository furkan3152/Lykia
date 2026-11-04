/**
 * Old addresses of pages whose work Ask Lyko or the Fold does now. Most
 * redirect (keeping what they carried); a `?draft=` or `?edit=` link opens
 * the old form as the "edit the details" step of something Lyko drafted,
 * and an agent's own page (/app/pack/:id) stays.
 */
import React, { useEffect } from "react";

import { legacyDecision } from "../../app/routes/aliases";
import { navigate } from "../../app/routes/history";
import { useRoute } from "../../app/routes/useRoute";

const PAGES: Readonly<Record<string, React.LazyExoticComponent<React.ComponentType>>> = {
  orders: React.lazy(() => import("../orders/OrdersPage")),
  alerts: React.lazy(() => import("../alerts/AlertsPage")),
  automations: React.lazy(() => import("../automations/AutomationsPage")),
  fence: React.lazy(() => import("../fence/FencePage")),
  pack: React.lazy(() => import("../pack/PackPage")),
};

export default function LegacyPage() {
  const { route, params, location } = useRoute();
  const decision = legacyDecision(route.id, params, location.search);
  const target = decision.kind === "redirect" ? decision.to : null;
  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target]);
  const Page = decision.kind === "page" ? PAGES[route.id] : undefined;
  if (!Page) return null;
  return (
    <React.Suspense fallback={null}>
      <Page />
    </React.Suspense>
  );
}
