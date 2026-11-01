/**
 * Theming. A project's brand (or a `theme` prop) becomes CSS variables on
 * the widget root, and every rule is scoped under `[data-lykia]` so the
 * widget never styles the host page and the host's global CSS rarely
 * reaches in. Pure functions: safe on the server.
 */
import type { ProjectBrand } from "@lykia/core";

export interface LykiaTheme {
  readonly primary: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly foreground: string;
  readonly muted: string;
  readonly border: string;
  readonly ok: string;
  readonly warn: string;
  readonly bad: string;
  readonly font: string;
  readonly mono: string;
  readonly radius: number;
  readonly scheme: "light" | "dark";
  readonly mosaic: boolean;
}

/** Lykia's Mosaic look, light. */
export const MOSAIC_LIGHT: LykiaTheme = Object.freeze({
  primary: "#1e8fa3",
  accent: "#d9a441",
  background: "#fbf5e6",
  surface: "#ffffff",
  foreground: "#13233a",
  muted: "#4a5a6e",
  border: "#e2d6bd",
  ok: "#3f7f45",
  warn: "#b7831f",
  bad: "#b9472e",
  font: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  radius: 12,
  scheme: "light",
  mosaic: true,
});

/** Lykia's Mosaic look, dark. */
export const MOSAIC_DARK: LykiaTheme = Object.freeze({
  ...MOSAIC_LIGHT,
  primary: "#3fb5c9",
  background: "#13233a",
  surface: "#1d3352",
  foreground: "#fbf5e6",
  muted: "#b9c3cf",
  border: "#2c4668",
  scheme: "dark",
});

export type ThemeInput = Partial<LykiaTheme>;

