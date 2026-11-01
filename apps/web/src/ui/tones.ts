/**
 * Colour tones shared by badges, chips, stats and visuals. The Survey tones
 * are `accent` (glacier), `signal` (yellow highlight), `up`, `down`, `warn`,
 * `water` and `neutral`; the legacy names map onto them (violet -> accent,
 * gold -> signal, mint -> up, rose -> down, sky -> water).
 */
export type Tone =
  | "violet"
  | "gold"
  | "mint"
  | "rose"
  | "sky"
  | "neutral"
  | "accent"
  | "signal"
  | "up"
  | "down"
  | "warn"
  | "water"
  | "floor"
  | "ridge"
  | "summit";

type ToneMap = Readonly<Record<Tone, string>>;

const accentSoft = "border-summit/60 bg-summit/[0.1] text-summit-ink";
const signalSoft = "border-rule bg-signal/40 text-ink";
const upSoft = "border-up/55 bg-up/[0.1] text-up";
const downSoft = "border-down/55 bg-down/[0.08] text-down";
const waterSoft = "border-water/55 bg-water/[0.08] text-water";
const warnSoft = "border-warn/70 bg-warn/[0.14] text-warn-ink";
const neutralSoft = "border-rule bg-paper-2/70 text-ink-2";

/** Soft fill + border + text. */
export const SOFT_TONE: ToneMap = {
  violet: accentSoft,
  accent: accentSoft,
  gold: signalSoft,
  signal: signalSoft,
  mint: upSoft,
  up: upSoft,
  rose: downSoft,
  down: downSoft,
  sky: waterSoft,
  water: waterSoft,
  warn: warnSoft,
  neutral: neutralSoft,
  floor: "border-floor/60 bg-floor/[0.08] text-floor",
  ridge: "border-ridge/60 bg-ridge/[0.08] text-ridge",
  summit: accentSoft,
};

export const OUTLINE_TONE: ToneMap = {
  violet: "border-summit text-summit-ink",
  accent: "border-summit text-summit-ink",
  gold: "border-rule text-ink",
  signal: "border-rule text-ink",
  mint: "border-up text-up",
  up: "border-up text-up",
  rose: "border-down text-down",
  down: "border-down text-down",
  sky: "border-water text-water",
  water: "border-water text-water",
  warn: "border-warn text-warn-ink",
  neutral: "border-rule text-ink",
  floor: "border-floor text-floor",
  ridge: "border-ridge text-ridge",
  summit: "border-summit text-summit-ink",
};

export const SOLID_TONE: ToneMap = {
  violet: "border-rule bg-accent text-accent-ink",
  accent: "border-rule bg-accent text-accent-ink",
  gold: "border-rule bg-signal text-signal-ink",
  signal: "border-rule bg-signal text-signal-ink",
  mint: "border-rule bg-up text-card",
  up: "border-rule bg-up text-card",
  rose: "border-rule bg-down text-card",
  down: "border-rule bg-down text-card",
  sky: "border-rule bg-water text-card",
  water: "border-rule bg-water text-card",
  warn: "border-rule bg-warn text-warn-on",
  neutral: "border-rule bg-ink-2 text-paper",
  floor: "border-rule bg-floor text-card",
  ridge: "border-rule bg-ridge text-card",
  summit: "border-rule bg-summit-ink text-card",
};

export const DOT_TONE: ToneMap = {
  violet: "bg-summit",
  accent: "bg-summit",
  gold: "bg-signal",
  signal: "bg-signal",
  mint: "bg-up",
  up: "bg-up",
  rose: "bg-down",
  down: "bg-down",
  sky: "bg-water",
  water: "bg-water",
  warn: "bg-warn",
  neutral: "bg-ink-3",
  floor: "bg-floor",
  ridge: "bg-ridge",
  summit: "bg-summit",
};

export const TEXT_TONE: ToneMap = {
  violet: "text-summit-ink",
  accent: "text-summit-ink",
  gold: "text-warn-ink",
  signal: "text-ink",
  mint: "text-up",
  up: "text-up",
  rose: "text-down",
  down: "text-down",
  sky: "text-water",
  water: "text-water",
  warn: "text-warn-ink",
  neutral: "text-ink-2",
  floor: "text-floor",
  ridge: "text-ridge",
  summit: "text-summit-ink",
};

/** Mint for positive, rose for negative, neutral for zero or unknown. */
export function signTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "mint" : "rose";
}
