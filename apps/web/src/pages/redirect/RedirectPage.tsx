import { useEffect } from "react";

import { navigate } from "../../app/routes/history";

/** /developers moved to /build. */
export default function RedirectPage() {
  useEffect(() => navigate("/build", { replace: true }), []);
  return null;
}
