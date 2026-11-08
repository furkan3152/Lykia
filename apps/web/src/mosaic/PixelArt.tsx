/**
 * Hand-drawn pixel art as SVG squares (never glyphs or emoji). Each
 * character of a row is one tessera; the palette maps characters to
 * colours ("." is empty). With `grout`, every square is inset a hair so the
 * joints between stones show, the way the rest of the Mosaic is laid.
 */
import { useMemo } from "react";

import { MARK_ART, STEP_ART } from "./pixelArtData";

export type PixelPalette = Readonly<Record<string, string>>;

export function PixelArt({ art, palette, size = 24, grout = false, label, className, style }: { readonly art: readonly string[]; readonly palette: PixelPalette; readonly size?: number; readonly grout?: boolean; readonly label?: string; readonly className?: string; readonly style?: React.CSSProperties }) {
  const w = art[0]?.length ?? 0;
  const h = art.length;
  const paths = useMemo(() => {
    const byColour = new Map<string, string>();
    const inset = grout ? 0.07 : 0;
    const side = 1 - inset * 2;
    art.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const fill = palette[ch];
        if (!fill) return;
        byColour.set(fill, `${byColour.get(fill) ?? ""}M${x + inset} ${y + inset}h${side}v${side}h-${side}z`);
      });
    });
    return [...byColour.entries()];
  }, [art, palette, grout]);
  return (
    <svg width={size} height={(size * h) / Math.max(1, w)} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={className} style={{ display: "block", flex: "none", ...style }}>
      {paths.map(([fill, d]) => (
        <path key={fill} d={d} fill={fill} />
      ))}
    </svg>
  );
}

/* --------------------------------------------------------------- navigation */

/** Lyko's head: fawn coat, black ears and mask, the spiked collar with its Tag. */
const ASK_ART = [
  ".kk......kk.",
  "kkkkffffkkkk",
  "kkffffffffkk",
  ".ffffffffff.",
  ".fkkffffkkf.",
  ".fkwkffkwkf.",
  ".ffkkffkkff.",
  "..fkkkkkkf..",
  "...kkkkkk...",
  "...kkttkk...",
  "..oooooooo..",
  ".....oo.....",
];

/** The Fold: a ewe behind the rails of a sheepfold, on grass. */
const FOLD_ART = [
  "............",
  "...cccc.....",
  "..cccccckk..",
  ".ccccccckwk.",
  ".ccccccckkk.",
  "bbbbbbbbbbbb",
  "b...b..b...b",
  "b...b..b...b",
  "bbbbbbbbbbbb",
  "b...b..b...b",
  "b...b..b...b",
  "gggggggggggg",
];

/** The Forge: an anvil on its block, a hot bar on the face and sparks off the strike. */
const FORGE_ART = [
  "..h....h....",
  "....h.h..h..",
  "...h........",
  "...otttto...",
  "kkkkkkkkkkkk",
  ".kkkkkkkkkkk",
  "...kkkkkkkk.",
  ".....kkkk...",
  ".....kkkk...",
  "...kkkkkkkk.",
  "..bbbbbbbbbb",
  "..bebbbbebbb",
];

const NAV_PALETTE: PixelPalette = {
  k: "#0b1626",
  f: "#e8c48a",
  w: "#fff6de",
  t: "#d9604a",
  o: "#d9a441",
  c: "#f4ecd8",
  b: "#a8763e",
  g: "#6f9a44",
  d: "#9a6a1a",
  y: "#e2b04f",
  h: "#ffe6a0",
  e: "#7d5410",
};

export type NavArt = "ask" | "fold" | "forge";
const NAV_ARTS: Readonly<Record<NavArt, readonly string[]>> = { ask: ASK_ART, fold: FOLD_ART, forge: FORGE_ART };

export function NavIcon({ name, size = 24 }: { readonly name: NavArt; readonly size?: number }) {
  return <PixelArt art={NAV_ARTS[name]} palette={NAV_PALETTE} size={size} grout />;
}

/* ------------------------------------------------------------------- steps */



export function StepIcon({ kind, size = 14 }: { readonly kind: string; readonly size?: number }) {
  const art = (STEP_ART as Record<string, readonly string[]>)[kind] ?? STEP_ART.read;
  return <PixelArt art={art} palette={{ k: "currentColor" }} size={size} />;
}


export function Mark({ name, size = 12 }: { readonly name: keyof typeof MARK_ART; readonly size?: number }) {
  return <PixelArt art={MARK_ART[name]} palette={{ k: "currentColor" }} size={size} />;
}
