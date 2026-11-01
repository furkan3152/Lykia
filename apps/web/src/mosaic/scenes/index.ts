/**
 * Data-driven mosaic scenes. Each builder takes plain data plus a time in
 * seconds (for idle motion: waves, grazing, Lyko's trot) and returns a
 * logical buffer the renderer lays as tesserae. Same data + same time =
 * same picture, so tests can pin them.
 *
 * Data as landscape: grass height is a yield, wool colour is a token,
 * islands are CCTP chains, wolves outside the fence are Scent threats, the
 * lighthouse lamp blinks with every Arc block, pups are sub-agents.
 */
import { buffer, type Buffer } from "../tessera";
import { COLLARS, LYKO_LIE, LYKO_SIT, LYKO_SNIFF, LYKO_TROT, LYKO_TROT2, PAL, PUP, SHEEP, SHEEP_GRAZE, WOLF, WOOL, lykoFace, type FaceMood } from "../sprites";
import { arc, boat, C, clouds, fence, grassHeight, headland, island, lighthouse, nightify, olive, pen, pine, sea, shoreAndGrass, sky, sun } from "./common";

export type LykoPose = "sit" | "trot" | "sniff" | "lie";

export interface PenData {
  readonly label: string;
  /** Percent; null = no published rate. */
  readonly apy: number | null;
}

const sheepPalette = (token: string) => ({ ...PAL, W: WOOL[token] ?? WOOL.default!, V: "#C6BDA9" });

function grazeFrame(i: number, t: number): readonly string[] {
  return Math.floor(t / 2.2 + i * 0.37) % 3 === 0 ? SHEEP_GRAZE : SHEEP;
}

function lykoSprite(pose: LykoPose, t: number): readonly string[] {
  if (pose === "trot") return Math.floor(t * 5) % 2 ? LYKO_TROT2 : LYKO_TROT;
  if (pose === "sniff") return LYKO_SNIFF;
  if (pose === "lie") return LYKO_LIE;
  return LYKO_SIT;
}

/* ------------------------------------------------------------------ bay */

export interface BayData {
  readonly pens: readonly PenData[];
  readonly flock: readonly string[];
  readonly wolves: number;
  /** Lamp state: true on even blocks (blinks once per Arc block). */
  readonly lit: boolean;
  readonly night?: boolean;
  /** 0..1, grass growing in when rates load. */
  readonly grow?: number;
  readonly islands?: readonly string[];
}

export const BAY_W = 200;
export const BAY_H = 72;

/** The symmetric Lycian bay: home and the landing page. */
export function bay(data: BayData, t = 0): Buffer {
  const b = buffer(BAY_W, BAY_H);
  sky(b, 25);
  sun(b, 100, 9);
  clouds(b, t);
  sea(b, 24, 20, t);
  island(b, 56, 24);
  island(b, 144, 24);
  headland(b, false, 46);
  headland(b, true, 46);
  lighthouse(b, 100, 24, data.lit);
  shoreAndGrass(b, 44);
  const slots = [[22, 30], [85, 30], [148, 30]] as const;
  const rates = data.pens.slice(0, 3);
  const max = Math.max(0.0001, ...rates.map((p) => p.apy ?? 0));
  rates.forEach((p, i) => pen(b, slots[i]![0], 58, slots[i]![1], 3 + grassHeight(p.apy, max, data.grow ?? 1, 9), p.apy === max && p.apy !== null, t));
  const bestIndex = rates.findIndex((p) => p.apy === max && p.apy !== null);
  if (bestIndex >= 0) arc(b, 100, 56, slots[bestIndex]![0] + 15, 52, 6);
  const spots = [[46, 56], [62, 59], [28, 60], [138, 56], [122, 59], [156, 60]] as const;
  data.flock.slice(0, 6).forEach((token, i) => b.art(grazeFrame(i, t), spots[i]![0], spots[i]![1], sheepPalette(token), i < 3));
  b.art(data.night ? LYKO_LIE : LYKO_SIT, data.night ? 84 : 89, data.night ? 57 : 47, PAL);
  fence(b, 70);
  const slink = Math.round(Math.sin(t * 0.8) * 1.5);
  if (data.wolves > 0) b.art(WOLF, 1 + slink, 60, PAL, false);
  if (data.wolves > 1) b.art(WOLF, BAY_W - 21 - slink, 60, PAL, true);
  if (data.night) nightify(b, 25, t);
  return b;
}

