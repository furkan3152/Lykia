import { cx } from "./cx";

export interface SkeletonProps {
  readonly className?: string;
  /** Kept for compatibility: pixel art has no round shapes, so this is a block too. */
  readonly round?: boolean;
}

/**
 * Loading placeholder: a dithered pixel block where the data will stand. It
 * steps slowly (one shift per 600 ms) and stops under reduced motion. For a
 * whole panel that is loading, prefer `LykoLoader`.
 */
export function Skeleton({ className }: SkeletonProps) {
  return <span aria-hidden="true" className={cx("el-skeleton el-loop block", className)} />;
}

export interface SkeletonTextProps {
  readonly lines?: number;
  readonly className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <span className={cx("flex flex-col gap-2", className)} role="presentation">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx("h-3", index === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </span>
  );
}
