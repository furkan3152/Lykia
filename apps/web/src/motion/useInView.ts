import { useEffect, useState, type RefObject } from "react";

/**
 * True while the element intersects the viewport (with `rootMargin`). Without
 * IntersectionObserver it reports true, so nothing ever stays paused or hidden.
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = "120px"): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setInView(entry.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return inView;
}