/* --------------------------------------------------------------- strip */

export const STRIP_W = 240;
export const STRIP_H = 26;

/** The slim scene band the bay collapses into above the chat. */
export function strip(data: { readonly lit: boolean; readonly night?: boolean; readonly running?: boolean }, t = 0): Buffer {
  const b = buffer(STRIP_W, STRIP_H);
  sky(b, 10);
  clouds(b, t, 1);
  sea(b, 9, 8, t);
  shoreAndGrass(b, 17);
  island(b, 60, 9, 8, 2);
  island(b, 180, 9, 8, 2);
  // a small lighthouse at the centre
  for (let j = 0; j < 9; j++) b.px(Math.floor(j / 2) % 2 ? "#C8402F" : "#FBF6EA", 119, 2 + j, 3, 1);
  b.px(C.navy, 118, 0, 5, 2);
  b.px(data.lit ? C.lamp : "#8C7A3E", 119, 1, 3, 1);
  const x = data.running ? Math.round((t * 22) % (STRIP_W + 40)) - 34 : 150;
  b.art(Math.floor(t * 6) % 2 && data.running ? LYKO_TROT2 : LYKO_TROT, x, 4, PAL);
  if (data.night) nightify(b, 10, t);
  return b;
}

/* -------------------------------------------------------------- pasture */

export interface PastureData {
  /** One entry per holding group: token, USD value (null = unpriced), where. */
  readonly holdings: readonly { readonly symbol: string; readonly usd: number | null; readonly where: string; readonly kind: string }[];
  readonly gatewayUsdc: number | null;
  readonly lit: boolean;
  readonly night?: boolean;
  readonly threats?: number;
}

export const PASTURE_W = 200;
export const PASTURE_H = 72;

/** The Flock: wallet sheep in the open field, venue positions in pens, the Gateway ferry at the pier. */
export function pasture(data: PastureData, t = 0): Buffer {
  const b = buffer(PASTURE_W, PASTURE_H);
  sky(b, 22);
  sun(b, 168, 8, 6);
  clouds(b, t);
  sea(b, 20, 16, t);
  island(b, 46, 20, 8, 2);
  island(b, 120, 20, 10, 3);
  lighthouse(b, 186, 20, data.lit, false);
  shoreAndGrass(b, 36);
  // pier + Gateway ferry (unified balance across chains)
  b.px("#8A5A2B", 4, 34, 34, 2);
  for (let i = 0; i < 5; i++) b.px(C.wood, 6 + i * 7, 36, 2, 3);
  if (data.gatewayUsdc && data.gatewayUsdc > 0) boat(b, 14 + Math.round(Math.sin(t) * 1), 30);
  const wallet = data.holdings.filter((h) => h.where === "wallet");
  const venues = data.holdings.filter((h) => h.where !== "wallet" && h.where !== "gateway" && h.kind !== "debt");
  const total = Math.max(1, ...data.holdings.map((h) => h.usd ?? 0));
  // wallet flock: sheep count per token scales with value (1..6)
  const sheep: string[] = [];
  for (const h of wallet) {
    const n = h.usd === null ? 1 : Math.max(1, Math.min(6, Math.round((h.usd / total) * 6)));
    for (let i = 0; i < n; i++) sheep.push(h.symbol);
  }
  const cols = 6;
  sheep.slice(0, 12).forEach((token, i) => {
    const x = 50 + (i % cols) * 17 + (Math.floor(i / cols) % 2) * 8;
    const y = 44 + Math.floor(i / cols) * 10;
    b.art(grazeFrame(i, t), x, y, sheepPalette(token), i % 2 === 1);
  });
  // venue pens along the right
  venues.slice(0, 3).forEach((v, i) => {
    const x0 = 150 + 0, y0 = 44 + i * 9;
    const h = v.usd === null ? 2 : Math.max(2, Math.round((v.usd / total) * 7));
    pen(b, x0 + (i % 2) * 4, y0 + 8, 40, h, i === 0, t);
  });
  b.art(LYKO_SIT, 18, 46, PAL);
  fence(b, 69);
  if (data.threats) b.art(WOLF, PASTURE_W - 22, 60, PAL, true);
  if (data.night) nightify(b, 22, t);
  return b;
}

/* ------------------------------------------------------------- pastures */

