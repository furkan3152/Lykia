import { X } from "lucide-react";
import React, { useId } from "react";

import { cx } from "./cx";
import { IconButton } from "./IconButton";
import { ModalLayer } from "./overlay/ModalLayer";

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Buttons row, right-aligned (primary action last). */
  readonly footer?: React.ReactNode;
  readonly size?: "sm" | "md" | "lg";
  readonly initialFocusRef?: React.RefObject<HTMLElement | null>;
  readonly children?: React.ReactNode;
}

const SIZES = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" } as const;

/** Modal dialog (a card laid on the map): focus trapped, Esc and backdrop close, focus returns to the opener. Bottom sheet on phones. */
export function Dialog({ open, onClose, title, description, footer, size = "md", initialFocusRef, children }: DialogProps) {
  const id = useId();
  return (
    <ModalLayer
      open={open}
      onClose={onClose}
      labelledBy={`${id}-title`}
      describedBy={description ? `${id}-desc` : undefined}
      initialFocusRef={initialFocusRef}
      placement="center"
      panelClassName={cx(
        "flex max-h-[calc(92dvh-24px)] w-full animate-dialog-in flex-col bg-card px-frame px-drop-lg",
        SIZES[size],
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b-2 border-rule px-5 pb-3.5 pt-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-display text-[24px] font-bold leading-tight text-ink">
            {title}
          </h2>
          {description ? (
            <p id={`${id}-desc`} className="mt-1 text-sm text-ink-2">
              {description}
            </p>
          ) : null}
        </div>
        <IconButton label="Close" icon={<X className="h-4 w-4" aria-hidden="true" />} size="sm" variant="ink" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      {footer ? <div className="safe-bottom flex flex-wrap justify-end gap-2.5 border-t-2 border-dashed border-rule bg-paper-2/50 px-5 py-4 sm:px-6">{footer}</div> : null}
    </ModalLayer>
  );
}
