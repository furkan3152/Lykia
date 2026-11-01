import { PixelGlyph } from "../../pixel/PixelGlyph";
import { cx, FOCUS_RING } from "../../ui/cx";
import { useThemeToggle } from "../state/useTheme";

const SUN = ["....y....", ".y..y..y.", "..yyyyy..", ".yyyyyyy.", "yyyyyyyyy", ".yyyyyyy.", "..yyyyy..", ".y..y..y.", "....y...."];
const MOON = ["...kkk...", "..kss.k..", ".kss....k", ".ks......", ".ks......", ".kss....k", "..kss.k..", "...kkk...", "........."];

/**
 * DAY / NIGHT switch. The new sheet comes down over the old one in eight
 * pixel bands (a sunset wipe), and the choice is remembered (lykia.theme).
 * `compact`: one square button with a pixel sun or moon (the header).
 */
export function ThemeToggle({ className, compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  const { theme, toggle } = useThemeToggle();
  const night = theme === "dark";
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    toggle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };
  const title = night ? "Switch to the DAY sheet" : "Switch to the NIGHT sheet";
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={night}
        aria-label="Night sheet"
        title={title}
        className={cx("inline-flex h-9 w-9 shrink-0 items-center justify-center px-btn px-btn-paper", FOCUS_RING, className)}
      >
        <PixelGlyph rows={night ? MOON : SUN} scale={2} palette={{ y: "#F2C200", k: "--ink", s: "--ink-2" }} label={null} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={night}
      aria-label="Night sheet"
      title={title}
      className={cx("inline-flex h-9 shrink-0 items-stretch gap-[2px] bg-paper-2 p-[2px] font-tag text-[11px] uppercase px-frame-thin", FOCUS_RING, className)}
    >
      <span className={cx("flex items-center px-2.5", night ? "text-ink-3" : "px-bevel px-bevel-thin px-btn-signal text-[#1B1714]")}>Day</span>
      <span className={cx("flex items-center px-2.5", night ? "px-bevel px-bevel-thin px-btn-accent text-accent-ink" : "text-ink-3")}>Night</span>
    </button>
  );
}
