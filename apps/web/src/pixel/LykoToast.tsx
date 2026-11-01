import { X } from "lucide-react";
import React from "react";

import { cx, FOCUS_RING } from "../ui/cx";
import { Lyko } from "./Lyko";
import type { LykoMood } from "@lykia/core";

export type LykoToastTone = "info" | "success" | "error" | "warning";

export interface LykoToastProps {
  readonly tone?: LykoToastTone;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Call sign of the sender ("LYKO", "FENCE"); default "LYKO". */
  readonly from?: string;
  /** "14:02:11". */
  readonly time?: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
  readonly onDismiss?: () => void;
  /** Pop up from the bottom (default true; reduced motion shows it in place). */
  readonly pop?: boolean;
  readonly className?: string;
}

const TONE: Readonly<Record<LykoToastTone, { readonly mood: LykoMood; readonly mark: string; readonly label: string; readonly tone: string }>> = {
  success: { mood: "proud", mark: "▲", label: "Done", tone: "text-up" },
  error: { mood: "growling", mark: "✕", label: "Alert", tone: "text-down" },
  warning: { mood: "alert", mark: "!", label: "Caution", tone: "text-warn-ink" },
  info: { mood: "watching", mark: "●", label: "Note", tone: "text-summit-ink" },
};

/**
 * A note from Lyko, who pops up beside it: he watches
 * for notes, is proud on success, alert on warnings and growls at errors.
 * The text carries the meaning; Lyko only says it twice.
 */
export function LykoToast({ tone = "info", title, description, from = "LYKO", time, action, onDismiss, pop = true, className }: LykoToastProps) {
  const meta = TONE[tone];
  return (
    <div className={cx("relative flex w-full items-end gap-3", pop && "px-pop", className)}>
      <Lyko mood={meta.mood} size={62} label={null} className="-mb-1 shrink-0" />
      <div className="min-w-0 flex-1 bg-card px-frame px-drop">
        <div className="flex items-center gap-2 border-b-2 border-dashed border-rule px-3 py-1.5 font-tag text-[11px] uppercase text-ink-2">
          <span aria-hidden="true" className={meta.tone}>
            {meta.mark}
          </span>
          {time ? <span className="tnum">{time}</span> : null}
          {time ? <span aria-hidden="true">·</span> : null}
          <span className="text-ink">{from}</span>
          <span aria-hidden="true">→ YOU</span>
          {onDismiss ? (
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={onDismiss}
              className={cx("-mr-1 ml-auto inline-flex h-6 w-6 items-center justify-center text-ink-3 hover:bg-paper-2 hover:text-ink", FOCUS_RING)}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="px-3 pb-3 pt-2">
          <p className="font-display text-[17px] font-bold leading-snug text-ink">
            <span className="sr-only">{meta.label}: </span>
            {title}
          </p>
          {description ? <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{description}</p> : null}
          {action ? (
            <button
              type="button"
              onClick={action.onClick}
              className={cx("mt-2 font-tag text-xs uppercase text-summit-ink underline decoration-2 underline-offset-4 hover:text-ink", FOCUS_RING)}
            >
              {action.label} →
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
