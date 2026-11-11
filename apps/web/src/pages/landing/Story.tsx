/**
 * The landing's story, told in tesserae instead of text boxes.
 *
 * - What the Fence keeps out, at night: three wolves at the edge of the
 *   fold, one per danger of handing an agent money with no rules.
 * - How it works, by day: Lyko trots a USDC coin through three gates (say it,
 *   Lykia compiles, the Fence and your signature). Under reduced motion he
 *   waits at the last gate.
 *
 * The words are the landing's own (WOLVES and STEPS); this only lays them out.
 */
import { Sprite } from "../../mosaic";
import { PixelArt } from "../../mosaic/PixelArt";
import { LYKO_TROT, LYKO_TROT2, PAL, WOLF } from "../../mosaic/sprites";
import { UsdcCoin } from "../../features/circle/UsdcPath";
import { t } from "../../i18n";

/** A gate in the fence line: two pillars and a lintel, in its own tone. */
const GATE = [
  "..aaaaaaaaaa..",
  ".aAAAAAAAAAAa.",
  "aAAaaaaaaaaAAa",
  "aAa........aAa",
  "aAa........aAa",
  "aAa........aAa",
  "aAa........aAa",
  "aAa........aAa",
  "aAa........aAa",
  "aAa........aAa",
  "aAa........aAa",
  "aAa........aAa",
  "AAAA......AAAA",
];
const GATE_TONES = [
  { a: "#E3A13A", A: "#9A6A1E" },
  { a: "#2A9DB0", A: "#146F80" },
  { a: "#C8553A", A: "#8F3420" },
] as const;
/** Moonlit wolves: lighter greys so they read on the night stone, amber eyes. */
const MOONLIT = { ...PAL, x: "#9AA6B8", X: "#C9D1DC", z: "#F2B33D" };

export function ProblemNight({ items }: { readonly items: readonly (readonly [string, string])[] }) {
  return (
    <div className="lp-night">
      <div className="lp-night__sky" aria-hidden="true" />
      <ul className="lp-night__wolves">
        {items.map(([title, line], i) => (
          <li key={title} className="lp-wolf" style={{ ["--i" as string]: i }}>
            <span className="lp-wolf__eyes" aria-hidden="true">
              <Sprite rows={WOLF} palette={MOONLIT} scale={3} flip={i % 2 === 1} />
            </span>
            <b>{title}</b>
            {line ? <p>{line}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GateWalk({ steps }: { readonly steps: readonly (readonly [string, string, string])[] }) {
  return (
    <div className="lp-walk">
      <div className="lp-walk__scene" aria-hidden="true">
        <div className="lp-walk__gates">
          {steps.map(([n], i) => (
            <span key={n} className="lp-walk__gate" style={{ ["--g" as string]: i }}>
              <PixelArt art={GATE} palette={GATE_TONES[i % GATE_TONES.length]!} size={70} grout />
              <span className="lp-walk__plaque">{n}</span>
            </span>
          ))}
        </div>
        <span className="lp-walker">
          <span className="lp-walker__coin"><UsdcCoin size={22} /></span>
          <Sprite rows={LYKO_TROT} scale={2} className="lp-walker__f1" />
          <Sprite rows={LYKO_TROT2} scale={2} className="lp-walker__f2" />
        </span>
        <span className="lp-walk__ground" />
      </div>
      <ol className="lp-walk__steps" aria-label={t("landing.story.howLykiaWorks")}>
        {steps.map(([n, title, line], i) => (
          <li key={n} className="lp-walk__step" style={{ ["--tone" as string]: GATE_TONES[i % GATE_TONES.length]!.a }}>
            <span className="m-kick">{`GATE ${n}`}</span>
            <b>{title}</b>
            <p className="m-small m-muted">{line}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
