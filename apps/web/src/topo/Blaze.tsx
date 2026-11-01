import { useMemo } from "react";

import { blazeGlyph } from "../pixel/glyphs";
import { PixelGlyph } from "../pixel/PixelGlyph";
import { cx } from "../ui/cx";
import { blazeFor, GRADE_NAME, type Grade } from "./geometry/conditions";

export interface BlazeProps {
  readonly grade: Grade;
  /** px height (rounded to whole pixels of the 9-pixel glyph). */
  readonly size?: number;
  /** Show "T3" after the mark. */
  readonly showGrade?: boolean;
  /** Accessible name; by default "Grade T3, mountain trail". Pass null when adjacent text says it. */
  readonly label?: string | null;
  readonly className?: string;
}

/*
 * Painted trail blazes in pixels: a yellow diamond for T1-T2 (hiking),
 * white-red-white for T3-T4 (mountain), white-blue-white for T5-T6 (alpine).
 * Paint colours are fixed: a blaze is painted on rock, not printed in the sheet's ink.
 */
export function Blaze({ grade, size = 16, showGrade = false, label, className }: BlazeProps) {
  const kind = blazeFor(grade);
  const name = label === undefined ? `Grade T${grade}, ${GRADE_NAME[kind].toLowerCase()}` : label;
  const rows = useMemo(() => blazeGlyph(kind), [kind]);
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 align-middle", className)} {...(name ? { role: "img", "aria-label": name } : { "aria-hidden": true })}>
      <PixelGlyph rows={rows} scale={Math.max(1, Math.round(size / 9))} label={null} />
      {showGrade ? <span className="tnum font-tag text-[11px]">T{grade}</span> : null}
    </span>
  );
}
