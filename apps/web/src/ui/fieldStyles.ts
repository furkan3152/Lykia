import { cx } from "./cx";

/** The 2 px pixel-framed box around an input; the dashed sun focus outline follows focus-within. */
export function fieldBoxClasses(options: { readonly invalid?: boolean; readonly size?: "sm" | "md" | "lg"; readonly disabled?: boolean } = {}): string {
  return cx(
    "flex w-full min-w-0 items-center gap-2 bg-card px-3 px-frame-thin",
    options.size === "sm" ? "h-8 text-[13px]" : options.size === "lg" ? "h-12 text-base" : "h-10 text-sm",
    options.invalid
      ? "px-tone-down px-drop"
      : "focus-within:px-drop focus-within:outline-dashed focus-within:outline-4 focus-within:outline-offset-[8px] focus-within:outline-signal",
    options.disabled && "opacity-50",
  );
}
