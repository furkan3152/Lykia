import { useEffect } from "react";

import { navigate } from "../../app/routes/history";
import { useRoute } from "../../app/routes/useRoute";
import { LykoLoader } from "../../pixel/LykoLoader";

/** /flock, /fence, /kunye, /scent and /outrun are short links into the deck (/app/…). */
export default function ShortcutPage() {
  const { location } = useRoute();
  useEffect(() => {
    navigate(`/app${location.pathname}${location.search}`, { replace: true });
  }, [location.pathname, location.search]);
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <LykoLoader label="Lyko is fetching the page" />
    </div>
  );
}
