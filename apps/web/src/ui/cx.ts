/** Joins class names, skipping falsy values. Variants come from props; `className` is for layout (margin, width, grid). */
export function cx(...parts: ReadonlyArray<string | false | null | undefined | 0>): string {
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    out = out ? `${out} ${part}` : part;
  }
  return out;
}

/** Focus ring for custom controls: a dashed sun outline, clear of the 4 px pixel frame. */
export const FOCUS_RING = "focus-visible:outline-dashed focus-visible:outline-4 focus-visible:outline-offset-[6px] focus-visible:outline-signal";
