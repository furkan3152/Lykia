/** One-colour pixel marks (9 x 9, drawn in currentColor by PixelArt.tsx). "k" is a stone, "." is empty. */

/** One-colour 9 x 9 marks for the steps of Lyko at work (drawn in currentColor). */
export const STEP_ART = {
  intent: [".kkkkkkk.", "kk.....kk", "k.kk.kk.k", "k.......k", "k.kkkkk.k", "kk.....kk", ".kkkkkkk.", "..kk.....", ".k......."],
  wallet: [".........", ".kkkkkkk.", "k.......k", "kkkkkkkkk", "k....kk.k", "k....kkkk", "k.......k", ".kkkkkkk.", "........."],
  memory: ["..kkkkk..", ".k.....k.", "k..k.k..k", "k.......k", "k.kkkkk.k", ".k.....k.", "..kk.kk..", "...k.k...", "...kkk..."],
  delegate: ["k.......k", "kk.....kk", "kkkkkkkkk", "k.kk.kk.k", "kkkkkkkkk", ".kkk.kkk.", "..kkkkk..", "...k.k...", "........."],
  route: [".......kk", "......kkk", ".....k.k.", "....k....", "...k.....", "..k......", ".k.......", "kk.......", "k........"],
  fence: ["k..k..k..", "kk.kk.kk.", "kkkkkkkkk", "k..k..k..", "k..k..k..", "kkkkkkkkk", "k..k..k..", "k..k..k..", "k..k..k.."],
  price: ["....k....", "kkkkkkkkk", "k...k...k", "k...k...k", "kk..k..kk", "kk..k..kk", "....k....", "...kkk...", "..kkkkk.."],
  simulate: ["...kkk...", ".k.k.k.k.", "..kkkkk..", "kkk...kkk", "k.k...k.k", "kkk...kkk", "..kkkkk..", ".k.k.k.k.", "...kkk..."],
  compile: [".........", "kkkkkkkkk", ".........", ".kkkkkkk.", ".........", "..kkkkk..", ".........", "...kkk...", "........."],
  draft: ["....k....", "...kkk...", "..kkkkk..", "..kkkkk..", "..kkkkk..", ".kkkkkkk.", "kkkkkkkkk", ".........", "...kkk..."],
  scent: ["...kkk...", "..k...k..", ".k.....k.", ".k.....k.", ".k.....k.", "..k...k..", "...kkkkk.", "......kkk", ".......kk"],
  insight: [".........", "..kkkkk..", ".k.....k.", "k..kkk..k", "k.kk.kk.k", "k..kkk..k", ".k.....k.", "..kkkkk..", "........."],
  read: [".........", "kkkk.kkkk", "k..k.k..k", "k.kk.kk.k", "k..k.k..k", "k.kk.kk.k", "k..k.k..k", "kkkkkkkkk", "........."],
} as const;

export type StepArt = keyof typeof STEP_ART;

/** Small marks for card headers and states (9 x 9, currentColor). */
export const MARK_ART = {
  check: [".........", "........k", ".......kk", "k.....kk.", "kk...kk..", ".kk.kk...", "..kkk....", "...k.....", "........."],
  cross: [".........", ".k.....k.", ".kk...kk.", "..kk.kk..", "...kkk...", "..kk.kk..", ".kk...kk.", ".k.....k.", "........."],
  bang: ["...kkk...", "...kkk...", "...kkk...", "...kkk...", "...kkk...", "....k....", ".........", "...kkk...", "...kkk..."],
  copy: ["kkkkkk...", "k....k...", "k..kkkkkk", "k..k....k", "k..k....k", "kkkk....k", "...k....k", "...kkkkkk", "........."],
  out: ["....kkkkk", "......kkk", ".....k.kk", "kkk.k...k", "k..k.....", "k.......k", "k.......k", "kkkkkkkkk", "........."],
  qr: ["kkk.k.kkk", "k.k...k.k", "kkk.k.kkk", ".....k...", "k.kk.kk.k", "...k.....", "kkk..k.k.", "k.k.kk..k", "kkk.k.kk."],
  bell: ["....k....", "..kkkkk..", ".kkkkkkk.", ".kkkkkkk.", ".kkkkkkk.", "kkkkkkkkk", "kkkkkkkkk", ".........", "...kkk..."],
  retry: ["..kkkkk..", ".k.....kk", "k......kk", "k....kkkk", "k........", "k.......k", ".k.....k.", "..kkkkk..", "........."],
  spark: ["....k....", "....k....", "...kkk...", "kkkk.kkkk", "...kkk...", "....k....", "....k....", ".........", "........."],
  arrow: [".........", ".....k...", "......k..", "kkkkkkkk.", "kkkkkkkkk", "kkkkkkkk.", "......k..", ".....k...", "........."],
} as const;
