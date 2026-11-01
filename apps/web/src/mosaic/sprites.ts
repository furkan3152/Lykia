/**
 * Lykia's sprite library: Lyko (a big Anatolian shepherd dog: cream coat, black
 * mask, curled tail, spiked collar with a gold Tag tag), his pups (the
 * Pack's sub-agents), the flock and the wolves. Text art, one character per
 * tessera; `.` is empty. Every character must exist in the palette (tests
 * enforce it).
 */
const BASE_PAL: Readonly<Record<string, string>> = {
  k:"#1E1A22", f:"#EBCB94", F:"#FAE9C6", d:"#C99E62", D:"#9A7442", m:"#2B2220", M:"#4E3E36",
  a:"#E3A13A", n:"#0E0B0A", r:"#B8442B", R:"#7E2C1B", s:"#E9EEF1", g:"#F4CB4E", G:"#B88A1E", t:"#E9737E", w:"#FFFFFF",
  W:"#F4F1EA", V:"#D9D2C3", b:"#3A3330", B:"#1D4E89", u:"#9CC9F0", o:"#E58A3A", O:"#B5651D", y:"#F6E7A8", Y:"#E0C66B",
  x:"#24262E", X:"#3B3F4A", z:"#F2B33D",
};

/**
 * The live palette. Lyko's look (collar, coat, tag) is personal: the owner's
 * profile repaints these keys and every sprite and scene reads PAL, so the
 * whole app follows. `applyLook` is the only writer.
 */
export const PAL: Record<string, string> = { ...BASE_PAL };

export type CoatVariant = "cream" | "fawn" | "white" | "sable";

export const COATS: Readonly<Record<CoatVariant, { readonly f: string; readonly F: string; readonly d: string; readonly D: string }>> = {
  cream: { f: BASE_PAL.f!, F: BASE_PAL.F!, d: BASE_PAL.d!, D: BASE_PAL.D! },
  fawn: { f: "#D9AE72", F: "#ECCB98", d: "#B4874C", D: "#86622F" },
  white: { f: "#F2ECE0", F: "#FFFFFF", d: "#D6CDBB", D: "#A79C86" },
  sable: { f: "#BFA27E", F: "#D9C3A2", d: "#8E7556", D: "#5E4C37" },
};

export const COLLAR_COLOURS: readonly string[] = ["#B8442B", "#13233A", "#1E8FA3", "#5F8A3A", "#D9A441", "#C8407A"];

export interface LykoLook {
  readonly collar: string;
  readonly coat: CoatVariant;
  readonly tag: string;
}

export const DEFAULT_LOOK: LykoLook = { collar: "#B8442B", coat: "cream", tag: "LYKO" };

export function lookPalette(look: LykoLook): Record<string, string> {
  const coat = COATS[look.coat] ?? COATS.cream;
  const collar = /^#[0-9a-fA-F]{6}$/u.test(look.collar) ? look.collar : DEFAULT_LOOK.collar;
  return { ...BASE_PAL, ...coat, r: collar };
}

export function applyLook(look: LykoLook): void {
  Object.assign(PAL, lookPalette(look));
}

