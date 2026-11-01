import { PixelGlyph } from "../../pixel/PixelGlyph";
import { useMotionToggle } from "../../motion/useReducedMotion";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Toggle } from "../../ui/Toggle";

const MOVING = ["..........", ".kk....kk.", "k..k..k..k", "....kk....", ".........."];
const STILL = ["..........", "..........", "kkkkkkkkkk", "..........", ".........."];

/**
 * Motion switch: stops every loop (Lyko, the valley, the pulse) and shows
 * end states. Never turns motion on against the OS. `compact`: a square
 * button with a pixel wave (the header).
 */
export function MotionToggle({ className, compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  const motion = useMotionToggle();
  return (
    <button
      type="button"
      aria-pressed={motion.checked}
      aria-label="Motion"
      title={motion.description}
      disabled={motion.disabled}
      onClick={() => motion.setOn(!motion.checked)}
      className={cx(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 font-tag text-[11px] uppercase text-ink px-btn px-btn-paper disabled:opacity-50",
        compact ? "w-9" : "px-2.5",
        FOCUS_RING,
        className,
      )}
    >
      <PixelGlyph rows={motion.checked ? MOVING : STILL} scale={2} label={null} />
      {compact ? null : motion.checked ? "Motion" : "Still"}
    </button>
  );
}

/** The same setting as a labelled switch (footer, settings). */
export function MotionSwitch({ className }: { readonly className?: string }) {
  const motion = useMotionToggle();
  return <Toggle checked={motion.checked} disabled={motion.disabled} onChange={motion.setOn} label="Motion" description={motion.description} size="sm" className={className} />;
}
