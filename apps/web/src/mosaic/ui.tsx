/**
 * The Mosaic components. Every surface uses these, so a card, a scene and a
 * toast are always laid from the same stones.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import { useReducedMotion } from "../motion/useReducedMotion";
import { cx } from "./cx";
import { useLook, useLookVersion } from "./look";
import { MosaicCanvas } from "./MosaicCanvas";
import { face, sprite } from "./scenes";
import { buffer, drawTesserae } from "./tessera";
import { COLLARS, LEASH, PAL, PUP, lykoFace, type FaceMood } from "./sprites";


/* ----------------------------------------------------------- frames */

export function Frame({ tone = "terra", thin, className, children, as: As = "div", ...rest }: { tone?: "terra" | "sea" | "night"; thin?: boolean; className?: string; children?: React.ReactNode; as?: "div" | "section" | "article" | "aside" | "form" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cx("m-frame", tone === "sea" && "m-frame--sea", tone === "night" && "m-frame--night", thin && "m-frame--thin", className)} {...rest}>
      {children}
    </As>
  );
}

export function Card({ title, kicker, tone, children, className, footer, ...rest }: { title?: React.ReactNode; kicker?: React.ReactNode; tone?: "terra" | "sea" | "night"; children?: React.ReactNode; className?: string; footer?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Frame tone={tone} className={cx("m-card", className)} {...rest}>
      {title || kicker ? (
        <header className="m-card__head">
          {title ? <h3>{title}</h3> : null}
          {kicker ? <p className="m-kick">{kicker}</p> : null}
        </header>
      ) : null}
      {children}
      {footer ? <div className="mt-4 flex justify-center gap-2 flex-wrap">{footer}</div> : null}
    </Frame>
  );
}

export function MeanderBand({ wave, flow, thin, className }: { wave?: boolean; flow?: boolean; thin?: boolean; className?: string }) {
  return <div aria-hidden="true" className={cx("m-band", wave && "m-band--wave", flow && "m-band--flow", thin && "m-band--thin", className)} />;
}

/* ----------------------------------------------------------- type */

export function PageHead({ kicker, title, sub, medal = true, mood = "watching", children }: { kicker: string; title: React.ReactNode; sub?: React.ReactNode; medal?: boolean; mood?: FaceMood; children?: React.ReactNode }) {
  return (
    <header className="m-head m-wrap">
      {medal ? <Medallion size={88} mood={mood} /> : null}
      <div>
        <span className="m-kick">{kicker}</span>
      </div>
      <h1 className="m-title">{title}</h1>
      {sub ? <p className="m-sub">{sub}</p> : null}
      {children}
    </header>
  );
}

/* ----------------------------------------------------------- buttons */

type ButtonTone = "terra" | "sea" | "navy" | "ochre" | "ghost";

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; size?: "sm" | "md" | "lg" }>(function Button({ tone = "terra", size = "md", className, type = "button", ...rest }, ref) {
  return <button ref={ref} type={type} className={cx("m-btn", tone !== "terra" && `m-btn--${tone}`, size !== "md" && `m-btn--${size}`, className)} {...rest} />;
});

export function Tag({ tone, children, className, style }: { tone?: "ochre" | "ok" | "bad" | "sea" | "ghost" | "wolf"; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={cx("m-tag", tone && `m-tag--${tone}`, className)} style={style}>
      {children}
    </span>
  );
}

export function Seal({ decision, stamp = true, children }: { decision: "allow" | "confirm" | "deny"; stamp?: boolean; children?: React.ReactNode }) {
  return <span className={cx("m-seal", decision !== "allow" && `m-seal--${decision}`, stamp && "m-seal--stamp")}>{children ?? `FENCE · ${decision.toUpperCase()}`}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="m-stat">
      <div className="m-stat__v num">{value}</div>
      <div className="m-stat__l">{label}</div>
      {hint ? <div className="m-small m-muted mt-1">{hint}</div> : null}
    </div>
  );
}

export function Skeleton({ h = 14, w = "100%", className }: { h?: number; w?: number | string; className?: string }) {
  return <div aria-hidden="true" className={cx("m-skel", className)} style={{ height: h, width: w }} />;
}

/* ----------------------------------------------------------- forms */