const HEX = /^#[0-9a-fA-F]{6}$/u;
const SAFE_FONT = /^[A-Za-z0-9 ,'"-]{1,160}$/u;

function hex(value: string | undefined, fallback: string): string {
  return value && HEX.test(value) ? value : fallback;
}

/** The theme for a brand: a light or dark Mosaic base with the brand's colours, font and radius on top. */
export function themeFromBrand(brand: ProjectBrand | undefined, prefersDark = false, overrides: ThemeInput = {}): LykiaTheme {
  const scheme = brand?.scheme === "dark" || (brand?.scheme !== "light" && prefersDark && brand?.scheme === "auto") ? "dark" : "light";
  const base = scheme === "dark" ? MOSAIC_DARK : MOSAIC_LIGHT;
  const c = brand?.colors ?? {};
  const merged: LykiaTheme = {
    ...base,
    primary: hex(c.primary, base.primary),
    accent: hex(c.accent, base.accent),
    background: hex(c.background, base.background),
    foreground: hex(c.foreground, base.foreground),
    font: brand?.font && SAFE_FONT.test(brand.font) ? brand.font : base.font,
    radius: typeof brand?.radius === "number" && brand.radius >= 0 && brand.radius <= 24 ? brand.radius : base.radius,
    mosaic: brand?.mosaic ?? base.mosaic,
  };
  return sanitizeTheme({ ...merged, ...overrides });
}

/** Drops unsafe values from a theme (colours must be hex, fonts plain). */
export function sanitizeTheme(theme: LykiaTheme): LykiaTheme {
  const base = theme.scheme === "dark" ? MOSAIC_DARK : MOSAIC_LIGHT;
  const out: Record<string, unknown> = { ...theme };
  for (const key of ["primary", "accent", "background", "surface", "foreground", "muted", "border", "ok", "warn", "bad"] as const) out[key] = hex(theme[key], base[key]);
  out.font = SAFE_FONT.test(theme.font) ? theme.font : base.font;
  out.mono = SAFE_FONT.test(theme.mono) ? theme.mono : base.mono;
  out.radius = Number.isFinite(theme.radius) ? Math.max(0, Math.min(24, Math.round(theme.radius))) : base.radius;
  return out as unknown as LykiaTheme;
}

/** CSS variables for the widget root (`style={themeVars(theme)}`). */
export function themeVars(theme: LykiaTheme): Record<string, string> {
  return {
    "--lykia-primary": theme.primary,
    "--lykia-accent": theme.accent,
    "--lykia-bg": theme.background,
    "--lykia-surface": theme.surface,
    "--lykia-fg": theme.foreground,
    "--lykia-muted": theme.muted,
    "--lykia-border": theme.border,
    "--lykia-ok": theme.ok,
    "--lykia-warn": theme.warn,
    "--lykia-bad": theme.bad,
    "--lykia-font": theme.font,
    "--lykia-mono": theme.mono,
    "--lykia-radius": `${theme.radius}px`,
  };
}

/**
 * The widget's stylesheet. Every selector starts with `[data-lykia]`, so it
 * only touches widget markup. Rendered once by LykiaProvider in a <style>
 * tag (works with SSR and streaming; no runtime CSS-in-JS).
 */
export const WIDGET_CSS = `
[data-lykia]{font-family:var(--lykia-font);color:var(--lykia-fg);background:var(--lykia-bg);border-radius:var(--lykia-radius);box-sizing:border-box;line-height:1.45;font-size:14px}
[data-lykia] *,[data-lykia] *::before,[data-lykia] *::after{box-sizing:inherit}
[data-lykia] h1,[data-lykia] h2,[data-lykia] h3,[data-lykia] p,[data-lykia] label,[data-lykia] li{font-family:var(--lykia-font);letter-spacing:normal;text-transform:none;margin:0}
[data-lykia][data-mosaic="true"]{background-image:linear-gradient(90deg,color-mix(in srgb,var(--lykia-border) 45%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--lykia-border) 45%,transparent) 1px,transparent 1px);background-size:18px 18px}
[data-lykia] .lk-card{background:var(--lykia-surface);border:1px solid var(--lykia-border);border-radius:var(--lykia-radius);padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}
[data-lykia] .lk-title{font-weight:650;font-size:15px;margin:0;display:flex;align-items:center;gap:8px}
[data-lykia] .lk-muted{color:var(--lykia-muted);font-size:13px}
[data-lykia] .lk-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
[data-lykia] .lk-field{display:flex;flex-direction:column;gap:4px;flex:1 1 140px;min-width:0}
[data-lykia] .lk-field>span{font-size:12px;color:var(--lykia-muted)}
[data-lykia] input,[data-lykia] select,[data-lykia] textarea{font:inherit;color:var(--lykia-fg);background:var(--lykia-bg);border:1px solid var(--lykia-border);border-radius:calc(var(--lykia-radius) * .66);padding:9px 10px;width:100%;min-width:0}
[data-lykia] input:focus-visible,[data-lykia] select:focus-visible,[data-lykia] textarea:focus-visible,[data-lykia] button:focus-visible{outline:2px solid var(--lykia-primary);outline-offset:2px}
[data-lykia] .lk-btn{font:inherit;font-weight:600;border:0;border-radius:calc(var(--lykia-radius) * .66);padding:10px 14px;background:var(--lykia-primary);color:#fff;cursor:pointer;min-height:40px}
[data-lykia] .lk-btn[disabled]{opacity:.55;cursor:not-allowed}
[data-lykia] .lk-btn.lk-ghost{background:transparent;color:var(--lykia-fg);border:1px solid var(--lykia-border)}
[data-lykia] .lk-pill{display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--lykia-border)}
[data-lykia] .lk-allow{color:var(--lykia-ok)}
[data-lykia] .lk-confirm{color:var(--lykia-warn)}
[data-lykia] .lk-deny{color:var(--lykia-bad)}
[data-lykia] .lk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
[data-lykia] .lk-list li{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;overflow-wrap:anywhere}
[data-lykia] .lk-mono{font-family:var(--lykia-mono);font-size:12px;overflow-wrap:anywhere}
[data-lykia] .lk-chat{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto}
[data-lykia] .lk-msg{padding:8px 10px;border-radius:calc(var(--lykia-radius) * .66);max-width:85%;overflow-wrap:anywhere;white-space:pre-wrap}
[data-lykia] .lk-msg.lk-user{align-self:flex-end;background:var(--lykia-primary);color:#fff}
[data-lykia] .lk-msg.lk-assistant{align-self:flex-start;background:var(--lykia-bg);border:1px solid var(--lykia-border)}
[data-lykia] .lk-avatar{width:24px;height:24px;border-radius:50%;object-fit:cover}
[data-lykia] .lk-error{color:var(--lykia-bad);font-size:13px}
[data-lykia] svg.lk-outrun{width:100%;height:auto;display:block}
`;
