/**
 * Old addresses of pages whose work Ask Lyko or the Fold does now. Every one
 * redirects, keeping what it carried: a `?draft=` link opens Ask Lyko with
 * what the draft said, an `?edit=` link asks Lyko to change the item, and
 * the pages that became answers (yields, new pools, perps markets) open Ask
 * with the question filled in.
 */
import { useEffect } from "react";

import { legacyDecision } from "../../app/routes/aliases";
import { navigate } from "../../app/routes/history";
import { useRoute } from "../../app/routes/useRoute";

export default function LegacyPage() {
  const { route, params, location } = useRoute();
  const target = legacyDecision(route.id, params, location.search).to;
  useEffect(() => {
    navigate(target, { replace: true });
  }, [target]);
  return null;
}