export function Field({ label, hint, error, children }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  return (
    <label className={cx("m-field", error && "m-field--bad")}>
      <span>{label}</span>
      {children}
      {error ? <small style={{ color: "var(--bad)" }}>{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx("m-input", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("m-select", className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle<T extends string>({ value, options, onChange, light, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; light?: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} className={cx("m-toggle", light && "m-toggle--light")}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: readonly { id: T; label: string }[]; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="m-tabs">
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={t.id === value} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- sprites */

/** A static sprite painted as plain pixels (no grout) at `scale`. */
export function Sprite({ rows, palette = PAL, scale = 3, flip, label, className, style }: { rows: readonly string[]; palette?: Readonly<Record<string, string>>; scale?: number; flip?: boolean; label?: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const look = useLookVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const b = useMemo(() => sprite(rows, palette === PAL ? { ...PAL } : palette, flip), [rows, palette, flip, look]);
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    el.width = b.W;
    el.height = b.H;
    drawTesserae(ctx, b, { tile: 1, gap: 0, jitter: 0 });
  }, [b]);
  return <canvas ref={ref} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={className} style={{ width: b.W * scale, height: b.H * scale, imageRendering: "pixelated", display: "block", ...style }} />;
}

/** Lyko's face with a mood; blinks now and then when motion is allowed. */
export function LykoFace({ mood = "watching", scale = 2, label = "Lyko", className }: { mood?: FaceMood; scale?: number; label?: string; className?: string }) {
  const reduced = useReducedMotion();
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (reduced || mood === "sleeping" || mood === "resting") return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        setBlink(true);
        timer = setTimeout(() => {
          setBlink(false);
          next();
        }, 140);
      }, 2600 + Math.random() * 2800);
    };
    next();
    return () => clearTimeout(timer);
  }, [reduced, mood]);
  return <Sprite rows={lykoFace(mood, blink)} scale={scale} label={label} className={className} />;
}

/** The leash mark: Lyko's collar (in his collar colour), the Tag and the lead. */
export function LeashMark({ scale = 3, label }: { scale?: number; label?: string }) {
  return <Sprite rows={LEASH} scale={scale} {...(label ? { label } : {})} />;
}

export function PupIcon({ role, scale = 3 }: { role: string; scale?: number }) {
  useLookVersion();
  return <Sprite rows={PUP} palette={{ ...PAL, r: COLLARS[role] ?? COLLARS.custom! }} scale={scale} />;
}

/** CAVE CANEM medallion: Lyko in a round mosaic with a lettered ring. */
export function Medallion({ size = 160, mood = "watching", spin = false, title = "Cave canem: beware of the dog. Lyko keeps the wolves out." }: { size?: number; mood?: FaceMood; spin?: boolean; title?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const id = useId().replace(/:/gu, "");
  const tag = useLook((s) => s.look.tag);
  const look = useLookVersion();
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const N = 44;
    const b = buffer(N, N);
    const rows = lykoFace(mood);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x - 21.5, dy = y - 21.5, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 22) continue;
      if (d > 20.8) b.px("#13233A", x, y);
      else if (d > 16.5) b.px("#B9472E", x, y);
      else if (d > 15.5) b.px("#D9A441", x, y);
      else {
        const ch = rows[y - 8]?.[x - 8];
        b.px(ch && ch !== "." && PAL[ch] ? PAL[ch]! : (x + y) % 2 ? "#FBF5E6" : "#F3EAD3", x, y);
      }
    }
    el.width = N * 4;
    el.height = N * 4;
    drawTesserae(ctx, b, { tile: 4, gap: 0.6, jitter: 0.04 });
  }, [mood, look]);
  return (
    <span className={cx("m-medal", spin && "m-medal--spin")} title={title} style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />
      <svg viewBox="0 0 176 176" width={size} height={size} aria-hidden="true">
        <defs>
          <path id={`ring-${id}`} d="M88,88 m-70,0 a70,70 0 1,1 140,0 a70,70 0 1,1 -140,0" />
        </defs>
        <text fontFamily="Silkscreen" fontSize="11" letterSpacing="3" fill="#FBF5E6">
          <textPath href={`#ring-${id}`}>{`CAVE CANEM · ${tag || "LYKIA"} · CAVE CANEM · ${tag || "LYKIA"} ·`}</textPath>
        </text>
      </svg>
      <span className="sr-only">{title}</span>
    </span>
  );
}

export function EmptyState({ mood = "watching", title, children, example, onExample }: { mood?: FaceMood; title: string; children?: React.ReactNode; example?: string; onExample?: (text: string) => void }) {
  return (
    <div className="m-empty">
      <LykoFace mood={mood} scale={3} />
      <h3 style={{ fontSize: 20 }}>{title}</h3>
      {children ? <p>{children}</p> : null}
      {example ? (
        <button type="button" className="m-example" onClick={() => onExample?.(example)}>
          {example}
        </button>
      ) : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="m-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Frame className="m-modal m-card" role="dialog" aria-modal="true" aria-label={title}>
        <header className="m-card__head">
          <h3>{title}</h3>
        </header>
        {children}
      </Frame>
    </div>
  );
}

/** A small Lyko face painted as a mosaic tile, for chat avatars. */
export function LykoTile({ mood = "watching", size = 40 }: { mood?: FaceMood; size?: number }) {
  return <MosaicCanvas build={(t) => face(mood, t)} width={28} height={28} tile={2} gap={0} jitter={0.02} fps={4} assemble={false} dataKey={mood} label="Lyko" style={{ width: size, height: size }} />;
}
