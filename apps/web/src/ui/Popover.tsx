import React, { useEffect, useId, useRef, useState } from "react";

import { cx } from "./cx";

export interface PopoverTriggerProps {
  readonly "aria-expanded": boolean;
  readonly "aria-controls": string;
  readonly "aria-haspopup": "dialog";
  readonly onClick: () => void;
}

export interface PopoverProps {
  /** Renders the trigger; spread the props onto a button. */
  readonly trigger: (props: PopoverTriggerProps) => React.ReactNode;
  readonly children: (close: () => void) => React.ReactNode;
  readonly align?: "start" | "end";
  readonly label: string;
  readonly className?: string;
}

/** Small non-modal panel anchored to a trigger (mode switch, quick settings). Esc and outside clicks close it. */
export function Popover({ trigger, children, align = "end", label, className }: PopoverProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      {trigger({ "aria-expanded": open, "aria-controls": id, "aria-haspopup": "dialog", onClick: () => setOpen((value) => !value) })}
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          className={cx(
            "absolute top-full z-[75] mt-3 min-w-[240px] animate-dialog-in bg-card p-3 px-frame px-drop",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
