/**
 * Shared scene pieces: sky, sea, headlands with Lycian rock tombs, the
 * Patara lighthouse, pens whose grass height is a yield, fences, trees,
 * boats and the night wash used when the Whistle is blown. Pure.
 */
import { hash, mix, type Buffer } from "../tessera";

export const C = {
  navy: "#13233A",
  terra: "#B9472E",
  ochre: "#D9A441",
  sea: "#1E8FA3",
  olive: "#5F8A3A",
  cream: "#FBF5E6",
  lime: "#F1E8D4",
  stone: "#EADFC6",
  stoneDark: "#8E7D60",
  stoneMid: "#D6C6A2",
  grass: "#8DB255",
  grassDark: "#729A44",
  grassLight: "#A6C768",
  wood: "#5E3C1C",
  woodLight: "#B07A44",
  sand: "#F2DFAE",
  sandDark: "#E2C98F",
  lamp: "#FFE58A",
  sun: "#F7C548",
  white: "#FFFFFF",
} as const;

const SKY_DAY = ["#A8DCEB", "#BFE5EF", "#D4EDF0", "#E7F3EC", "#F6EFDA"];
const SEA_DAY = ["#7FD3D6", "#45BAC6", "#25A1B3", "#188AA0", "#11768C"];

export function sky(b: Buffer, height: number): void {
  const band = Math.max(1, Math.round(height / SKY_DAY.length));
  SKY_DAY.forEach((c, i) => b.px(c, 0, i * band, b.W, band));
  for (let x = 0; x < b.W; x += 2) for (let i = 1; i < SKY_DAY.length; i++) b.px(SKY_DAY[i - 1]!, x + (i % 2), i * band);
}

export function sun(b: Buffer, cx: number, cy: number, r = 7): void {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = x * x + y * y;
    if (d <= r * r) b.px(d < (r * r) / 2.4 ? C.lamp : C.sun, cx + x, cy + y);
  }
}

export function clouds(b: Buffer, t: number, y = 4): void {
  for (const [x0, w, dy] of [[20, 14, 0], [78, 10, 3], [150, 16, 1]] as const) {
    const x = ((x0 + t * 1.5) % (b.W + 30)) - 15;
    b.px(C.white, x, y + dy, w, 2);
    b.px(C.white, x + 3, y + dy - 1, w - 6, 1);
    b.px("#E3F1F4", x + 2, y + dy + 2, w - 4, 1);
  }
}

export function sea(b: Buffer, y0: number, height: number, t: number): void {
  const band = Math.max(1, Math.round(height / SEA_DAY.length));
  SEA_DAY.forEach((c, i) => b.px(c, 0, y0 + i * band, b.W, band));
  const shift = Math.floor(t * 3);
  for (let k = 0; k < Math.round(b.W / 5); k++) {
    const x = (k * 41 + shift * ((k % 3) + 1)) % b.W;
    const y = y0 + 1 + ((k * 7) % Math.max(1, height - 2));
    b.px(k % 3 ? "#BFF0F0" : C.white, x, y, 2 + (k % 2), 1);
  }
}

export function island(b: Buffer, cx: number, horizon: number, half = 9, h = 3, colour = "#86B0B9"): void {
  for (let i = -half; i <= half; i++) {
    const hh = Math.round(h * Math.cos((i / half) * (Math.PI / 2)));
    b.px(colour, cx + i, horizon - hh, 1, hh);
  }
}

/** A cliff rising toward the edge, with a carved tomb. */
export function headland(b: Buffer, mirror: boolean, base: number, width = 40, tomb = true): void {
  for (let x = 0; x < width; x++) {
    const top = Math.round(12 + (base - 14) * (x / width) ** 1.7);
    const X = mirror ? b.W - 1 - x : x;
    b.px(C.stone, X, top, 1, base - top);
    b.px(C.stoneDark, X, top);
    if ((x * 5) % 7 === 0) b.px(C.stoneMid, X, top + 3 + (x % 5), 1, 2);
  }
  if (!tomb) return;
  const tx = mirror ? b.W - 1 - 22 : 8;
  const ty = base - 20;
  for (let i = 0; i < 7; i++) {
    const h = Math.floor(Math.min(i, 13 - i) / 2) + 1;
    b.px("#CDBB93", tx + i, ty - h, 1, h);
    b.px("#CDBB93", tx + 13 - i, ty - h, 1, h);
  }
  b.px(C.stoneDark, tx - 1, ty, 16, 1);
  b.px("#E4D7B9", tx, ty + 1, 14, 10);
  b.px("#B8A57E", tx + 2, ty + 2, 1, 9);
  b.px("#B8A57E", tx + 11, ty + 2, 1, 9);
  b.px("#4E4030", tx + 4, ty + 4, 6, 7);
  b.px("#6B5A41", tx + 5, ty + 5, 4, 6);
  b.px(C.stoneDark, tx - 1, ty + 11, 16, 1);
}

