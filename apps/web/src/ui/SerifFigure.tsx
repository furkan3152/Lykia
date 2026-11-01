import { cx } from "./cx";

export interface SerifFigureProps {
  /** Pre-formatted figure ("18,431,206", "$48,213.07"). */
  readonly text: string;
  /** Digit box width in em; Instrument Serif's widest digits fit 0.5em. */
  readonly digitWidth?: number;
  readonly className?: string;
}

/**
 * Large display figure in Instrument Serif that does not jitter as it
 * changes: the face has no tabular figures, so every digit sits in a box of
 * one fixed width. Use it for live heroes (the Sun's block height, net worth).
 */
export function SerifFigure({ text, digitWidth = 0.6, className }: SerifFigureProps) {
  return (
    <span className={cx("inline-flex items-baseline whitespace-nowrap font-mono font-semibold", className)}>
      <span className="sr-only">{text}</span>
      {[...text].map((char, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="inline-block text-center"
          style={/\d/u.test(char) ? { width: `${digitWidth}em` } : char === "," || char === "." ? { width: "0.22em" } : undefined}
        >
          {char}
        </span>
      ))}
    </span>
  );
}
