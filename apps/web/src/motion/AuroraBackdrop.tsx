import { cx } from "../ui/cx";

export interface AuroraBackdropProps {
  /** "hero": full aurora with stars (landing); "app": a quiet glow behind the deck; "page": in between. */
  readonly variant?: "hero" | "app" | "page";
  /** fixed (behind the whole viewport) or absolute (inside a positioned parent). */
  readonly position?: "fixed" | "absolute";
  readonly className?: string;
}

/*
 * A starfield from a few radial gradients: no canvas, no images, no layout
 * cost. Stars sit in fixed percentages so they never shimmer on resize.
 */
const STARS = [
  "radial-gradient(1px 1px at 12% 18%, rgb(var(--text-0) / 0.55) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 27% 62%, rgb(var(--text-0) / 0.35) 50%, transparent 51%)",
  "radial-gradient(1.5px 1.5px at 41% 12%, rgb(var(--gold) / 0.7) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 58% 38%, rgb(var(--text-0) / 0.4) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 66% 8%, rgb(var(--text-0) / 0.5) 50%, transparent 51%)",
  "radial-gradient(1.5px 1.5px at 78% 54%, rgb(var(--violet-soft) / 0.6) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 88% 22%, rgb(var(--text-0) / 0.45) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 8% 82%, rgb(var(--text-0) / 0.3) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 35% 88%, rgb(var(--text-0) / 0.3) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 94% 76%, rgb(var(--text-0) / 0.35) 50%, transparent 51%)",
  "radial-gradient(1px 1px at 51% 72%, rgb(var(--text-0) / 0.25) 50%, transparent 51%)",
  "radial-gradient(1.5px 1.5px at 20% 40%, rgb(var(--gold) / 0.45) 50%, transparent 51%)",
].join(", ");

/**
 * A slow violet-to-gold radial gradients that
 * drift over ~25 s (transform only, GPU cheap). Static under reduced motion
 * (global.css) and paused in hidden tabs (`.el-loop`). Decorative only.
 */
export function AuroraBackdrop({ variant = "page", position = "absolute", className }: AuroraBackdropProps) {
  const hero = variant === "hero";
  const app = variant === "app";
  return (
    <div aria-hidden="true" className={cx("pointer-events-none inset-0 -z-0 overflow-hidden", position === "fixed" ? "fixed" : "absolute", className)}>
      <div
        className="el-loop absolute left-1/2 animate-aurora-a rounded-full"
        style={{
          top: hero ? "-320px" : app ? "-420px" : "-360px",
          width: hero ? "1200px" : "1000px",
          height: hero ? "980px" : "760px",
          marginLeft: hero ? "-380px" : "-500px",
          background: "radial-gradient(closest-side, var(--aurora-violet), rgba(139, 92, 246, 0.06) 58%, transparent 100%)",
          opacity: app ? 0.55 : 1,
        }}
      />
      <div
        className="el-loop absolute animate-aurora-b rounded-full"
        style={{
          top: hero ? "520px" : "380px",
          right: "-220px",
          width: "760px",
          height: "760px",
          background: "radial-gradient(closest-side, var(--aurora-gold), transparent 100%)",
          opacity: app ? 0.5 : 1,
        }}
      />
      <div
        className="el-loop absolute animate-aurora-a rounded-full [animation-delay:-9s]"
        style={{
          bottom: "-280px",
          left: "-240px",
          width: "820px",
          height: "620px",
          background: "radial-gradient(closest-side, var(--aurora-sky), transparent 100%)",
        }}
      />
      {hero || variant === "page" ? <div className="absolute inset-0 opacity-80" style={{ backgroundImage: STARS }} /> : null}
    </div>
  );
}
