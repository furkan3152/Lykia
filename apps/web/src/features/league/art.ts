/**
 * The League's mosaic art, as pure buffers (node tests load this file):
 *
 * - `coin`: a struck coin. The obverse is the League's shared face (Lyko,
 *   as the Lycian League's coins shared one head); the reverse carries the
 *   city's emblem. Gold for a live city, silver for one that is coming,
 *   dark bronze for one the council paused.
 * - `coast`: the Lycian coast with each city as a harbour whose lamp is lit
 *   while the city is live.
 * - `templeDoor`: the Letoon's door, opening stone by stone.
 * - `forgeStrike`: the hammer and anvil that strike a new city's coin in The Forge.
 */
import type { LeagueEmblem, LeagueState } from "@lykia/core";

import { C, clouds, sea, sky } from "../../mosaic/scenes/common";
import { lykoFace, PAL } from "../../mosaic/sprites";
import { buffer, hash, mix, type Buffer } from "../../mosaic/tessera";

/* ------------------------------------------------------------ metals */

export interface Metal {
  readonly field: string;
  readonly light: string;
  readonly dark: string;
  readonly high: string;
  readonly mid: string;
  readonly rim: string;
}

const METALS: Readonly<Record<LeagueState, Metal>> = {
  live: { field: "#E2B04A", light: "#F3CF78", dark: "#7E5112", high: "#FFF0B8", mid: "#C68F2C", rim: "#5E3E0E" },
  coming: { field: "#C3C8CE", light: "#E2E5E8", dark: "#545C66", high: "#FFFFFF", mid: "#A0A7AF", rim: "#3F454D" },
  paused: { field: "#966747", light: "#B4825C", dark: "#43291A", high: "#D6A784", mid: "#77502F", rim: "#2F1D12" },
};

/* ------------------------------------------------------------ emblems (16 x 16, drawn at 2x) */

/** k: deep relief, m: mid relief, h: highlight. Dots are the coin's field. */
const EMBLEM_ART: Readonly<Record<LeagueEmblem, readonly string[]>> = {
  lighthouse: [
    ".......kk.......",
    "......khhk......",
    ".....kkkkkk.....",
    "..h...khhk...h..",
    "...h..kmmk..h...",
    "......khhk......",
    ".....kmmmmk.....",
    ".....khhhhk.....",
    ".....kmmmmk.....",
    "....khhhhhhk....",
    "....kmmmmmmk....",
    "....khhhhhhk....",
    "..kkkkkkkkkkkk..",
    "................",
    ".kk..kk..kk..kk.",
    "k..kk..kk..kk..k",
  ],
  temple: [
    ".......kk.......",
    ".....kkhhkk.....",
    "...kkhhhhhhkk...",
    ".kkhhhhhhhhhhkk.",
    "kkkkkkkkkkkkkkkk",
    ".hhhhhhhhhhhhhh.",
    "..kh.kh..kh.kh..",
    "..kh.kh..kh.kh..",
    "..kh.kh..kh.kh..",
    "..kh.kh..kh.kh..",
    "..kh.kh..kh.kh..",
    "..kh.kh..kh.kh..",
    ".hhhhhhhhhhhhhh.",
    "kkkkkkkkkkkkkkkk",
    ".kkkkkkkkkkkkkk.",
    "................",
  ],
  prow: [
    ".......k........",
    ".......kh.......",
    ".......khh......",
    ".......khhh.....",
    ".......khhhh....",
    ".......khhhhh...",
    ".......kmmmmmm..",
    ".......k........",
    "k......k......kk",
    "kk.....k.....kk.",
    ".kkkkkkkkkkkkk..",
    ".khhhhhhhhhhhk..",
    "..kmmmmmmmmmk...",
    "...kkkkkkkkk....",
    "................",
    ".kk..kk..kk..kk.",
  ],
  lyre: [
    "................",
    "..kk........kk..",
    ".k..k......k..k.",
    ".k..k......k..k.",
    "..k.k......k.k..",
    "..k.kkkkkkkk.k..",
    "...kk.h.h.h.kk..",
    "...k..h.h.h..k..",
    "...k..h.h.h..k..",
    "...k..h.h.h..k..",
    "....k.h.h.h.k...",
    "....kkkkkkkkk...",
    ".....khhhhhk....",
    "......kkkkk.....",
    "................",
    "................",
  ],
  triskeles: [
    "................",
    "......kkkk......",
    ".....k....k.....",
    ".....k..........",
    "......k.........",
    ".......kk.......",
    "..k....kk....k..",
    ".k.k..khhk..k.k.",
    ".k..kkhhhhkk..k.",
    "..k...khhk...k..",
    "...k...kk...kk..",
    "....kkk..kkk....",
    "................",
    "................",
    "................",
    "................",
  ],
  flame: [
    ".......k........",
    "......khk.......",
    "......khk.......",
    ".....khhhk......",
    "....khhmhhk.....",
    "....khmmmhk..k..",
    "...khhmmmhhk.kk.",
    "..khhmmhmmhhkhk.",
    "..khmmhhhmmhhhk.",
    "..khmmhhhmmmhk..",
    "...khmmhmmmhk...",
    "....khmmmmhk....",
    ".....kkkkkk.....",
    "................",
    "................",
    "................",
  ],
};

