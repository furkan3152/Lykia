/**
 * Pixel Survey. Tailwind maps every colour to a CSS custom property from src/styles/tokens.css,
 * so one class follows both sheets (DAY paper map, NIGHT headlamp). The palette
 * is replaced, not extended: only Survey tokens exist. Channel variables
 * (`--ink: 22 32 27`) allow alpha modifiers such as `border-ink/20`.
 *
 * The "Lumine" names below the Survey ones (bg-*, text-*, violet, gold, mint,
 * rose, sky, line) are aliases onto Survey tokens for pages not rebuilt yet.
 * New code uses the Survey names.
 */
const channel = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      white: "#FFFFFF",
      black: "#000000",

      // Survey
      paper: { DEFAULT: channel("paper"), 2: channel("paper-2"), 3: channel("paper-3") },
      card: channel("card"),
      ink: {
        DEFAULT: channel("ink"),
        2: channel("ink-2"),
        3: channel("ink-3"),
        // legacy "on colour" inks
        gold: channel("on-gold"),
        violet: channel("on-violet"),
        mint: channel("on-mint"),
        rose: channel("on-rose"),
      },
      rule: { DEFAULT: channel("rule"), strong: channel("rule-strong") },
      contour: channel("contour"),
      signal: { DEFAULT: channel("signal"), ink: channel("on-signal") },
      accent: { DEFAULT: channel("accent"), line: channel("accent-line"), ink: channel("on-accent") },
      floor: channel("floor"),
      ridge: channel("ridge"),
      summit: { DEFAULT: channel("summit"), ink: channel("summit-ink") },
      up: channel("up"),
      down: channel("down"),
      "blaze-red": channel("blaze-red"),
      "blaze-blue": channel("blaze-blue"),
      water: channel("water"),
      warn: { DEFAULT: channel("warn"), ink: channel("warn-ink"), on: channel("on-warn") },

      // Legacy aliases
      "bg-0": channel("bg-0"),
      "bg-1": channel("bg-1"),
      "bg-2": channel("bg-2"),
      "bg-3": channel("bg-3"),
      line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
      "text-0": channel("text-0"),
      "text-1": channel("text-1"),
      "text-2": channel("text-2"),
      violet: { DEFAULT: channel("violet"), glow: channel("violet-glow"), soft: channel("violet-soft"), fill: channel("violet-fill") },
      gold: { DEFAULT: channel("gold"), deep: channel("gold-deep"), fill: channel("gold-fill") },
      mint: { DEFAULT: channel("mint"), fill: channel("mint-fill") },
      rose: { DEFAULT: channel("rose"), fill: channel("rose-fill") },
      sky: { DEFAULT: channel("sky") },
    },
    fontFamily: {
      // IBM Plex Mono: body and data (every number is tabular).
      sans: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      // Pixelify Sans: headings and big numbers.
      display: ['"Lykia Tilde"', '"Pixelify Sans"', '"Courier New"', "monospace"],
      pixel: ['"Lykia Tilde"', '"Pixelify Sans"', '"Courier New"', "monospace"],
      // Silkscreen: tags, labels, nav.
      tag: ["Silkscreen", '"Courier New"', "monospace"],
      // legacy names
      sign: ['"Lykia Tilde"', '"Pixelify Sans"', '"Courier New"', "monospace"],
      map: ["Silkscreen", '"Courier New"', "monospace"],
      numeral: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
    },
    // Pixel art has no rounded corners: every radius is 0 (frames step instead).
    borderRadius: {
      none: "0",
      sm: "0",
      DEFAULT: "0",
      md: "0",
      lg: "0",
      xl: "0",
      "2xl": "0",
      "3xl": "0",
      full: "0",
    },
    extend: {
      fontSize: {
        // 12 px floor for anything a person must read.
        micro: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.08em" }],
        "display-xl": ["clamp(2.75rem, 7vw, 5.25rem)", { lineHeight: "1", letterSpacing: "0.01em", fontWeight: "700" }],
        "display-lg": ["clamp(2rem, 4.6vw, 3.25rem)", { lineHeight: "1.05", letterSpacing: "0.01em", fontWeight: "700" }],
        "display-md": ["clamp(1.75rem, 3.4vw, 2.5rem)", { lineHeight: "1.08", letterSpacing: "0.01em", fontWeight: "700" }],
        "display-sm": ["clamp(1.5rem, 2.4vw, 1.875rem)", { lineHeight: "1.1", letterSpacing: "0.01em", fontWeight: "700" }],
      },
      borderWidth: {
        DEFAULT: "1px",
        1.5: "2px",
        2: "2px",
        3: "4px",
        4: "4px",
      },
      boxShadow: {
        // Style A: no black block drops. "hard" names are a 2 px tone outline
        // plus a translucent depth band inside the bottom edge. No blur, ever.
        hard: "var(--shadow-hard)",
        "hard-sm": "0 0 0 2px rgb(var(--rule))",
        "hard-lg": "var(--shadow-hard-lg)",
        "hard-xl": "var(--shadow-hard-xl)",
        none: "none",
        // legacy names
        panel: "var(--shadow-hard)",
        raised: "var(--shadow-hard-lg)",
        "glow-violet": "var(--shadow-hard)",
        "glow-gold": "0 0 0 2px rgb(var(--signal))",
        sm: "0 0 0 2px rgb(var(--rule))",
        focus: "0 0 0 2px rgb(var(--paper)), 0 0 0 4px rgb(var(--signal))",
      },
      // Pixel things move in steps.
      transitionTimingFunction: {
        draw: "steps(6, end)",
        spring: "steps(4, end)",
        out: "steps(5, end)",
        standard: "steps(3, end)",
        pluck: "steps(4, end)",
      },
      transitionDuration: {
        instant: "90ms",
        fast: "120ms",
        base: "240ms",
        slow: "420ms",
        draw: "1200ms",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        heartbeat: {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(1.35)" },
          "100%": { transform: "scale(1)" },
        },
        "flash-up": {
          "0%": { color: "rgb(var(--up))" },
          "100%": { color: "inherit" },
        },
        "flash-down": {
          "0%": { color: "rgb(var(--down))" },
          "100%": { color: "inherit" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translate3d(0, 8px, 0)" },
          "100%": { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "sheet-in-right": {
          "0%": { transform: "translate3d(100%, 0, 0)" },
          "100%": { transform: "translate3d(0, 0, 0)" },
        },
        "sheet-in-bottom": {
          "0%": { transform: "translate3d(0, 100%, 0)" },
          "100%": { transform: "translate3d(0, 0, 0)" },
        },
        "dialog-in": {
          "0%": { opacity: "0", transform: "translate3d(0, 10px, 0)" },
          "100%": { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
        caret: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
        "pending-bar": {
          "0%": { transform: "scaleX(0)" },
          "60%": { transform: "scaleX(0.7)" },
          "100%": { transform: "scaleX(0.92)" },
        },
        // legacy loops, slowed and made quiet
        "aurora-a": { "0%, 100%": { opacity: "1" } },
        "aurora-b": { "0%, 100%": { opacity: "1" } },
        shimmer: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        twinkle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
      animation: {
        breathe: "breathe 4s ease-in-out infinite",
        heartbeat: "heartbeat 900ms cubic-bezier(.16,1,.3,1) 1",
        "flash-up": "flash-up 900ms ease-out 1",
        "flash-down": "flash-down 900ms ease-out 1",
        "rise-in": "rise-in 240ms steps(3, end) both",
        "fade-in": "fade-in 240ms ease-out both",
        "sheet-in-right": "sheet-in-right 240ms steps(5, end) both",
        "sheet-in-bottom": "sheet-in-bottom 240ms steps(5, end) both",
        "dialog-in": "dialog-in 200ms steps(3, end) both",
        caret: "caret 1.1s steps(1) infinite",
        "pending-bar": "pending-bar 2.4s cubic-bezier(.16,1,.3,1) forwards",
        "aurora-a": "aurora-a 1s linear 1",
        "aurora-b": "aurora-b 1s linear 1",
        shimmer: "shimmer 2.4s ease-in-out infinite",
        twinkle: "twinkle 3.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
