import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { usePageVisible } from "../motion/usePageVisible";
import { LykoToast } from "../pixel/LykoToast";
import { cx } from "./cx";
import { getToasts, MAX_VISIBLE_TOASTS, subscribeToasts, toast as toastApi, type ToastRecord } from "./toast";

function clock(at: number | undefined): string {
  if (at === undefined) return "";
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** One radio message from base camp: a timestamped call sign line, then the message in plain words. */
function ToastItem({ item, pageVisible }: { readonly item: ToastRecord; readonly pageVisible: boolean }) {
  const [held, setHeld] = useState(false);
  const persistent = item.duration === "persistent";
  const duration = persistent ? 0 : (item.duration as number);
  const halted = held || !pageVisible || item.leaving || persistent;
  const remainingRef = useRef(duration);
  const revisionRef = useRef(item.revision);

  useEffect(() => {
    if (revisionRef.current !== item.revision) {
      revisionRef.current = item.revision;
      remainingRef.current = duration;
    }
    if (halted) return undefined;
    const startedAt = performance.now();
    const timer = window.setTimeout(() => toastApi.dismiss(item.id), Math.max(0, remainingRef.current));
    return () => {
      window.clearTimeout(timer);
      remainingRef.current -= performance.now() - startedAt;
    };
  }, [halted, item.id, item.revision, duration]);

  return (
    <li
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cx("pointer-events-auto relative w-full", item.leaving && "opacity-0 transition-opacity duration-fast")}
    >
      <LykoToast
        tone={item.tone}
        title={item.title}
        description={item.description}
        from={item.from ?? "LYKO"}
        time={clock(item.at)}
        onDismiss={() => toastApi.dismiss(item.id)}
        action={
          item.action
            ? {
                label: item.action.label,
                onClick: () => {
                  item.action?.onClick();
                  toastApi.dismiss(item.id);
                },
              }
            : undefined
        }
      />
    </li>
  );
}

const serverEmpty = (): readonly ToastRecord[] => [];

/** Renders the radio messages: bottom-right on desktop, above the bottom bar on phones. Polite for info, assertive for errors. */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, serverEmpty);
  const pageVisible = usePageVisible();
  const visible = items.slice(0, MAX_VISIBLE_TOASTS);
  const urgent = visible.filter((item) => item.tone === "error" || item.tone === "warning");
  const calm = visible.filter((item) => item.tone !== "error" && item.tone !== "warning");
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[90] flex flex-col items-end gap-2 md:inset-x-auto md:bottom-8 md:right-8 md:w-[420px]">
      <ol aria-live="assertive" aria-relevant="additions" className="flex w-full flex-col gap-2">
        {urgent.map((item) => (
          <ToastItem key={item.id} item={item} pageVisible={pageVisible} />
        ))}
      </ol>
      <ol aria-live="polite" aria-relevant="additions" className="flex w-full flex-col gap-2">
        {calm.map((item) => (
          <ToastItem key={item.id} item={item} pageVisible={pageVisible} />
        ))}
      </ol>
    </div>
  );
}
