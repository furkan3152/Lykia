import React from "react";

import { cssVars } from "../motion/tokens";
import { cx } from "../ui/cx";

export type PixelStampState = "settled" | "signed" | "queued" | "refused";

export interface PixelStampProps {
  readonly state?: PixelStampState;
  /** Overrides the word ("KANITLANDI", "PROVEN"). */
  readonly text?: string;
  /** Small second line: layer, block, time ("FLOOR · #41,077,288 · 14:02:11"). */
  readonly detail?: React.ReactNode;
  readonly size?: "sm" | "md" | "lg";
  /** Thump down once (only on a real change; key it with useChangeKey). */
  readonly animate?: boolean;
  readonly delayMs?: number;
  /** Degrees (default -6; refused stamps tilt the other way). */
  readonly rotate?: number;
  /** Accessible name; default "<word> stamp". Pass null when nearby text says it. */
  readonly label?: string | null;
  readonly className?: string;
}

const STAMP: Readonly<Record<PixelStampState, { readonly word: string; readonly color: string; readonly mark: string }>> = {
  settled: { word: "SETTLED", color: "rgb(var(--down))", mark: "✓" },
  signed: { word: "SIGNED", color: "rgb(var(--up))", mark: "✎" },
  queued: { word: "SIGNATURE QUEUED", color: "rgb(var(--accent))", mark: "…" },
  refused: { word: "REFUSED", color: "rgb(var(--ink-2))", mark: "✕" },
};

const SIZE = { sm: "px-1.5 py-0.5 text-[11px]", md: "px-2.5 py-1 text-[13px]", lg: "px-4 py-2 text-lg" } as const;

/**
 * A pixel rubber stamp: Silkscreen caps in a 2 px stepped frame of the
 * stamp's ink, tilted. With `animate` it thumps down once in four steps
 * (reduced motion: it is simply there).
 */
export function PixelStamp({ state = "settled", text, detail, size = "md", animate = false, delayMs = 0, rotate, label, className }: PixelStampProps) {
  const meta = STAMP[state];
  const word = text ?? meta.word;
  return (
    <span
      role={label === null ? undefined : "img"}
      aria-label={label === null ? undefined : (label ?? `${word} stamp${typeof detail === "string" ? `, ${detail}` : ""}`)}
      aria-hidden={label === null ? true : undefined}
      data-go={animate ? "true" : undefined}
      className={cx("px-stamp px-frame inline-flex flex-col items-center whitespace-nowrap font-tag uppercase leading-tight", SIZE[size], className)}
      style={cssVars({ "--stamp-c": meta.color, "--stamp-rot": `${rotate ?? (state === "refused" ? 5 : -6)}deg`, "--el-delay": `${delayMs}ms` })}
    >
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true">{meta.mark}</span>
        {word}
      </span>
      {detail ? <span className="text-[11px] opacity-90">{detail}</span> : null}
    </span>
  );
}
