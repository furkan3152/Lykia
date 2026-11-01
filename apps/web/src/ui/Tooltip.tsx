import React, { useEffect, useId, useState } from "react";

import { cx } from "./cx";

export interface TooltipProps {
  readonly content: React.ReactNode;
  /** One focusable element (button, link); it gets aria-describedby. */
  readonly children: React.ReactElement<{ "aria-describedby"?: string }>;
  readonly side?: "top" | "bottom";
  readonly align?: "center" | "start" | "end";
  /** Delay before showing on hover (focus shows at once). */
  readonly delayMs?: number;
  readonly className?: string;
}

const ALIGN = {
  center: "left-1/2 -translate-x-1/2",
  start: "left-0",
  end: "right-0",
} as const;

/**
 * Hover/focus hint. Supplementary only: never the sole place for information
 * a person needs to act (touch devices rarely see it).
 */
export function Tooltip({ content, children, side = "top", align = "center", delayMs = 250, className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    if (!hovering) return undefined;
    const timer = window.setTimeout(() => setOpen(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [hovering, delayMs]);

  const describedBy = [children.props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <span
      className={cx("relative inline-flex", className)}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => {
        setHovering(false);
        setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {React.cloneElement(children, { "aria-describedby": describedBy })}
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cx(
            "pointer-events-none absolute z-[70] w-max max-w-[260px] animate-fade-in bg-card px-2.5 py-1.5 font-mono text-xs leading-snug text-ink px-frame-thin",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            ALIGN[align],
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
