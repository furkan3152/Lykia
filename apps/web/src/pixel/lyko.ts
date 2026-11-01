/**
 * Lyko, the pixel shepherd dog (pure). A Kangal-like guardian: cream and
 * fawn coat, a black mask over the muzzle, black drop ears, amber eyes and
 * a spiked collar with a small steel tag, the Künye. Two sprite families:
 *
 *  - `makeLykoHead(traits)`: a 32 x 34 front portrait built from shapes on
 *    the left half, mirrored for symmetry and outlined (same craft as the
 *    rest of the kit). Moods change eyes, brows and mouth.
 *  - `LYKO_SIDE`: side-view frames (run A/B, sit, lie) for scenes, where
 *    Lyko runs the outrun arc around the flock.
 *
 * The flock (sheep) and the wolves live here too, because they share the
 * palette. Everything is deterministic and DOM free.
 */
import { emptyGrid, fromArt, INK, mirror, outline, WHITE, type MutableGrid, type PixelGrid } from "./sprite";

export const LYKO_W = 32;
export const LYKO_H = 34;

/** Coat: [base, shade, light]. */
export const COAT = ["#E7CF9F", "#C49A5E", "#F8ECCF"] as const;
export const MASK = "#2B2420";
export const MASK_SOFT = "#4D4038";
export const EYE = "#B8742A";
export const NOSE = "#120E0B";
export const TONGUE = "#E07A6E";
export const COLLAR = "#5B3A22";
export const SPIKE = "#CBD3D8";
export const TAG = "#DCE2E6";
export const TAG_SHADE = "#8E9BA3";

export const LYKO_EYES = ["open", "half", "closed", "wide", "fierce", "happy"] as const;
export const LYKO_MOUTHS = ["closed", "tongue", "teeth", "open"] as const;
export type LykoEye = (typeof LYKO_EYES)[number];
export type LykoMouth = (typeof LYKO_MOUTHS)[number];

export interface LykoTraits {
  readonly eye?: LykoEye;
  readonly mouth?: LykoMouth;
  /** Ears lifted a little (alert). */
  readonly earsUp?: boolean;
  /** The Künye tag catches the light. */
  readonly shine?: boolean;
}

export const DEFAULT_LYKO: Required<LykoTraits> = { eye: "open", mouth: "closed", earsUp: false, shine: false };

/** Head half-width at row y: a broad Kangal skull tapering into a deep muzzle. */
function headHalfWidth(y: number): number {
  if (y < 6.5) return -1;
  if (y <= 16) return 9.4 * Math.sqrt(Math.max(0, 1 - ((y - 15) / 8.6) ** 2));
  if (y <= 27) return 9.2 + (5.2 - 9.2) * ((y - 16) / 11);
  return -1;
}

