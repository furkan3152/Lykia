import { cx } from "./cx";

export interface ContourLoaderProps {
  /** px (the three blocks fill this square). */
  readonly size?: number;
  readonly className?: string;
  /** Accessible status text; omit when the parent already says it is busy (aria-busy). */
  readonly label?: string;
}

/**
 * The inline loader (buttons, small rows): three pixel blocks lighting up in
 * turn, one step per 400 ms. For panels and pages use `LykoLoader` (Lyko on
 * the rope). Still under reduced motion.
 */
export function ContourLoader({ size = 16, className, label }: ContourLoaderProps) {
  const block = Math.max(2, Math.round(size / 4));
  return (
    <span
      className={cx("el-loop px-loader inline-flex shrink-0 items-end gap-[2px]", className)}
      style={{ height: size, width: block * 3 + 4 }}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {[0, 1, 2].map((index) => (
        <span key={index} className="block bg-current" style={{ width: block, height: block * (index + 2) }} />
      ))}
    </span>
  );
}
