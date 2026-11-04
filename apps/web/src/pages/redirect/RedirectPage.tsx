import { useEffect } from "react";

import { getLocation, navigate } from "../../app/routes/history";
import { aliasTarget } from "../../app/routes/aliases";

/** Old addresses: /developers and /build moved to The Mint, /owner to Letoon. Hashes keep working (/build#keys opens /mint/keys). */
export default function RedirectPage() {
  useEffect(() => {
    const { pathname, hash, search } = getLocation();
    navigate(aliasTarget(pathname, hash, search), { replace: true });
  }, []);
  return null;
}
