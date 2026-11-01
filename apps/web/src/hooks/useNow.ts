import { useEffect, useState } from "react";

import { usePageVisible } from "../motion/usePageVisible";

/** Wall clock that ticks every `intervalMs` while the page is visible (for ages and countdowns). */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, visible]);
  return now;
}
