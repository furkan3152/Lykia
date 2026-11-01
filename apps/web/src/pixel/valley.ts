/**
 * The valley (pure drawing): Lykia's world on one canvas. Back to front:
 * sky (with a soft rainbow arc by day, stars by night), the Taurus ridge,
 * the turquoise sea, the meadow with pines, the flock grazing, the Fence
 * along the front with wolves outside it, and Lyko. An optional outrun arc
 * is drawn dashed from the start post to the Fold. Every motion changes at
 * most 2.5 times a second; `still` draws the readable end state.
 */
import { drawDisc, drawGrid, drawSilhouette, type PixelSurface } from "./draw";
import { LYKO_SIDE_H, LYKO_SIDE_W, lykoSide, sheep, wolf } from "./lyko";
import { gridSize, INK, PINE, PINE_DARK, SEA, SEA_LIGHT, STONE, STONE_DARK, SUN, TERRACOTTA, WHITE } from "./sprite";
import { rngOf } from "./topo";

export interface ValleySheep {
  /** 1 (lamb) to 3 (ram): size by value. */
  readonly size: 1 | 2 | 3;
  readonly wool?: string;
  /** 0..1 across the meadow; omitted = spread deterministically. */
  readonly x?: number;
  readonly label?: string;
}

export interface ValleyOptions {
  readonly night?: boolean;
  readonly sheep?: readonly ValleySheep[];
  /** Wolves at the fence (threats). */
  readonly wolves?: number;
  /** What Lyko does: run the outrun arc, sit on watch, lie down (whistle), or circle cw / ccw (commands). */
  readonly lyko?: "run" | "sit" | "lie" | "cw" | "ccw";
  /** The outrun: waypoints count and progress 0..1 (settled share). Null = no arc. */
  readonly outrun?: { readonly waypoints: number; readonly progress: number } | null;
  /** Hide the rainbow (busy pages). */
  readonly rainbow?: boolean;
  readonly seed?: number;
}

export interface TextSurface extends PixelSurface {
  clearRect(x: number, y: number, w: number, h: number): void;
}

const RAINBOW = ["#E46F5A", "#F0A04B", "#F2D06B", "#8CC77F", "#5FB8C9", "#6E8FD1", "#9A7CC4"];

/** Point on the outrun arc (a parabola from the start post to the Fold), t in 0..1. */
export function arcPoint(t: number, x0: number, x1: number, ground: number, height: number): { readonly x: number; readonly y: number } {
  const x = x0 + (x1 - x0) * t;
  const y = ground - height * 4 * t * (1 - t);
  return { x: Math.round(x), y: Math.round(y) };
}

/** Evenly spaced waypoint positions along the arc (start and Fold included). */
export function arcWaypoints(count: number): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, i) => i / (count - 1));
}

function band(ctx: PixelSurface, y0: number, y1: number, w: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, y0, w, Math.max(0, y1 - y0));
}