/** Builds Lyko's portrait from traits: a 32 x 34 colour grid. */
export function makeLykoHead(traits: LykoTraits = {}): PixelGrid {
  const t = { ...DEFAULT_LYKO, ...traits };
  const [F, FD, FL] = COAT;
  const g: MutableGrid = emptyGrid(LYKO_W, LYKO_H);
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < LYKO_W && y < LYKO_H) g[y]![x] = c;
  };
  const sym = (x: number, y: number, c: string) => {
    set(x, y, c);
    set(31 - x, y, c);
  };

  for (let y = 0; y < LYKO_H; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dx = 16 - px;
      // neck under the head
      if (py >= 25 && py <= 33 && dx <= 7.6) sym(x, y, dx > 6.2 ? FD : F);
      // drop ears: black, hanging beside the skull (lifted a little when alert)
      const ex = px - (t.earsUp ? 4.4 : 3.6);
      const ey = py - (t.earsUp ? 11.5 : 14);
      const a = t.earsUp ? -0.55 : -0.2;
      const rx = ex * Math.cos(a) - ey * Math.sin(a);
      const ry = ex * Math.sin(a) + ey * Math.cos(a);
      if ((rx / 2.6) ** 2 + (ry / 5.4) ** 2 <= 1) sym(x, y, (rx / 1.3) ** 2 + (ry / 4) ** 2 <= 1 ? MASK : MASK_SOFT);
      // head
      const w = headHalfWidth(py);
      if (w > 0 && dx <= w) sym(x, y, dx > w - 1.2 && py > 13 ? FD : py < 11 && dx < 4 ? FL : F);
      // the mask: muzzle and a soft shadow up to the eyes
      if ((dx / 5.6) ** 2 + ((py - 22.5) / 5.2) ** 2 <= 1) sym(x, y, MASK);
      else if ((dx / 7.2) ** 2 + ((py - 20.5) / 6.4) ** 2 <= 1 && py > 15.5) sym(x, y, MASK_SOFT);
    }
  }
  // light blaze down the forehead
  for (let y = 8; y <= 15; y += 1) sym(15, y, FL);
  sym(14, 9, FL);
  sym(14, 10, FL);

  const eyes: Record<LykoEye, () => void> = {
    open: () => {
      for (let y = 15; y <= 17; y += 1) for (let x = 9; x <= 11; x += 1) sym(x, y, EYE);
      sym(10, 16, INK);
      sym(11, 16, INK);
      sym(10, 15, WHITE);
      sym(9, 14, MASK_SOFT);
      sym(10, 14, MASK_SOFT);
    },
    half: () => {
      for (let x = 9; x <= 11; x += 1) sym(x, 16, EYE);
      sym(10, 16, INK);
      for (let x = 9; x <= 11; x += 1) sym(x, 15, MASK);
    },
    closed: () => {
      sym(9, 16, INK);
      sym(10, 17, INK);
      sym(11, 17, INK);
      sym(12, 16, INK);
    },
    wide: () => {
      for (let y = 14; y <= 17; y += 1) for (let x = 9; x <= 12; x += 1) sym(x, y, WHITE);
      sym(11, 15, INK);
      sym(11, 16, INK);
      sym(10, 16, EYE);
      sym(10, 15, EYE);
      sym(8, 12, INK);
      sym(9, 12, INK);
    },
    fierce: () => {
      for (let y = 15; y <= 17; y += 1) for (let x = 9; x <= 11; x += 1) sym(x, y, EYE);
      sym(11, 16, INK);
      sym(11, 17, INK);
      // brows slanting down to the centre
      sym(8, 13, INK);
      sym(9, 13, INK);
      sym(10, 14, INK);
      sym(11, 14, INK);
      sym(12, 15, INK);
    },
    happy: () => {
      sym(9, 17, INK);
      sym(10, 16, INK);
      sym(11, 16, INK);
      sym(12, 17, INK);
    },
  };
  (eyes[t.eye] ?? eyes.open)();

  // nose with a highlight
  for (let x = 13; x <= 15; x += 1) {
    sym(x, 20, NOSE);
    sym(x, 21, NOSE);
  }
  sym(14, 22, NOSE);
  sym(15, 22, NOSE);
  set(14, 20, "#6B5E55");

  const mouths: Record<LykoMouth, () => void> = {
    closed: () => {
      sym(15, 23, INK);
      sym(14, 24, INK);
      sym(13, 24, INK);
    },
    tongue: () => {
      sym(15, 23, INK);
      sym(14, 24, INK);
      sym(13, 24, INK);
      for (let y = 25; y <= 27; y += 1) {
        set(15, y, TONGUE);
        set(16, y, TONGUE);
      }
      set(17, 25, TONGUE);
    },
    teeth: () => {
      for (let x = 12; x <= 15; x += 1) sym(x, 24, INK);
      sym(12, 25, WHITE);
      sym(14, 25, WHITE);
      sym(13, 25, INK);
      sym(15, 25, INK);
      for (let x = 12; x <= 15; x += 1) sym(x, 26, INK);
    },
    open: () => {
      for (let x = 13; x <= 15; x += 1) sym(x, 24, INK);
      sym(14, 25, TONGUE);
      sym(15, 25, TONGUE);
    },
  };
  (mouths[t.mouth] ?? mouths.closed)();

  // spiked collar
  for (let x = 8; x <= 15; x += 1) {
    sym(x, 28, COLLAR);
    sym(x, 29, COLLAR);
  }
  for (const x of [9, 12, 15]) {
    sym(x, 27, SPIKE);
    sym(x, 28, SPIKE);
  }
  // the Künye: a small steel tag on a ring
  set(15, 30, TAG_SHADE);
  set(16, 30, TAG_SHADE);
  for (let y = 31; y <= 33; y += 1) for (let x = 14; x <= 17; x += 1) set(x, y, TAG);
  set(15, 32, TAG_SHADE);
  set(16, 32, TAG_SHADE);
  if (t.shine) {
    set(14, 31, WHITE);
    set(17, 33, WHITE);
  }
  return outline(g);
}

const headCache = new Map<string, PixelGrid>();

/** Memoised `makeLykoHead`. */
export function lykoHead(traits: LykoTraits = {}): PixelGrid {
  const t = { ...DEFAULT_LYKO, ...traits };
  const key = `${t.eye}|${t.mouth}|${t.earsUp}|${t.shine}`;
  const hit = headCache.get(key);
  if (hit) return hit;
  const grid = makeLykoHead(t);
  headCache.set(key, grid);
  return grid;
}

/* ------------------------------------------------------------ side view */

