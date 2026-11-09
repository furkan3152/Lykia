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

/** Ask Lyko's starting points: one hand-laid tessera icon per intent (12 x 12). */
export const INTENT_PAL: Readonly<Record<string, string>> = {
  k: "#13233A", g: "#5F8A3A", G: "#3D6124", y: "#F4CB4E", Y: "#B88A1E", t: "#B9472E", r: "#B9472E", R: "#7E2C1B",
  s: "#1E8FA3", S: "#9CC9F0", u: "#9CC9F0", B: "#1D4E89", w: "#FFF6DE",
};

export const INTENT_ART = {
  earn: ["....gg......", "...gGg.gg...", "....gg.gG...", ".....ggg....", "......g.....", "...yyyyyy...", "..yYYYYYYy..", ".yYyyyyyyYy.", ".yYyyYYyyYy.", ".yYyyyyyyYy.", "..yYYYYYYy..", "...yyyyyy..."],
  send: ["............", ".......t....", ".......tt...", "..yyy..ttt..", ".yYYYy.tttt.", ".yYyYytttttt", ".yYyYytttttt", ".yYYYy.tttt.", "..yyy..ttt..", ".......tt...", ".......t....", "............"],
  bridge: ["............", "rrrrrrrrrrrr", "RrRrRrRrRrRr", "rrrr....rrrr", "rrr......rrr", "rr........rr", "rr........rr", "rr........rr", "rrssssssssrr", "ssSsssSsssSs", "ssssssssssss", "............"],
  watch: [".....kk.....", "....yyyy....", "...yYYYYy...", "..yYyyyyYy..", "..yYyyyyYy..", "..yYyyyyYy..", ".yYyyyyyyYy.", ".yYyyyyyyYy.", "yYYYYYYYYYYy", "kkkkkkkkkkkk", ".....kk.....", "............"],
  have: ["............", "..uuuuuuuu..", ".uBBBBBBBBu.", "..uuuuuuuu..", ".yyyyyyyyyy.", "yYYYYYYYYYYy", ".yyyyyyyyyy.", "..uuuuuuuu..", ".uBBBBBBBBu.", "..uuuuuuuu..", ".gggggggggg.", "............"],
  can: ["......y.....", "......y.....", ".....yYy....", "....yYYYy...", "yyyyYYwYYyyy", "....yYYYy...", ".....yYy....", "......y.....", "......y.....", "............", "............", "............"],
} as const;

/** Preflight: one hand-laid stone per check family (12 x 12, INTENT_PAL). */
export const PREFLIGHT_ART = {
  gas: ["..kkkkkk....", "..kwwwwk....", "..kwwwwk.k..", "..kkkkkk..k.", "..kttttk..k.", "..kttttkk.k.", "..kttttk.kk.", "..kttttk..k.", "..kttttk..k.", "..kttttk.kk.", ".kkkkkkkk...", ".kkkkkkkk..."],
  money: ["............", "....yyyy....", "..yyYYYYyy..", ".yYYyyyyYYy.", ".yYyyYYyyYy.", "yYyyYyyyyyYy", "yYyyyYYyyyYy", "yYyyyyyYyyYy", ".yYyyYYyyYy.", ".yYYyyyyYYy.", "..yyYYYYyy..", "....yyyy...."],
  cost: ["............", "....yyyy....", "..yyYYYYyy..", ".yYYyyyyYYy.", ".yYyyyyyyYy.", "yYytttttyyYy", "yYytttttyyYy", "yYyyyyyyyyYy", ".yYyyyyyyYy.", ".yYYyyyyYYy.", "..yyYYYYyy..", "....yyyy...."],
  risk: ["..kkkkkkkk..", ".kSSSSSSSSk.", ".kSBBSSBBSk.", ".kSBBSSBBSk.", ".kSSSSSSSSk.", ".kSBBSSBBSk.", ".kSBBSSBBSk.", "..kSSSSSSk..", "..kSSSSSSk..", "...kSSSSk...", "....kSSk....", ".....kk....."],
  time: ["....kkkk....", "..kkwwwwkk..", ".kwwwwkwwwk.", ".kwwwwkwwwk.", "kwwwwwkwwwwk", "kwwwwwkwwwwk", "kwwwwwkkkkwk", "kwwwwwwwwwwk", ".kwwwwwwwwk.", ".kwwwwwwwwk.", "..kkwwwwkk..", "....kkkk...."],
  address: ["......kkkkk.", ".....kyyyyk.", "....kyyyyyk.", "...kyyyykyk.", "..kyyyyyyyk.", ".kyyyyyyyk..", "kyyyyyyyk...", ".kyyyyyk....", "..kyyyk.....", "...kyk......", "....k.......", "............"],
  bridge: ["............", "rrrrrrrrrrrr", "RrRrRrRrRrRr", "rrrr....rrrr", "rrr......rrr", "rr........rr", "rr........rr", "rr........rr", "rrssssssssrr", "ssSsssSsssSs", "ssssssssssss", "............"],
  network: ["............", ".........ss.", ".........ss.", "......ss.ss.", "......ss.ss.", "...ss.ss.ss.", "...ss.ss.ss.", "ss.ss.ss.ss.", "ss.ss.ss.ss.", "ss.ss.ss.ss.", "kkkkkkkkkkkk", "............"],
  approval: ["............", ".yyyy.......", "yYYYYy......", "yY..Yy......", "yY..Yyyyyyyy", "yYYYYyYYYYYy", ".yyyy....yYy", ".........y.y", "............", "............", "............", "............"],
  limits: ["..k...k...k.", ".kyk.kyk.kyk", ".kyk.kyk.kyk", "kkkkkkkkkkkk", ".kyk.kyk.kyk", ".kyk.kyk.kyk", "kkkkkkkkkkkk", ".kyk.kyk.kyk", ".kyk.kyk.kyk", ".kyk.kyk.kyk", "gggggggggggg", "............"],
} as const;