// Lyko trotting, facing right: big head, black mask, curled tail ring, spiked collar, gold Kunye tag.
export const LYKO_TROT: readonly string[] = [
"................................",
"...kkkk................kkkk.....",
"..kFFFFk..............kmmMmk....",
".kFfkkfFk............kmmmmmmk...",
".kfk..kfk...........kfFFFmmmmk..",
".kfk..kfk..........kfFFFFfmmmk..",
"..kfkkfdk.........kfFFkaFFfmmk..",
"...kffdk.........kfFFFkkFFmmmkk.",
"....kfdkkkkkkkkkkfFFFFFFfmmmmmnk",
"...kfFFFFFFFFFFFFFFFFFFFmmmmmmk.",
"..kdFFFFFFFFFFFFFFFFFFffkmmmtk..",
"..kdffFFFFFFFFFFFFFFFffrsrsrkk..",
"..kdfffffffffffffffffffkrgrk....",
"..kDddffffffffffffffffdkkGk.....",
"..kDdddddddffffffffdddddk.......",
"...kDdkkdddk....kddkkdddk.......",
"...kDdk.kddk....kddk.kddk.......",
"...kdk..kddk....kddk..kddk......",
"...kdk...kdk.....kdk...kdk......",
"...kmmk..kmmk....kmmk..kmmk.....",
"...kkkk..kkkk....kkkk..kkkk.....",
"................................",
];
export const LYKO_TROT2: readonly string[] = [
"................................",
"...kkkk................kkkk.....",
"..kFFFFk..............kmmMmk....",
".kFfkkfFk............kmmmmmmk...",
".kfk..kfk...........kfFFFmmmmk..",
".kfk..kfk..........kfFFFFfmmmk..",
"..kfkkfdk.........kfFFkaFFfmmk..",
"...kffdk.........kfFFFkkFFmmmkk.",
"....kfdkkkkkkkkkkfFFFFFFfmmmmmnk",
"...kfFFFFFFFFFFFFFFFFFFFmmmmmmk.",
"..kdFFFFFFFFFFFFFFFFFFffkmmmtk..",
"..kdffFFFFFFFFFFFFFFFffrsrsrkk..",
"..kdfffffffffffffffffffkrgrk....",
"..kDddffffffffffffffffdkkGk.....",
"..kDdddddddffffffffdddddk.......",
"....kDdkdddk.....kddkddk........",
"....kDddddk......kdddddk........",
".....kdddk........kdddk.........",
".....kdkdk........kdkdk.........",
".....kmkmk........kmkmk.........",
".....kkkkk........kkkkk.........",
"................................",
];
// Big portrait 28x28: head-on, ears dropped, black mask, amber eyes, spiked collar, gold tag.
export const LYKO_FACE: readonly string[] = [
"............................",
"......kkkk........kkkk......",
".....kMmmmk......kmmmMk.....",
"....kMmmmmmkkkkkkmmmmmmMk...",
"....kmmmmmkFFFFFFkmmmmmmk...",
"...kMmmmmkFFFFFFFFkmmmmmMk..",
"...kmmmmkfFFFFFFFFfkmmmmmk..",
"...kmmmkffFFFFFFFFffkmmmmk..",
"...kmmkfffFFFFFFFFfffkmmmk..",
"...kmmkffkkfFFFFfkkffkmmk...",
"....kmkfkwakfFFfkawkfkmk....",
"....kmkfkaakfFFfkaakfkmk....",
"....kkkffkkffFFffkkffkkk....",
".....kkdffffmmmmffffdkk.....",
".....kddfffmmmmmmfffddk.....",
".....kddffmmmnnmmmffddk.....",
"......kdffmmnnnnmmffdk......",
"......kddfmmmmmmmmfddk......",
".......kdmmmMttMmmmdk.......",
".......kdmmmmttmmmmdk.......",
"........kdmmmmmmmmdk........",
"........kdddmmmmdddk........",
".......kRrrrrrrrrrrrRk......",
"......kRsRrsRrrRsrRsRk......",
"......kRrrrrrkgkrrrrrRk.....",
".......kkkkkkgggkkkkkk......",
".............kgGk...........",
"..............kk............",
];
export const SHEEP: readonly string[] = [
"...............",
"....WWW.WWW....",
"..WWWWWWWWWWW..",
".WWWWWWWWWWWWbb",
"WWWWWWWWWWWWbbbb",
"WWWWWWWWWWWWbwbb",
"VWWWWWWWWWWWVbb.",
".VVWWWWWWWVV....",
"..b.b....b.b....",
"..b.b....b.b....",
];
export const PUP: readonly string[] = [
"..kk.......kkk..",
".kFfk.....kmMmk.",
".kfdk....kfFFmmk",
"..kk....kfFkaFmk",
"...kkkkkkfFFfmmnk",
"..kFFFFFFFFFfmtk.",
"..kfffffffffrgk..",
"..kDdkkkdkkdk....",
"..kmk..kmk.kmk...",
"..kkk..kkk.kkk...",
];
export const WOLF: readonly string[] = [
"....................",
"..............xx....",
".............xXxx...",
"x...........xxzxxx..",
"xx.xxxxxxxxxxxxxxxx.",
".xxXXXXXXXXXXxxx....",
"..xXXXXXXXXXXXx.....",
"..xxx.xx...xx.xx....",
"..x...x.....x..x....",
];
export const LYKO_SIT: readonly string[] = [
"....kk..........kk....",
"...kMmk........kmMk...",
"..kMmmkkkkkkkkkkmmMk..",
"..kmmkFFFFFFFFFFkmmk..",
"..kmkFFFFFFFFFFFFkmk..",
"..kmkfkkFFFFFFkkfkmk..",
"...kkfkakFFFFkakfkk...",
"....kffkkFFFFkkffk....",
"....kfffFmmmmFfffk....",
"....kdffmmmnnmmffdk...",
".....kdfmmmmmmmfdk....",
"......kdmmmttmmdk.....",
".....kRsRrRgRrRsRk....",
"....kfFFFkkgkkFFFfk...",
"...kfFFFFFkGkFFFFFfk..",
"...kfFFFFFFFFFFFFFfk..",
"..kdfFFFFFFFFFFFFFFdk.",
"..kdffFFFFFFFFFFFFffdk",
"..kddfffFFFFFFFFfffddk",
"..kdkkffffffffffffkkdk",
"..kdk.kfffffffffk.kdk.",
"..kmk.kddkkkkkddk.kmk.",
"..kmmkkmmk...kmmkkmmk.",
"..kkkkkkkk...kkkkkkkk.",
];


