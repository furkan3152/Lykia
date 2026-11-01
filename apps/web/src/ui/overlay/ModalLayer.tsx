import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { cx } from "../cx";
import { focusableWithin, lockScroll, trapTab } from "./focus";

export interface ModalLayerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly labelledBy?: string;
  readonly describedBy?: string;
  readonly ariaLabel?: string;
  /** Focused when the layer opens; defaults to the first focusable element. */
  readonly initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Overlay layout: centred dialog, right sheet or bottom sheet. */
  readonly placement: "center" | "right" | "bottom" | "top";
  readonly panelClassName?: string;
  /** Close when the backdrop is clicked (default true). */
  readonly dismissOnBackdrop?: boolean;
  readonly children: React.ReactNode;
}

const PLACEMENT: Readonly<Record<ModalLayerProps["placement"], string>> = {
  center: "items-end justify-center p-0 sm:items-center sm:p-6",
  top: "items-start justify-center p-3 pt-[10vh] sm:p-6 sm:pt-[12vh]",
  right: "items-stretch justify-end",
  bottom: "items-end justify-stretch",
};

/**
 * The accessible modal mechanics shared by Dialog, Sheet and the Oracle:
 * portal to <body>, aria-modal, focus moved in and trapped, Esc and backdrop
 * close, scroll lock, and focus restored to the opener on close.
 */
export function ModalLayer({
  open,
  onClose,
  labelledBy,
  describedBy,
  ariaLabel,
  initialFocusRef,
  placement,
  panelClassName,
  dismissOnBackdrop = true,
  children,
}: ModalLayerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = lockScroll();
    const panel = panelRef.current;
    const target = initialFocusRef?.current ?? (panel ? focusableWithin(panel)[0] : undefined) ?? panel;
    target?.focus({ preventScroll: true });
    return () => {
      release();
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, initialFocusRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cx("fixed inset-0 z-[80] flex", PLACEMENT[placement])}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCloseRef.current();
          return;
        }
        if (panelRef.current && trapTab(event, panelRef.current)) event.preventDefault();
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-fade-in bg-[var(--overlay)]"
        onMouseDown={(event) => {
          if (dismissOnBackdrop && event.target === event.currentTarget) onCloseRef.current();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cx("relative outline-none", panelClassName)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
