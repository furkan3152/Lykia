import { useEffect, useRef } from "react";

import { getLocation, navigate } from "../../app/routes/history";
import { aliasTarget } from "../../app/routes/aliases";

/** Old addresses: /developers, /build and every /mint path moved to The Forge, /owner to Letoon. Hashes keep working (/build#keys opens /forge/keys). */
export default function RedirectPage() {
  // Redirect once: a second run (React's development double effect) would read the new address as an old one.
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const { pathname, hash, search } = getLocation();
    navigate(aliasTarget(pathname, hash, search), { replace: true });
  }, []);
  return null;
}