/** The Patara lighthouse on its island; `lit` blinks with every Arc block. */
export function lighthouse(b: Buffer, cx: number, horizon: number, lit: boolean, beams = true): void {
  island(b, cx, horizon + 4, 12, 4, "#CFC2A3");
  for (let j = 0; j < 16; j++) {
    const w = 4 + Math.floor(j / 6);
    b.px(Math.floor(j / 3) % 2 ? "#C8402F" : "#FBF6EA", cx - Math.floor(w / 2), horizon - 16 + j, w, 1);
  }
  const top = horizon - 20;
  b.px(C.navy, cx - 3, top, 6, 4);
  b.px(lit ? C.lamp : "#8C7A3E", cx - 2, top + 1, 4, 2);
  b.px(C.navy, cx - 4, top - 1, 8, 1);
  b.px(C.navy, cx - 1, top - 2, 2, 1);
  if (lit && beams) {
    for (let i = 1; i < 20; i++) {
      const h = 1 + Math.floor(i / 4);
      b.px("#FFF0A8", cx + 2 + i, top + 2 - Math.floor(h / 2), 1, h);
      b.px("#FFF0A8", cx - 3 - i, top + 2 - Math.floor(h / 2), 1, h);
    }
  }
}

export function shoreAndGrass(b: Buffer, y: number): void {
  b.px(C.sand, 0, y, b.W, 3);
  b.px(C.sandDark, 0, y + 2, b.W, 1);
  b.px(C.grass, 0, y + 3, b.W, b.H - y - 3);
  for (let k = 0; k < Math.round((b.W * (b.H - y)) / 60); k++) {
    const x = (k * 53) % b.W;
    const yy = y + 5 + ((k * 29) % Math.max(1, b.H - y - 6));
    b.px(k % 2 ? C.grassDark : C.grassLight, x, yy);
  }
}

/** Grass height in tiles for a yield (`grow` animates 0..1 when rates load). */
export function grassHeight(apy: number | null, max: number, grow = 1, tallest = 11): number {
  if (apy === null || !(max > 0)) return 1;
  return Math.max(2, Math.round((Math.max(0, apy) / max) * tallest * grow));
}

export function pen(b: Buffer, x0: number, base: number, w: number, height: number, best: boolean, t = 0): void {
  for (let i = 0; i < w; i++) {
    const sway = Math.round(Math.sin(t * 2 + i * 0.7) * 0.4);
    const bh = Math.max(1, height - ((i * 5) % 3) + sway);
    b.px(best ? "#3F9A35" : "#5FB445", x0 + i, base - bh, 1, bh);
    if (i % 3 === 0) b.px("#C6E58F", x0 + i, base - bh);
  }
  for (let x = x0 - 1; x <= x0 + w; x += 4) b.px(C.wood, x, base - 6, 1, 8);
  b.px(C.woodLight, x0 - 1, base - 4, w + 2, 1);
  b.px(C.woodLight, x0 - 1, base - 1, w + 2, 1);
}

export function fence(b: Buffer, y: number, from = 0, to = b.W, step = 4): void {
  for (let x = from; x < to; x += step) b.px(C.wood, x, y, 1, 3);
  b.px(C.woodLight, from, y, to - from, 1);
}

export function olive(b: Buffer, x: number, y: number): void {
  b.px("#6B4A2B", x + 4, y + 6, 2, 6);
  for (const [dx, dy, w] of [[1, 0, 8], [0, 2, 10], [0, 4, 10], [2, 6, 6]] as const) b.px("#7E9A6A", x + dx, y + dy, w, 2);
  b.px("#A3BB8C", x + 2, y + 1, 4, 1);
}

export function pine(b: Buffer, x: number, y: number): void {
  b.px(C.wood, x + 3, y + 12, 2, 4);
  for (let j = 0; j < 12; j++) b.px(j % 4 === 0 ? "#2F6B47" : "#1F4A31", x + 4 - Math.floor(j / 2.5), y + j, 1 + 2 * Math.floor(j / 2.5), 1);
}

export function boat(b: Buffer, x: number, y: number, sail = true): void {
  b.px(C.navy, x, y, 14, 1);
  b.px("#C8402F", x + 1, y + 1, 12, 2);
  b.px("#8A5A2B", x + 3, y + 3, 8, 1);
  if (!sail) return;
  b.px(C.wood, x + 7, y - 10, 1, 10);
  for (let j = 0; j < 9; j++) b.px("#FBF6EA", x + 8, y - 9 + j, Math.max(1, Math.floor(j * 0.6)), 1);
}

/** Dashed arc from (x0,y0) to (x1,y1) peaking `lift` tiles above; `upto` 0..1 draws part of it. */
export function arc(b: Buffer, x0: number, y0: number, x1: number, y1: number, lift: number, colour = "#C8407A", upto = 1): { x: number; y: number } {
  const n = Math.max(12, Math.round(Math.abs(x1 - x0) * 1.2));
  let last = { x: x0, y: y0 };
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * lift;
    if (u <= upto) last = { x, y };
    if (i % 4 < 2) b.px(u <= upto ? colour : mix(colour, "#FFFFFF", 0.55), x, y);
  }
  return last;
}

/** Night wash for the Whistle: every stone leans toward navy, stars come out, lit lamps stay bright. */
export function nightify(b: Buffer, skyHeight: number, t = 0): void {
  for (let y = 0; y < b.H; y++) for (let x = 0; x < b.W; x++) {
    const c = b.g[y]![x];
    if (!c) continue;
    if (c === C.lamp || c === "#FFF0A8") continue;
    b.g[y]![x] = mix(c, "#0E1A3A", y < skyHeight ? 0.72 : 0.55);
  }
  for (let k = 0; k < Math.round(b.W / 3); k++) {
    const x = Math.floor(hash(k, 3) * b.W);
    const y = Math.floor(hash(k, 9) * skyHeight * 0.9);
    const twinkle = Math.floor(t * 1.2 + k) % 5 === 0;
    if (b.get(x, y)) b.px(twinkle ? "#FFFFFF" : k % 4 ? "#C9D6F2" : C.lamp, x, y);
  }
}
