/**
 * Small pixel glyphs (pure): weather, windsock, trail blazes and the danger
 * pictogram, as rows of characters. Each character is a palette key; "." is
 * transparent. Token keys ("k" ink, "w" card, ...) follow the sheet.
 */

export type GlyphRows = readonly string[];

/** Palette keys used by the glyphs: token names resolve against the sheet, hex stays fixed. */
export const GLYPH_PALETTE: Readonly<Record<string, string>> = {
  k: "--ink",
  w: "--card",
  g: "--paper-3",
  d: "--ink-2",
  y: "#F2C200",
  o: "#D9822B",
  r: "#C62D1F",
  b: "#1E5AA8",
  s: "#FFF9EC",
  i: "#1B1714",
};

/** Overlays `top` onto `base` at (ox, oy); "." in `top` keeps the base. */
export function overlay(base: GlyphRows, top: GlyphRows, ox: number, oy: number): string[] {
  const out = base.map((row) => row.split(""));
  top.forEach((row, y) => {
    [...row].forEach((c, x) => {
      const yy = y + oy;
      const xx = x + ox;
      if (c !== "." && out[yy] && xx >= 0 && xx < out[yy]!.length) out[yy]![xx] = c;
    });
  });
  return out.map((row) => row.join(""));
}

function blank(w: number, h: number): string[] {
  return Array.from({ length: h }, () => ".".repeat(w));
}

const SUN: GlyphRows = [
  ".....k.....",
  ".k...k...k.",
  "..k.kkk.k..",
  "...kyyyk...",
  "..kyyyyyk..",
  "kkkyyyyykkk",
  "..kyyyyyk..",
  "...kyyyk...",
  "..k.kkk.k..",
  ".k...k...k.",
  ".....k.....",
];

function cloud(fill: string): GlyphRows {
  return [
    "....kkk....",
    "..kk" + fill.repeat(3) + "k...",
    ".k" + fill.repeat(6) + "kk.",
    "k" + fill.repeat(9) + "k",
    "k" + fill.repeat(9) + "k",
    ".kkkkkkkkk.",
  ];
}

export type WeatherGlyph = "clear" | "few" | "overcast" | "storm";

/** 13 x 13 weather glyphs. */
export function weatherGlyph(kind: WeatherGlyph): string[] {
  const base = blank(13, 13);
  if (kind === "clear") return overlay(base, SUN, 1, 1);
  if (kind === "few") return overlay(overlay(base, SUN, 0, 0), cloud("w"), 2, 7);
  if (kind === "overcast") return overlay(overlay(base, cloud("g"), 0, 2), cloud("w"), 2, 6);
  return overlay(
    overlay(base, cloud("d"), 1, 1),
    ["..yy", ".yy.", "yyyy", "..y.", ".y.."],
    5,
    7,
  );
}

/**
 * The windsock (24 x 12): a pole and five stripes, filled one per 10% APR,
 * alternating caution orange and card; unfilled stripes are dotted outline.
 * `frame` 0/1 flutters the tail; `limp` hangs it down the pole.
 */
export function windsockGlyph(stripes: number, frame: 0 | 1, limp: boolean): string[] {
  const rows = blank(24, 12).map((row) => row.split(""));
  for (let y = 0; y < 12; y += 1) rows[y]![1] = "k";
  if (limp) {
    for (let i = 0; i < 5; i += 1) {
      const y0 = 1 + i * 2;
      const fill = i < stripes ? (i % 2 === 0 ? "o" : "w") : ".";
      for (let y = y0; y < y0 + 2 && y < 12; y += 1) {
        rows[y]![2] = "k";
        rows[y]![3] = fill === "." ? (y % 2 ? "k" : ".") : fill;
        rows[y]![4] = "k";
      }
    }
    return rows.map((row) => row.join(""));
  }
  for (let i = 0; i < 5; i += 1) {
    const x0 = 2 + i * 4;
    const taper = Math.floor(i / 2);
    const drop = frame === 1 && i >= 3 ? 1 : 0;
    const top = 1 + taper + drop;
    const bottom = 9 - taper + drop;
    const filled = i < stripes;
    for (let x = x0; x < x0 + 4; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        const edge = y === top || y === bottom || x === x0 + 3;
        if (edge) rows[y]![x] = filled || (x + y) % 2 === 0 ? "k" : ".";
        else if (filled) rows[y]![x] = i % 2 === 0 ? "o" : "w";
      }
    }
  }
  return rows.map((row) => row.join(""));
}

export type BlazeGlyph = "yellow" | "red" | "blue";

/** Painted trail blazes: a yellow diamond (9 x 9) or white-red-white / white-blue-white bands (13 x 9). */
export function blazeGlyph(kind: BlazeGlyph): string[] {
  if (kind === "yellow") {
    return ["....i....", "...iyi...", "..iyyyi..", ".iyyyyyi.", "iyyyyyyyi", ".iyyyyyi.", "..iyyyi..", "...iyi...", "....i...."];
  }
  const band = kind === "red" ? "r" : "b";
  return [
    "iiiiiiiiiiiii",
    "isssssssssssi",
    "isssssssssssi",
    "i" + band.repeat(11) + "i",
    "i" + band.repeat(11) + "i",
    "i" + band.repeat(11) + "i",
    "isssssssssssi",
    "isssssssssssi",
    "iiiiiiiiiiiii",
  ];
}

/** The danger pictogram (15 x 15): a slope that breaks up as the level rises (1-5). */
export function dangerGlyph(level: number): string[] {
  const rows = blank(15, 15).map((row) => row.split(""));
  // the slope: a stepped triangle
  for (let y = 2; y < 14; y += 1) {
    const half = Math.floor((y - 2) * 0.6);
    rows[y]![7 - half] = "k";
    rows[y]![7 + half] = "k";
  }
  for (let x = 0; x < 15; x += 1) rows[14]![x] = "k";
  rows[1]![7] = "k";
  if (level >= 2) for (let x = 5; x <= 9; x += 2) rows[7]![x] = "k";
  if (level >= 3) for (let x = 4; x <= 10; x += 1) if (x % 2 === 0) rows[10]![x] = "k";
  if (level >= 4) {
    rows[9]![11] = "r";
    rows[10]![12] = "r";
    rows[11]![12] = "r";
    rows[12]![13] = "r";
  }
  if (level >= 5) for (let x = 1; x < 14; x += 1) rows[13]![x] = x % 2 ? "r" : "k";
  return rows.map((row) => row.join(""));
}