export interface PasturesData {
  readonly pens: readonly (PenData & { readonly risk?: "low" | "medium" | "high" })[];
  readonly grow: number;
  readonly lit: boolean;
  readonly night?: boolean;
}

export const PASTURES_W = 200;
export const PASTURES_H = 64;

/** Greener pastures: one pen per venue, grass height = yield; Lyko trots to the greenest. */
export function pastures(data: PasturesData, t = 0): Buffer {
  const b = buffer(PASTURES_W, PASTURES_H);
  sky(b, 20);
  sun(b, 100, 8, 6);
  clouds(b, t);
  sea(b, 18, 12, t);
  headland(b, false, 32, 28, false);
  headland(b, true, 32, 28, false);
  lighthouse(b, 100, 18, data.lit, false);
  shoreAndGrass(b, 30);
  const pens = data.pens.slice(0, 6);
  const n = Math.max(1, pens.length);
  const gap = 4;
  const w = Math.floor((PASTURES_W - 16 - gap * (n - 1)) / n);
  const max = Math.max(0.0001, ...pens.map((p) => p.apy ?? 0));
  let bestX = 100;
  pens.forEach((p, i) => {
    const x0 = 8 + i * (w + gap);
    const best = p.apy === max && p.apy !== null;
    if (best) bestX = x0 + Math.floor(w / 2);
    pen(b, x0, 54, w, 5 + grassHeight(p.apy, max, data.grow, 14), best, t);
    const risk = p.risk === "high" ? C.terra : p.risk === "medium" ? C.ochre : C.olive;
    b.px(risk, x0, 56, w, 1);
  });
  const lykoX = Math.round(bestX - 16 + Math.sin(t * 0.6) * 4);
  b.art(Math.floor(t * 5) % 2 ? LYKO_TROT2 : LYKO_TROT, lykoX, 40, PAL);
  fence(b, 61);
  if (data.night) nightify(b, 20, t);
  return b;
}

/* --------------------------------------------------------------- kennel */

export interface KennelData {
  readonly pups: readonly { readonly role: string; readonly status: string; readonly depth: number }[];
  readonly lit: boolean;
  readonly night?: boolean;
}

export const KENNEL_W = 200;
export const KENNEL_H = 64;

/** The Pack: Lyko at the kennel, his pups around it, collars coloured by role. */
export function kennel(data: KennelData, t = 0): Buffer {
  const b = buffer(KENNEL_W, KENNEL_H);
  sky(b, 18);
  sun(b, 30, 8, 5);
  clouds(b, t);
  sea(b, 16, 10, t);
  island(b, 150, 16, 10, 3);
  shoreAndGrass(b, 26);
  olive(b, 8, 18);
  olive(b, 178, 18);
  // the kennel, centred
  const kx = 86;
  for (let i = 0; i < 9; i++) b.px(C.terra, kx + i, 30 - i, 28 - 2 * i, 1);
  b.px(C.terra, kx - 2, 30, 32, 2);
  b.px("#E9DCC0", kx, 32, 28, 16);
  b.px("#B8A57E", kx, 47, 28, 1);
  b.px("#2B2220", kx + 10, 37, 8, 11);
  b.px(C.ochre, kx + 11, 34, 6, 2);
  b.art(LYKO_SIT, kx + 3, 39, PAL);
  // pups in two arcs, depth sets the ring
  const pups = data.pups.slice(0, 10);
  pups.forEach((p, i) => {
    const left = i % 2 === 0;
    const k = Math.floor(i / 2);
    const x = left ? kx - 22 - k * 18 : kx + 34 + k * 18;
    const y = 44 + (k % 2) * 6 + Math.round(Math.sin(t * 3 + i) * (p.status === "active" ? 0.5 : 0));
    const palette = { ...PAL, r: COLLARS[p.role] ?? COLLARS.custom! };
    if (p.status === "revoked") return;
    b.art(PUP, x, y, p.status === "paused" ? { ...palette, f: "#C9BFA9", F: "#DAD2C1" } : palette, left);
  });
  fence(b, 59);
  if (data.night) nightify(b, 18, t);
  return b;
}

/* ---------------------------------------------------------------- fence */

export interface FenceSceneData {
  /** Caps in USD; post height scales with each. */
  readonly caps: readonly { readonly label: string; readonly usd: number | null }[];
  /** Allowed venues = open gates. */
  readonly gates: number;
  readonly whistle: boolean;
  readonly strangers: boolean;
  readonly lit: boolean;
}