export function drawValley(ctx: TextSurface, w: number, h: number, seconds: number, still: boolean, options: ValleyOptions = {}): void {
  const T = still ? 0 : seconds;
  const night = options.night === true;
  const rand = rngOf(options.seed ?? 7);
  ctx.clearRect(0, 0, w, h);
  const horizon = Math.round(h * 0.46);
  const shore = Math.round(h * 0.58);
  const ground = h - 6;

  // sky: stepped bands
  const sky = night ? ["#0B1626", "#0F1E33", "#13263F", "#182E4A"] : ["#BFE3EE", "#CFE9EE", "#E3EFE6", "#F6E2C6"];
  const step = Math.ceil(horizon / sky.length);
  sky.forEach((c, i) => band(ctx, i * step, Math.min(horizon, (i + 1) * step), w, c));

  if (night) {
    // stars: a fixed field, a few twinkle slowly
    for (let i = 0; i < Math.round(w / 5); i += 1) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(rand() * (horizon - 6));
      const twinkle = !still && i % 7 === 0 && Math.floor(T * 1.2 + i) % 3 === 0;
      ctx.fillStyle = twinkle ? "#FFFFFF" : i % 3 === 0 ? "#FFE9B0" : "#C9D6E8";
      ctx.fillRect(x, y, 1, 1);
    }
    drawDisc(ctx, Math.round(w * 0.82), Math.round(horizon * 0.28), 5, "#F4EBD0");
    drawDisc(ctx, Math.round(w * 0.82) + 2, Math.round(horizon * 0.28) - 1, 4, sky[1]!);
  } else {
    drawDisc(ctx, Math.round(w * 0.84), Math.round(horizon * 0.3), 6, SUN);
    if (options.rainbow !== false) {
      // a soft rainbow arc: dithered bands, every other pixel
      const cx = Math.round(w * 0.42);
      const cy = horizon + 4;
      const r0 = Math.round(Math.min(w * 0.36, horizon * 1.05));
      RAINBOW.forEach((color, i) => {
        ctx.fillStyle = color;
        const r = r0 - i * 2;
        for (let x = cx - r; x <= cx + r; x += 1) {
          const dy = Math.sqrt(Math.max(0, r * r - (x - cx) ** 2));
          const y = Math.round(cy - dy);
          if (y < horizon && (x + y + i) % 2 === 0) ctx.fillRect(x, y, 1, 2);
        }
      });
    }
    // two pixel clouds drifting
    for (let i = 0; i < 2; i += 1) {
      const x = Math.round(((T * 2 + i * w * 0.55) % (w + 40)) - 20);
      const y = 6 + i * 9;
      ctx.fillStyle = WHITE;
      ctx.fillRect(x, y, 16, 3);
      ctx.fillRect(x + 4, y - 2, 8, 2);
    }
  }

  // the Taurus ridge
  const ridge = night ? ["#1D2C3E", "#243649"] : ["#9FB4B8", "#B9C6C2"];
  for (let layer = 0; layer < 2; layer += 1) {
    ctx.fillStyle = ridge[layer]!;
    let y = horizon - 10 + layer * 4;
    for (let x = 0; x < w; x += 1) {
      y += Math.round((rand() - 0.5) * 2.2);
      y = Math.max(horizon - 22 + layer * 6, Math.min(horizon - 2, y));
      ctx.fillRect(x, y, 1, horizon - y + 1);
    }
  }
  // limestone cliff on the left with a Lycian rock tomb
  ctx.fillStyle = night ? "#3A4652" : STONE;
  ctx.fillRect(0, horizon - 14, Math.round(w * 0.14), shore - horizon + 14);
  ctx.fillStyle = night ? "#2B3540" : STONE_DARK;
  ctx.fillRect(Math.round(w * 0.14) - 2, horizon - 14, 2, shore - horizon + 14);
  const tx = Math.round(w * 0.04);
  ctx.fillStyle = night ? "#1E262E" : TERRACOTTA;
  ctx.fillRect(tx, horizon - 9, 7, 8);
  ctx.fillStyle = night ? "#11171C" : "#7A3A20";
  ctx.fillRect(tx + 2, horizon - 6, 3, 5);
  ctx.fillRect(tx - 1, horizon - 10, 9, 1);

  // the sea
  band(ctx, horizon, shore, w, night ? "#123A4A" : SEA);
  ctx.fillStyle = night ? "#2A6A7C" : SEA_LIGHT;
  const drift = Math.floor(T * 1.5);
  for (let y = horizon + 2; y < shore - 1; y += 3) {
    for (let x = ((y * 7 + drift) % 11) - 11; x < w; x += 11) ctx.fillRect(x, y, 4, 1);
  }
  // the meadow
  band(ctx, shore, h, w, night ? "#1E3A2C" : "#8DB36B");
  ctx.fillStyle = night ? "#173022" : "#7AA35B";
  for (let i = 0; i < Math.round(w / 3); i += 1) ctx.fillRect(Math.floor(rand() * w), shore + 2 + Math.floor(rand() * (h - shore - 4)), 1, 2);
  // sand strip
  band(ctx, shore, shore + 2, w, night ? "#3A4C40" : "#E8D9B0");

  // pines along the shore
  for (let i = 0; i < Math.max(2, Math.round(w / 70)); i += 1) {
    const px = Math.round(w * 0.18 + i * (w * 0.75) / Math.max(1, Math.round(w / 70)) + rand() * 10);
    const base = shore + 4;
    ctx.fillStyle = night ? "#2A1E14" : "#6B4A2E";
    ctx.fillRect(px, base - 6, 2, 8);
    for (let k = 0; k < 3; k += 1) {
      ctx.fillStyle = night ? (k % 2 ? "#14301F" : "#0F2718") : k % 2 ? PINE : PINE_DARK;
      ctx.fillRect(px - (4 - k), base - 10 - k * 4, (4 - k) * 2 + 2, 4);
    }
  }

  // the outrun arc: dashed from the start post to the Fold, settled part solid
  const x0 = Math.round(w * 0.12);
  const x1 = Math.round(w * 0.88);
  const arcGround = shore + Math.round((ground - shore) * 0.55);
  const arcHeight = Math.round((arcGround - horizon) * 0.95);
  if (options.outrun) {
    const { waypoints, progress } = options.outrun;
    const steps = Math.max(40, Math.round((x1 - x0) * 1.2));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const p = arcPoint(t, x0, x1, arcGround, arcHeight);
      const done = t <= progress;
      if (!done && Math.floor(i / 3) % 2 === 1) continue;
      ctx.fillStyle = done ? (night ? "#F2B33D" : TERRACOTTA) : night ? "#9FC7D6" : "#FFFFFF";
      ctx.fillRect(p.x, p.y, 1, 1);
    }
    arcWaypoints(Math.max(2, waypoints + 1)).forEach((t, i, all) => {
      const p = arcPoint(t, x0, x1, arcGround, arcHeight);
      const reached = t <= progress + 1e-9;
      ctx.fillStyle = INK;
      ctx.fillRect(p.x - 2, p.y - 2, 5, 5);
      ctx.fillStyle = i === all.length - 1 ? SUN : reached ? (night ? "#F2B33D" : TERRACOTTA) : WHITE;
      ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    });
  }

  // the flock
  const flock = options.sheep ?? [];
  flock.forEach((member, i) => {
    const grid = sheep(member.wool);
    const s = member.size;
    const spread = member.x ?? 0.25 + ((i * 0.618) % 1) * 0.55;
    const x = Math.round(w * spread);
    const y = Math.round(shore + 8 + ((i * 37) % 9) + (s === 3 ? 0 : 2));
    const bob = still ? 0 : Math.floor(T * 1.2 + i) % 2;
    // scale by size: draw the grid with s px blocks
    drawGrid(ctx, grid, x, y - (s - 1) * 4 + (i % 2 === 0 ? 0 : bob), s === 3 ? 2 : 1);
    if (s === 2) drawGrid(ctx, grid, x + 1, y, 1);
  });

  // the Fence: posts and rails along the front
  const fenceY = ground - 9;
  ctx.fillStyle = night ? "#5D6A70" : STONE_DARK;
  for (let x = 2; x < w - 2; x += 10) ctx.fillRect(x, fenceY - 2, 2, 11);
  ctx.fillStyle = night ? "#7D8A90" : STONE;
  ctx.fillRect(0, fenceY, w, 1);
  ctx.fillRect(0, fenceY + 4, w, 1);

  // wolves outside the fence (bottom edge, half hidden)
  const wolves = Math.max(0, Math.min(5, options.wolves ?? 0));
  for (let i = 0; i < wolves; i += 1) {
    const g = wolf(night ? "#05070A" : "#2A2C33", i % 2 === 0 ? "#F2B33D" : "#E46F5A");
    const { width } = gridSize(g);
    const x = Math.round(w - 12 - width - i * (width + 10));
    const lurk = still ? 0 : Math.floor(T * 0.8 + i) % 2;
    drawGrid(ctx, g, x + lurk, ground - 3);
  }

  // Lyko
  const mode = options.lyko ?? "sit";
  const frameRun = still ? "runA" : Math.floor(T * 5) % 2 === 0 ? "runA" : "runB";
  if (mode === "run" && options.outrun) {
    const t = Math.min(1, Math.max(0, options.outrun.progress));
    const p = arcPoint(t, x0, x1, arcGround, arcHeight);
    drawGrid(ctx, lykoSide(t >= 1 ? "sit" : frameRun), p.x - Math.round(LYKO_SIDE_W / 2), p.y - LYKO_SIDE_H + 2);
  } else if (mode === "cw" || mode === "ccw") {
    // circling the flock: an ellipse around the meadow centre
    const cx = Math.round(w * 0.5);
    const cy = shore + Math.round((fenceY - shore) * 0.5);
    const rx = Math.round(w * 0.3);
    const ry = Math.round((fenceY - shore) * 0.45);
    const dir = mode === "cw" ? 1 : -1;
    const a = (still ? 0.3 : T * 1.4) * dir;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * ry);
    const facingLeft = Math.sin(a) * dir > 0;
    // a dotted trail behind him
    ctx.fillStyle = night ? "#9FC7D6" : WHITE;
    for (let k = 1; k <= 6; k += 1) {
      const b = a - dir * k * 0.18;
      ctx.fillRect(Math.round(cx + Math.cos(b) * rx), Math.round(cy + Math.sin(b) * ry) + LYKO_SIDE_H - 4, 1, 1);
    }
    drawGrid(ctx, lykoSide(frameRun, facingLeft), x - Math.round(LYKO_SIDE_W / 2), y);
  } else {
    const pose = mode === "lie" ? "lie" : "sit";
    const x = Math.round(w * 0.16);
    const y = fenceY - LYKO_SIDE_H + 4;
    drawSilhouette(ctx, lykoSide(pose), x + 1, y + 1, night ? "rgba(0,0,0,0.35)" : "rgba(27,23,20,0.18)");
    drawGrid(ctx, lykoSide(pose), x, y);
  }
}