/* ------------------------------------------------------------ coins */

export const COIN = 44;
const MID = (COIN - 1) / 2;

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** The blank: a beaded rim, a slightly domed field lit from the top left. */
function blank(b: Buffer, m: Metal): void {
  for (let y = 0; y < COIN; y++) for (let x = 0; x < COIN; x++) {
    const dx = x - MID, dy = y - MID, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 21.6) continue;
    if (d > 20.6) b.px(m.rim, x, y);
    else if (d > 18.6) {
      // Beads around the edge, as on a struck coin.
      const a = Math.atan2(dy, dx);
      const bead = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 40) % 2 === 0;
      b.px(bead ? (d < 19.8 ? m.light : m.mid) : m.dark, x, y);
    } else if (d > 17.8) b.px(m.mid, x, y);
    else {
      const lit = (-(dx + dy) / 36 + 1) / 2; // 0 bottom right .. 1 top left
      const tone = lit > 0.62 ? m.light : lit < 0.3 ? m.mid : m.field;
      b.px(hash(x, y) > 0.93 ? mix(tone, m.high, 0.35) : tone, x, y);
    }
  }
}

function inField(x: number, y: number): boolean {
  const dx = x - MID, dy = y - MID;
  return dx * dx + dy * dy < 17.6 * 17.6;
}

/** The obverse shared by every city: Lyko's head struck in the metal. */
export function coinObverse(state: LeagueState): Buffer {
  const m = METALS[state];
  const b = buffer(COIN, COIN);
  blank(b, m);
  const rows = lykoFace("watching");
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]!;
      const colour = ch === "." ? undefined : PAL[ch];
      if (!colour) continue;
      const x = 8 + i, y = 8 + j;
      if (!inField(x, y)) continue;
      const l = luminance(colour);
      b.px(l > 0.78 ? m.high : l > 0.55 ? m.light : l > 0.3 ? m.mid : m.dark, x, y);
    }
  });
  return b;
}

/** The reverse: the city's emblem, at twice the stone size, inside the field. */
export function coinReverse(state: LeagueState, emblem: LeagueEmblem): Buffer {
  const m = METALS[state];
  const b = buffer(COIN, COIN);
  blank(b, m);
  const art = EMBLEM_ART[emblem];
  const tone: Readonly<Record<string, string>> = { k: m.dark, m: m.mid, h: m.high };
  art.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = tone[row[i]!];
      if (!c) continue;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const x = 6 + i * 2 + ox, y = 6 + j * 2 + oy;
        if (inField(x, y)) b.px(c, x, y);
      }
    }
  });
  return b;
}

/* ------------------------------------------------------------ the coast */