export const FENCE_W = 200;
export const FENCE_H = 60;

/** Building the Fence: post height = cap, gates = allowed venues; the Whistle turns the night on. */
export function fenceScene(data: FenceSceneData, t = 0): Buffer {
  const b = buffer(FENCE_W, FENCE_H);
  sky(b, 18);
  sun(b, 170, 7, 5);
  clouds(b, t);
  sea(b, 16, 10, t);
  headland(b, false, 28, 30, false);
  lighthouse(b, 120, 16, data.lit, data.whistle);
  shoreAndGrass(b, 26);
  const max = Math.max(1, ...data.caps.map((c) => c.usd ?? 0));
  const n = Math.max(1, data.caps.length);
  const span = 136;
  data.caps.forEach((c, i) => {
    const x = 26 + Math.round((i / Math.max(1, n - 1)) * span);
    const h = c.usd === null ? 4 : Math.max(5, Math.round((c.usd / max) * 22));
    b.px(C.wood, x, 54 - h, 3, h);
    b.px(C.woodLight, x, 54 - h, 1, h);
    b.px(C.ochre, x, 54 - h - 1, 3, 1);
  });
  b.px(C.woodLight, 20, 46, 166, 1);
  b.px(C.woodLight, 20, 50, 166, 1);
  // gates: gaps in the rails
  for (let g = 0; g < Math.min(6, data.gates); g++) b.px(C.grass, 40 + g * 24, 45, 5, 7);
  b.art(data.whistle ? LYKO_LIE : LYKO_SIT, data.whistle ? 82 : 88, data.whistle ? 41 : 32, PAL);
  if (!data.strangers) b.art(WOLF, 176 + Math.round(Math.sin(t) * 2), 48, PAL, true);
  if (data.whistle) nightify(b, 18, t);
  return b;
}

/* ---------------------------------------------------------------- sniff */

export interface SniffData {
  readonly level: "verified" | "no-red-flags" | "caution" | "danger" | "unknown" | "idle";
  readonly wolves: number;
  readonly lit: boolean;
}

export const SNIFF_W = 200;
export const SNIFF_H = 60;

const AURA: Record<SniffData["level"], string> = {
  verified: "#3F9A35",
  "no-red-flags": "#7DBE57",
  caution: "#D9A441",
  danger: "#B9472E",
  unknown: "#8E7D60",
  idle: "#D6C6A2",
};

/** Scent: Lyko noses a token stone; wolves gather when it smells wrong and slink off when it is clean. */
export function sniff(data: SniffData, t = 0): Buffer {
  const b = buffer(SNIFF_W, SNIFF_H);
  sky(b, 18);
  sun(b, 30, 7, 5);
  clouds(b, t);
  sea(b, 16, 10, t);
  headland(b, true, 28, 30);
  shoreAndGrass(b, 26);
  pine(b, 6, 24);
  pine(b, 20, 26);
  // the token: a round coin stone
  const cx = 116, cy = 46, r = 6;
  for (let y = -r - 2; y <= r + 2; y++) for (let x = -r - 2; x <= r + 2; x++) {
    const d = Math.sqrt(x * x + y * y);
    if (d <= r) b.px(d > r - 1.2 ? "#8C6A1E" : d < r / 2 ? "#F6DA72" : C.ochre, cx + x, cy + y);
    else if (d <= r + 2 && data.level !== "idle" && Math.floor(t * 2) % 2 === 0) b.px(AURA[data.level], cx + x, cy + y);
  }
  const nose = Math.round(Math.sin(t * 6) * 0.8);
  b.art(LYKO_SNIFF, 80 + nose, 34, PAL);
  const wolves = Math.min(3, data.wolves);
  for (let i = 0; i < wolves; i++) b.art(WOLF, 150 + i * 14 + Math.round(Math.sin(t + i) * 2), 44 + (i % 2) * 5, PAL, true);
  if (wolves === 0 && (data.level === "verified" || data.level === "no-red-flags")) {
    const off = Math.min(40, Math.round(t * 8) % 60);
    b.art(WOLF, 178 + off, 48, PAL, false);
  }
  fence(b, 57);
  return b;
}

/* --------------------------------------------------------------- harbor */