export const LYKO_LIE: readonly string[] = [
"..kkkk............................",
".kFFFFk...............kkkk........",
"kFfkkfFk.............kmmMmk.......",
"kfk..kfk............kmmmmmmk......",
"kfk..kfk...........kfFFFmmmmk.....",
".kfkkfdk..........kfFFFFfmmmk.....",
"..kffdk..........kfFFkkFFfmmk.....",
"...kfdkkkkkkkkkkkfFFFFFFfmmmmnk...",
"..kfFFFFFFFFFFFFFFFFFFFFmmmmmmk...",
".kdFFFFFFFFFFFFFFFFFFFffrsrsrkk...",
".kdffffffffffffffffffffkrgrk......",
".kDdddddddddddddddddddddkkGkkkk...",
".kkkkkkkkkkkkkkkkkkkkkkdddddddmk..",
"......................kkkkkkkkkk..",
];

/** Head lowered to the grass: Lyko sniffing a token. Built from the trot frame. */
export const LYKO_SNIFF: readonly string[] = (() => {
  const rows = LYKO_TROT.map((r) => r.padEnd(32, ".").split(""));
  const out = rows.map((r) => r.map(() => "."));
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < 32; x++) {
    const ch = rows[y]![x]!;
    if (ch === ".") continue;
    const head = x >= 17 && y <= 11;
    const ty = head ? y + 6 : y;
    if (ty < out.length) out[ty]![x] = ch;
  }
  // neck bridge between the shoulders and the lowered head
  for (const [x, y] of [[17, 9], [18, 9], [19, 9], [17, 10], [18, 10], [19, 10], [20, 10]] as const) out[y]![x] = out[y]![x] === "." ? "f" : out[y]![x]!;
  return out.map((r) => r.join(""));
})();

/** The same sheep with its head down, grazing. */
export const SHEEP_GRAZE: readonly string[] = (() => {
  const rows = SHEEP.map((r) => r.padEnd(16, ".").split(""));
  const out = rows.map((r) => r.slice());
  for (let y = rows.length - 1; y >= 0; y--) for (let x = 12; x < 16; x++) {
    const ch = rows[y]![x]!;
    if (ch === "b" || ch === "w") { out[y]![x] = y < 3 ? "W" : "."; if (y + 2 < rows.length) out[y + 2]![x] = ch; }
  }
  return out.map((r) => r.join(""));
})();

/** Face moods: eye rows and mouth swapped on LYKO_FACE. */
export type FaceMood = "watching" | "happy" | "alert" | "sleeping" | "growling" | "proud" | "resting" | "herding";

const EYES: Readonly<Record<string, readonly [string, string]>> = {
  open: ["....kmkfkwakfFFfkawkfkmk....", "....kmkfkaakfFFfkaakfkmk...."],
  wide: ["....kmkfkwwkfFFfkwwkfkmk....", "....kmkfkaakfFFfkaakfkmk...."],
  closed: ["....kmkffffffFFffffffkmk....", "....kmkfkkkkfFFfkkkkfkmk...."],
  happy: ["....kmkffkkffFFffkkffkmk....", "....kmkfkffkfFFfkffkfkmk...."],
  fierce: ["....kmkfkkakfFFfkakkfkmk....", "....kmkffaakfFFfkaaffkmk...."],
};

export function lykoFace(mood: FaceMood, blink = false): readonly string[] {
  const rows = LYKO_FACE.slice();
  const eyes = blink ? EYES.closed! : mood === "sleeping" || mood === "resting" ? EYES.closed! : mood === "happy" || mood === "proud" ? EYES.happy! : mood === "alert" ? EYES.wide! : mood === "growling" ? EYES.fierce! : EYES.open!;
  rows[10] = eyes[0];
  rows[11] = eyes[1];
  const tongue = mood === "happy" || mood === "herding" || mood === "proud";
  rows[18] = tongue ? LYKO_FACE[18]! : LYKO_FACE[18]!.replace(/t/gu, "m");
  rows[19] = tongue ? LYKO_FACE[19]! : LYKO_FACE[19]!.replace(/t/gu, "m");
  if (mood === "growling") rows[19] = rows[19]!.replace("kdmmmmmmmmdk", "kdmwmwwmwmdk");
  if (mood === "proud") rows[25] = ".............kgwk...........";
  return rows;
}

/** Collar colours for pups (one per role). */
export const COLLARS: Readonly<Record<string, string>> = {
  orchestrator: "#13233A",
  treasurer: "#B9472E",
  payroll: "#1E8FA3",
  "fx-hedger": "#5F8A3A",
  "yield-keeper": "#D9A441",
  "bill-payer": "#8A4FA3",
  sentinel: "#2A1E24",
  researcher: "#6E7F8F",
  custom: "#C8407A",
};

/** Wool tints per token. */
export const WOOL: Readonly<Record<string, string>> = { USDC: "#DCE9FB", EURC: "#F6E7B0", cirBTC: "#F7D2A8", USYC: "#DDEFD6", default: "#F4F1EA" };

export const ALL_SPRITES: Readonly<Record<string, readonly string[]>> = { LYKO_TROT, LYKO_TROT2, LYKO_SIT, LYKO_LIE, LYKO_SNIFF, LYKO_FACE, SHEEP, SHEEP_GRAZE, PUP, WOLF };