export const COAST_W = 200;
export const COAST_H = 64;

export interface CoastCity {
  readonly state: LeagueState;
}

/** Harbour positions along the coast, west to east (x of each harbour). */
export function harbourSlots(count: number): number[] {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, i) => Math.round(26 + ((COAST_W - 52) * (n === 1 ? 0.5 : i / (n - 1)))));
}

/** The coast line's height at x (the land is above it, the sea below). */
export function shoreAt(x: number): number {
  return Math.round(31 + Math.sin(x / 13) * 2.4 + Math.sin(x / 5.3) * 1.1);
}

function harbour(b: Buffer, cx: number, state: LeagueState, t: number, index: number): void {
  const shore = shoreAt(cx);
  // Two breakwaters curling into the sea.
  for (let i = 0; i < 7; i++) {
    b.px(C.stoneDark, cx - 9 + Math.round(i / 3), shore + i, 2, 1);
    b.px(C.stoneDark, cx + 8 - Math.round(i / 3), shore + i, 2, 1);
  }
  // The town: white houses with terracotta roofs, a theatre step on the hill.
  for (let k = 0; k < 4; k++) {
    const hx = cx - 7 + k * 4;
    const hy = shore - 4 - (k % 2);
    b.px(C.cream, hx, hy, 3, 3);
    b.px(state === "paused" ? "#6E5A4A" : C.terra, hx, hy - 1, 3, 1);
  }
  b.px(C.stoneMid, cx - 3, shore - 9, 7, 1);
  b.px(C.stoneMid, cx - 2, shore - 10, 5, 1);
  // The lighthouse on the east breakwater.
  const lx = cx + 6;
  const top = shore - 6;
  for (let j = 0; j < 8; j++) b.px(j % 2 ? "#C8402F" : "#FBF6EA", lx, top + j, 2, 1);
  b.px(C.navy, lx - 1, top - 2, 4, 2);
  const blink = state === "live" ? Math.sin(t * 2.4 + index * 1.7) > -0.35 : false;
  const lamp = state === "live" ? (blink ? C.lamp : "#E8C25A") : state === "paused" ? "#B9472E" : "#7C7A70";
  b.px(lamp, lx, top - 1, 2, 1);
  if (state === "live" && blink) {
    for (let i = 1; i < 9; i++) {
      const h = 1 + Math.floor(i / 4);
      b.px("#FFF0A8", lx + 2 + i, top - 1 - Math.floor(h / 2), 1, h);
    }
  }
  if (state === "coming") {
    // Scaffolding: the harbour is still being built.
    for (let j = 0; j < 9; j++) if (j % 3 === 0) b.px(C.woodLight, cx - 10, shore - 9 + j, 4, 1);
    b.px(C.wood, cx - 10, shore - 10, 1, 10);
    b.px(C.wood, cx - 7, shore - 10, 1, 10);
  }
}

function boat(b: Buffer, x: number, y: number): void {
  b.px(C.wood, x, y, 6, 1);
  b.px(C.woodLight, x + 1, y + 1, 4, 1);
  b.px(C.cream, x + 2, y - 4, 1, 4);
  b.px(C.cream, x + 3, y - 3, 2, 3);
}

