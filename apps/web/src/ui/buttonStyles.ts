import { cx, FOCUS_RING } from "./cx";

/**
 * Pixel Survey button variants, style A ("game button", src/styles/pixel.css
 * `.px-btn`): a flat fill with 4 px stepped corners and a 4 px inner bevel
 * (light top-left, dark bottom-right). No ink outline, no block shadow.
 * Hover brightens, pressing inverts the bevel and drops the label 2 px,
 * disabled is flat. Labels are Pixelify Sans.
 * - primary: THE action of a view. Glacier bevel.
 * - signpost: sun-yellow wayfinding ("go there" links, suggestions).
 * - ink: paper stock (the secondary action).
 * - solid-ink: a dark bevel with paper text (strong neutral, selected).
 * - danger: rope-red bevel; destructive or risky.
 * - ghost: no frame (toolbars, dense rows).
 * - long / short: trade sides (up / down fills).
 * Legacy names map onto these: violet/gold -> primary, soft/outline -> ink.
 */
export type ButtonVariant =
  | "primary"
  | "signpost"
  | "ink"
  | "solid-ink"
  | "danger"
  | "ghost"
  | "long"
  | "short"
  // legacy aliases
  | "violet"
  | "gold"
  | "soft"
  | "outline";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

const BASE =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-display font-bold tracking-[0.02em] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

const BEVEL = "px-btn";

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: cx(BEVEL, "px-btn-accent text-accent-ink"),
  violet: cx(BEVEL, "px-btn-accent text-accent-ink"),
  gold: cx(BEVEL, "px-btn-accent text-accent-ink"),
  signpost: cx(BEVEL, "px-btn-signal text-signal-ink"),
  ink: cx(BEVEL, "px-btn-paper text-ink"),
  soft: cx(BEVEL, "px-btn-paper text-ink"),
  outline: cx(BEVEL, "px-btn-paper text-ink"),
  "solid-ink": cx(BEVEL, "px-btn-ink text-paper"),
  danger: cx(BEVEL, "px-btn-down text-card"),
  ghost: "bg-transparent text-ink-2 transition-colors duration-fast hover:bg-paper-2 hover:text-ink",
  long: cx(BEVEL, "px-btn-up text-card"),
  short: cx(BEVEL, "px-btn-down text-card"),
};

/** xs keeps a 2 px bevel so dense rows stay readable. */
const THIN: Readonly<Record<ButtonSize, boolean>> = { xs: true, sm: false, md: false, lg: false, xl: false };

const SIZES: Readonly<Record<ButtonSize, string>> = {
  xs: "h-7 px-2.5 text-[13px]",
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-[15px]",
  lg: "h-12 px-5 text-[17px]",
  xl: "h-14 px-6 text-lg",
};

const ICON_SIZES: Readonly<Record<ButtonSize, string>> = {
  xs: "h-7 w-7",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-14 w-14",
};

export interface ButtonStyleOptions {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly iconOnly?: boolean;
  readonly className?: string;
}

/** Class recipe shared by Button, ButtonLink and anything that must look like a button. */
export function buttonClasses({ variant = "primary", size = "md", fullWidth, iconOnly, className }: ButtonStyleOptions = {}): string {
  return cx(BASE, FOCUS_RING, VARIANTS[variant], THIN[size] && variant !== "ghost" && "px-btn-thin", iconOnly ? cx(ICON_SIZES[size], "px-0") : SIZES[size], fullWidth && "w-full", className);
}