const SIDE_PALETTE: Readonly<Record<string, string>> = {
  f: COAT[0],
  d: COAT[1],
  l: COAT[2],
  m: MASK,
  n: NOSE,
  e: EYE,
  c: COLLAR,
  s: SPIKE,
  t: TAG,
  p: TONGUE,
};

/* Facing right, 26 x 15. The tail curls over the back, Kangal style. */
const RUN_A = [
  "..........................",
  "..ddd...............mm....",
  ".d...d.............mfmm...",
  ".d..dd............ffeffm..",
  "..d.d.............ffffmmm.",
  "...dd............dfffmmmmn",
  "....dfffffffffffffffcmmp..",
  "....ffffffffffffffffscs...",
  "....lffffffffffffffft.....",
  "....fffffffffffffffd......",
  "....fff.fff....fff.ff.....",
  "...ff.....ff..ff.....ff...",
  "..ff.......ff.f.......ff..",
  "..m.........m.m........m..",
  "..........................",
];

const RUN_B = [
  "..........................",
  "..ddd...............mm....",
  ".d...d.............mfmm...",
  ".d..dd............ffeffm..",
  "..d.d.............ffffmmm.",
  "...dd............dfffmmmmn",
  "....dfffffffffffffffcmmp..",
  "....ffffffffffffffffscs...",
  "....lffffffffffffffft.....",
  "....fffffffffffffffd......",
  ".....ffff......ffff.......",
  ".....ff.ff.....ff.ff......",
  ".....f...f.....f...f......",
  ".....m...m.....m...m......",
  "..........................",
];

const SIT = [
  "..........................",
  "....................mm....",
  "...................mfmm...",
  "..................ffeffm..",
  "..................ffffmmm.",
  ".................dfffmmmmn",
  "...........dfffffffffcmm..",
  "..ddd.....ffffffffffscs...",
  ".d...d...fffffffffff.t....",
  ".d..dd..fffffffffffd......",
  "..dd.d.ffffffffffff.......",
  "....ddfffffffffffff.......",
  "......ffffffff.fff........",
  "......mmmm.....mm.........",
  "..........................",
];

const LIE = [
  "..........................",
  "..........................",
  "..........................",
  "..........................",
  "..........................",
  "....................mm....",
  "...................mfmm...",
  "..ddd.............ffeffm..",
  ".d...d............ffffmmm.",
  ".d..dd...........dfffmmmmn",
  "..dd.dfffffffffffffffcmm..",
  "....ddfffffffffffffffscs..",
  "....lffffffffffffffffmmmm.",
  "....ffffffffffffffffffffmm",
  "..........................",
];

function side(rows: readonly string[]): PixelGrid {
  return outline(fromArt(rows, SIDE_PALETTE));
}

export type LykoPose = "runA" | "runB" | "sit" | "lie";

export const LYKO_SIDE_W = 26;
export const LYKO_SIDE_H = 15;

const sideCache = new Map<string, PixelGrid>();

/** A side-view frame, facing right (or left with `flip`). */
export function lykoSide(pose: LykoPose, flip = false): PixelGrid {
  const key = `${pose}|${flip}`;
  const hit = sideCache.get(key);
  if (hit) return hit;
  const rows = pose === "runA" ? RUN_A : pose === "runB" ? RUN_B : pose === "sit" ? SIT : LIE;
  const grid = flip ? mirror(side(rows)) : side(rows);
  sideCache.set(key, grid);
  return grid;
}

/** Raw art for tests (row widths, palette coverage). */
export const LYKO_SIDE_ART: Readonly<Record<LykoPose, readonly string[]>> = { runA: RUN_A, runB: RUN_B, sit: SIT, lie: LIE };

/* ------------------------------------------------------------ the flock */

const SHEEP_ART = [
  "..wwwww...",
  ".wwwwwwwk.",
  "wwwwwwwwkk",
  "wwwwwwwwkk",
  ".wwwwwww..",
  "..k.k.k.k.",
];

const WOLF_ART = [
  "..g....g..........",
  "..gg..gg..........",
  ".gggggggg.........",
  "ggygggggggg.......",
  "gggggggggggggggg..",
  "..gggggggggggggggg",
  "...gggggggggggg.gg",
  "...gg.gg...gg.gg.g",
  "...g...g...g...g..",
];

/** A sheep (one holding), facing right; `wool` tints it per token. */
export function sheep(wool = "#F4EFE4", face = "#2B2420"): PixelGrid {
  return outline(fromArt(SHEEP_ART, { w: wool, k: face }));
}

/** A wolf silhouette facing left, for threats at the fence. The eye glints. */
export function wolf(body = "#24262B", eye = "#F2B33D"): PixelGrid {
  return fromArt(WOLF_ART, { g: body, y: eye });
}

export const SHEEP_ART_ROWS = SHEEP_ART;
export const WOLF_ART_ROWS = WOLF_ART;