/** The Lycian coast: mountains, the Lycian Way, and one harbour per city. */
export function coast(cities: readonly CoastCity[], t = 0): Buffer {
  const b = buffer(COAST_W, COAST_H);
  sky(b, 16);
  clouds(b, t, 2);
  sea(b, 24, COAST_H - 24, t);
  // The Taurus mountains behind the coast.
  for (let x = 0; x < COAST_W; x++) {
    const peak = Math.round(11 + Math.sin(x / 17) * 4 + Math.sin(x / 7 + 1) * 2);
    b.px(x % 9 < 5 ? "#9AA9A3" : "#8C9C95", x, peak, 1, 30 - peak);
    if (peak < 10) b.px(C.white, x, peak, 1, 1);
  }
  // The land down to the shore, olive groves and pines.
  for (let x = 0; x < COAST_W; x++) {
    const shore = shoreAt(x);
    b.px(C.grass, x, 20, 1, shore - 20);
    b.px(C.sand, x, shore - 1, 1, 2);
    if (hash(x, 3) > 0.84) b.px(C.grassDark, x, 21 + Math.floor(hash(x, 7) * 6), 1, 2);
  }
  // The Lycian Way: a dotted trail joining every harbour.
  for (let x = 4; x < COAST_W - 4; x += 3) b.px(C.ochre, x, shoreAt(x) - 6 + Math.round(Math.sin(x / 9)), 2, 1);
  const slots = harbourSlots(cities.length);
  cities.forEach((c, i) => harbour(b, slots[i]!, c.state, t, i));
  // Boats sail between live harbours.
  const live = slots.filter((_, i) => cities[i]?.state === "live");
  if (live.length >= 2) {
    const span = live[live.length - 1]! - live[0]!;
    const p = (t * 0.04) % 2;
    const along = p < 1 ? p : 2 - p;
    boat(b, Math.round(live[0]! + span * along), 46);
  }
  boat(b, Math.round((t * 3) % (COAST_W + 20)) - 10, 56);
  return b;
}

/* ------------------------------------------------------------ the Letoon's door */

export const DOOR_W = 120;
export const DOOR_H = 72;

/**
 * The Letoon's temple front. `open` runs 0 (closed) to 1 (open): the two
 * leaves slide apart stone column by stone column, and warm light spills out.
 * Lyko sits on the steps keeping watch.
 */
export function templeDoor(open: number, t = 0, watch = true): Buffer {
  const b = buffer(DOOR_W, DOOR_H);
  sky(b, 20);
  clouds(b, t, 3);
  // Steps.
  for (let i = 0; i < 4; i++) b.px(i % 2 ? C.stone : C.stoneMid, 14 - i * 3, 62 + i * 3, DOOR_W - 28 + i * 6, 3);
  // Pediment.
  for (let j = 0; j < 12; j++) b.px(j === 11 ? C.stoneDark : C.stone, 60 - j * 4, 8 + j, 1 + j * 8, 1);
  b.px(C.ochre, 54, 13, 12, 2);
  // Architrave with the meander.
  b.px(C.stoneDark, 12, 20, 96, 1);
  for (let x = 12; x < 108; x++) b.px((x >> 1) % 2 ? C.terra : C.cream, x, 21);
  b.px(C.stone, 12, 22, 96, 3);
  // Columns.
  for (const cx of [16, 30, 84, 98]) {
    b.px(C.stoneMid, cx - 1, 25, 8, 2);
    for (let y = 27; y < 60; y++) {
      b.px(C.stone, cx, y, 6, 1);
      b.px(C.stoneMid, cx + 1, y, 1, 1);
      b.px("#F7F0DE", cx + 3, y, 1, 1);
    }
    b.px(C.stoneMid, cx - 1, 60, 8, 2);
  }
  // The doorway: light inside, leaves sliding apart.
  const x0 = 44, x1 = 76, y0 = 27, y1 = 62;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) b.px(mix("#FFE9A8", "#F2B84B", (y - y0) / (y1 - y0)), x, y);
  const half = (x1 - x0) / 2;
  const shift = Math.round(half * Math.max(0, Math.min(1, open)));
  for (let y = y0; y < y1; y++) {
    for (let i = 0; i < half; i++) {
      const panel = (Math.floor((y - y0) / 8) + Math.floor(i / 8)) % 2 ? "#7A4A22" : "#8B5A2B";
      const studs = (y - y0) % 8 === 4 && i % 8 === 4;
      const lx = x0 + i - shift;
      const rx = x0 + half + i + shift;
      if (lx >= x0) b.px(studs ? C.ochre : panel, lx, y);
      if (rx < x1) b.px(studs ? C.ochre : panel, rx, y);
    }
  }
  if (open < 0.05) {
    // The ring handles and the bar across a closed door.
    b.px(C.ochre, x0 + half - 4, 44, 2, 2);
    b.px(C.ochre, x0 + half + 2, 44, 2, 2);
    b.px(C.wood, x0 + 2, 47, x1 - x0 - 4, 2);
  }
  // Light spilling down the steps when open.
  if (open > 0.2) for (let i = 0; i < 12; i++) b.px("#FFF3C4", x0 + 6 - i, y1 + i, (x1 - x0) - 12 + i * 2, 1);
  // Lyko keeps watch on the steps; his head turns now and then.
  if (watch) {
    const face = lykoFace(open > 0.5 ? "happy" : Math.sin(t * 0.6) > 0.7 ? "alert" : "watching");
    face.forEach((row, j) => {
      if (j < 2 || j > 24) return;
      for (let i = 0; i < row.length; i++) {
        const c = row[i] === "." ? undefined : PAL[row[i]!];
        if (c && i % 2 === 0 && j % 2 === 0) b.px(c, 92 + i / 2, 49 + j / 2, 1, 1);
      }
    });
  }
  return b;
}