export interface HarborData {
  /** Waypoints count (the outrun's steps). */
  readonly stops: number;
  /** Settled steps. */
  readonly settled: number;
  /** A cross-chain leg: the ferry sails to that island label. */
  readonly ferry: boolean;
  readonly lit: boolean;
  readonly night?: boolean;
}

export const HARBOR_W = 200;
export const HARBOR_H = 60;

/** The Outrun: the arc from the start to the Fold, a flag per stop, Lyko running along as steps settle. */
export function harbor(data: HarborData, t = 0): Buffer {
  const b = buffer(HARBOR_W, HARBOR_H);
  sky(b, 20);
  sun(b, 100, 7, 5);
  clouds(b, t);
  sea(b, 18, 14, t);
  island(b, 170, 18, 12, 4);
  headland(b, false, 34, 34);
  shoreAndGrass(b, 32);
  if (data.ferry) boat(b, 40 + Math.round(((t * 6) % 110)), 26);
  const stops = Math.max(1, data.stops);
  const x0 = 24, x1 = 176, y = 54;
  const progress = Math.min(1, data.settled / stops);
  const at = arc(b, x0, y, x1, y, 14, "#C8407A", progress);
  for (let i = 0; i <= stops; i++) {
    const u = i / stops;
    const fx = Math.round(x0 + (x1 - x0) * u);
    const fy = Math.round(y - Math.sin(u * Math.PI) * 14);
    b.px(C.wood, fx, fy - 6, 1, 6);
    b.px(i === stops ? C.terra : i <= data.settled ? "#3F9A35" : "#FBF6EA", fx + 1, fy - 6, 4, 3);
    b.px(i % 2 ? "#C8402F" : "#FFFFFF", fx + 1, fy - 3, 3, 1);
  }
  b.art(Math.floor(t * 5) % 2 ? LYKO_TROT2 : LYKO_TROT, Math.round(at.x - 24), Math.round(at.y - 20), PAL);
  if (data.night) nightify(b, 20, t);
  return b;
}

/* -------------------------------------------------------------- arcadia */

export const ARCADIA_W = 200;
export const ARCADIA_H = 72;

/** Mount Lykaion at night: the hidden page. */
export function arcadia(t = 0): Buffer {
  const b = buffer(ARCADIA_W, ARCADIA_H);
  for (let y = 0; y < ARCADIA_H; y++) b.px(y < 20 ? "#0B1430" : y < 40 ? "#122046" : "#1B2B52", 0, y, ARCADIA_W, 1);
  for (let x = 0; x < ARCADIA_W; x++) {
    const peak = 26 + Math.round(18 * Math.abs((x - 100) / 100) ** 1.3 + Math.sin(x * 0.3) * 1.5);
    b.px("#2B3B63", x, peak, 1, ARCADIA_H - peak);
    b.px("#3D5080", x, peak);
  }
  b.px("#F6F1D8", 150, 8, 6, 6);
  b.px("#0B1430", 152, 8, 5, 4);
  b.px(C.terra, 98, 44, 4, 2);
  b.px(Math.floor(t * 3) % 2 ? C.lamp : C.ochre, 99, 41, 2, 3);
  b.art(LYKO_SIT, 70, 44, PAL);
  for (let i = 0; i < 5; i++) b.art(SHEEP, 110 + i * 14, 56 + (i % 2) * 4, { ...PAL, W: "#C9D3E6", V: "#9AA8C4" }, i % 2 === 0);
  nightify(b, 30, t);
  return b;
}

/* ----------------------------------------------------------- lyko faces */

export function face(mood: FaceMood, t = 0): Buffer {
  const b = buffer(28, 28);
  const blink = Math.floor(t * 10) % 41 === 0;
  b.art(lykoFace(mood, blink), 0, 0, PAL);
  return b;
}

export function sprite(rows: readonly string[], palette: Readonly<Record<string, string>> = PAL, flip = false): Buffer {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const b = buffer(w, rows.length);
  b.art(rows, 0, 0, palette, flip);
  return b;
}

export { lykoSprite };

/* -------------------------------------------------------------- archive */

export interface ArchiveData {
  /** Memories carved so far (tablets on the cliff). */
  readonly memories: number;
  /** Contacts (named stones by the path). */
  readonly contacts: number;
  readonly lit: boolean;
}

export const ARCHIVE_W = 200;
export const ARCHIVE_H = 60;

