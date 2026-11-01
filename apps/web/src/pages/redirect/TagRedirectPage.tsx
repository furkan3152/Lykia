import { useEffect } from "react";

import { navigate } from "../../app/routes/history";

/** /app/kunye/:agentId? moved to /app/tag/:agentId? (the agent Tag). */
export default function TagRedirectPage() {
  useEffect(() => {
    const rest = window.location.pathname.replace(/^\/app\/kunye/u, "");
    navigate(`/app/tag${rest}${window.location.search}`, { replace: true });
  }, []);
  return null;
}