/* ------------------------------------------------------------ The Forge's anvil */

export const FORGE_W = 64;
export const FORGE_H = 48;
const ANVIL = "#56677D";
const ANVIL_LIGHT = "#8E9CAE";
const ANVIL_DARK = "#3D4B5E";

/** The forge: the hammer comes down on a hot blank (progress 0 to 0.5), strikes, and lifts off a new coin (0.5 to 1). */
export function forgeStrike(progress: number, state: LeagueState = "live"): Buffer {
  const b = buffer(FORGE_W, FORGE_H);
  const m = METALS[state];
  b.px("#1D3150", 0, 0, FORGE_W, FORGE_H);
  for (let x = 0; x < FORGE_W; x += 4) b.px("#22385A", x, 0, 2, FORGE_H);
  const p = Math.max(0, Math.min(1, progress));
  // The hearth on the left, its coals glowing.
  b.px(C.stoneDark, 2, 30, 9, 16);
  b.px(C.stoneMid, 2, 29, 9, 2);
  for (let i = 0; i < 7; i++) b.px(hash(i, 7) > 0.5 ? C.terra : C.ochre, 3 + i, 31 + (i % 2), 1, 2);
  for (let i = 0; i < 3; i++) b.px(C.lamp, 4 + i * 3, 27 - (i % 2) * 2, 1, 1);
  // The anvil: horn, face, waist, foot, on a wooden block.
  b.px(ANVIL, 17, 31, 4, 2);
  b.px(ANVIL, 14, 31, 3, 1);
  b.px(ANVIL, 21, 30, 26, 4);
  b.px(ANVIL_LIGHT, 21, 30, 26, 1);
  b.px(ANVIL_DARK, 28, 34, 12, 5);
  b.px(ANVIL, 24, 39, 20, 2);
  b.px(C.wood, 22, 41, 24, 5);
  b.px(C.woodLight, 22, 41, 24, 1);
  // The blank: hot before the strike, the city's metal after it.
  const struck = p >= 0.5;
  b.px(struck ? m.light : C.terra, 28, 28, 12, 2);
  b.px(struck ? m.field : C.ochre, 30, 27, 8, 1);
  if (struck) b.px(m.dark, 32, 29, 4, 1);
  // The hammer: head and handle, coming down and lifting away.
  const down = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5;
  const headY = 4 + Math.round(down * 18);
  b.px(C.woodLight, 38, headY + 2, 20, 2);
  b.px(C.stoneDark, 28, headY, 10, 6);
  b.px(C.stoneMid, 28, headY, 10, 1);
  // Sparks at the strike.
  if (p > 0.45 && p < 0.65) for (const [dx, dy] of [[-9, -3], [9, -3], [-12, 0], [12, 0], [-6, -6], [6, -6], [0, -8]] as const) b.px(C.lamp, 33 + dx, 28 + dy, 2, 1);
  return b;
}