/** "Lyko remembers": a cliff of carved tombs, one tablet per memory, named stones for contacts. */
export function archive(data: ArchiveData, t = 0): Buffer {
  const b = buffer(ARCHIVE_W, ARCHIVE_H);
  sky(b, 16);
  sun(b, 172, 6, 5);
  clouds(b, t);
  sea(b, 14, 8, t);
  for (let x = 0; x < ARCHIVE_W; x++) {
    const top = 10 + Math.round(Math.sin(x * 0.07) * 2);
    b.px(C.stone, x, top, 1, 34 - top);
    b.px(C.stoneDark, x, top);
    if ((x * 7) % 5 === 0) b.px(C.stoneMid, x, top + 4 + (x % 7), 1, 2);
  }
  const n = Math.min(14, Math.max(0, data.memories));
  for (let i = 0; i < 14; i++) {
    const x = 6 + i * 14;
    const carved = i < n;
    b.px(carved ? "#E4D7B9" : "#E2D6BD", x, 16, 10, 12);
    b.px(C.stoneDark, x - 1, 15, 12, 1);
    b.px(C.stoneDark, x - 1, 28, 12, 1);
    if (carved) for (let r = 0; r < 4; r++) b.px("#8E7D60", x + 2, 18 + r * 2, 6 - (r % 2) * 2, 1);
  }
  shoreAndGrass(b, 34);
  const stones = Math.min(10, data.contacts);
  for (let i = 0; i < stones; i++) {
    const x = 20 + i * 17;
    b.px("#CFC2A3", x, 46, 6, 5);
    b.px(C.stoneDark, x, 46, 6, 1);
    b.px(i % 2 ? C.terra : C.sea, x + 2, 48, 2, 1);
  }
  b.art(LYKO_SIT, 88, 34, PAL);
  fence(b, 57);
  return b;
}

/* --------------------------------------------------------------- market */

export interface MarketData {
  /** One stall per Circle product. */
  readonly stalls: readonly { readonly status: "live" | "keyless" | "needs-key" | "unavailable" | "unknown" }[];
  readonly lit: boolean;
}

export const MARKET_W = 200;
export const MARKET_H = 60;

const AWNING: Record<MarketData["stalls"][number]["status"], [string, string]> = {
  live: ["#3F9A35", "#FBF5E6"],
  keyless: ["#1E8FA3", "#FBF5E6"],
  "needs-key": ["#D9A441", "#FBF5E6"],
  unavailable: ["#8E7D60", "#D6C6A2"],
  unknown: ["#C98A6A", "#FBF5E6"],
};

/** The harbor market: one stall per Circle product, awning colour = status. */
export function market(data: MarketData, t = 0): Buffer {
  const b = buffer(MARKET_W, MARKET_H);
  sky(b, 18);
  sun(b, 28, 7, 5);
  clouds(b, t);
  sea(b, 16, 12, t);
  boat(b, 150 + Math.round(Math.sin(t) * 1.5), 22);
  lighthouse(b, 186, 16, data.lit, false);
  shoreAndGrass(b, 28);
  b.px("#D9C7A0", 0, 31, MARKET_W, 26);
  for (let x = 0; x < MARKET_W; x += 6) for (let y = 31; y < 57; y += 4) b.px("#CDBB93", x + ((y / 4) % 2) * 3, y, 3, 1);
  const stalls = data.stalls.slice(0, 9);
  const w = 18;
  const gap = Math.max(2, Math.floor((MARKET_W - 12 - stalls.length * w) / Math.max(1, stalls.length - 1)));
  stalls.forEach((s, i) => {
    const x = 6 + i * (w + gap);
    const [a, c] = AWNING[s.status];
    for (let k = 0; k < w; k++) b.px(k % 4 < 2 ? a : c, x + k, 33, 1, 4);
    for (let k = 0; k < w; k += 2) b.px(a, x + k, 37, 1, 1);
    b.px(C.wood, x + 1, 37, 1, 12);
    b.px(C.wood, x + w - 2, 37, 1, 12);
    b.px("#8A5A2B", x, 46, w, 3);
    b.px(s.status === "live" ? C.ochre : s.status === "needs-key" ? C.terra : "#B8A57E", x + 5, 43, 8, 3);
  });
  b.art(Math.floor(t * 5) % 2 ? LYKO_TROT2 : LYKO_TROT, Math.round(((t * 10) % 240) - 34), 36, PAL);
  return b;
}
