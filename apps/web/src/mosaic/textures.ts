/**
 * Runtime mosaic textures as CSS custom properties on <html>: the limestone
 * floor (--tess), the meander band (--meander), the running-dog wave
 * (--wave), the 9-slice frame (--frame, --frame-sea, --frame-night) and the
 * thin tessera rule (--rule8). Generated once from the same renderer the
 * scenes use, so every surface shares one stone vocabulary.
 */
import { buffer, drawTesserae, hash } from "./tessera";

function canvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function paint(W: number, H: number, tile: number, gap: number, fn: (x: number, y: number) => string | null, jitter = 0.05, grout: string = "#C9B791"): string | null {
  const c = canvas(W * tile, H * tile);
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return null;
  const b = buffer(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.px(fn(x, y), x, y);
  drawTesserae(ctx, b, { tile, gap, jitter, grout });
  return `url(${c.toDataURL()})`;
}

const MEANDER = ["XXXXXXXX", "........", "X.XXXXX.", "X.X...X.", "X.X.X.X.", "X...X.X.", "XXXXX.X.", "........", "XXXXXXXX"];
const WAVE = ["XXXXXXXX", "........", "..XXX...", ".X...X..", "X..X..X.", "X.XX..X.", "XX...X..", "........", "XXXXXXXX"];

function frame(edgeA: string, edgeB: string, corner: string, inner: string): string | null {
  return paint(9, 9, 4, 1, (i, j) => {
    const edge = i < 3 || j < 3 || i > 5 || j > 5;
    const isCorner = (i < 3 || i > 5) && (j < 3 || j > 5);
    if (!edge) return inner;
    if (isCorner) return (i + j) % 2 ? corner : "#D9A441";
    const ring = Math.min(i, j, 8 - i, 8 - j);
    const k = i < 3 || i > 5 ? j : i;
    return ring === 1 ? (k % 2 ? edgeA : edgeB) : corner;
  });
}

let installed = false;

export function installTextures(root: HTMLElement = document.documentElement): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const tones = ["#F1E8D4", "#EEE4CE", "#F4ECDB", "#EBE1CA"];
  const vars: Record<string, string | null> = {
    "--tess": paint(12, 12, 10, 1.5, (i, j) => tones[Math.floor(hash(i + 3, j + 7) * tones.length)]!, 0.02, "#E2D6BD"),
    "--tess-night": paint(12, 12, 10, 1.5, (i, j) => ["#16243F", "#14213A", "#182845", "#132036"][Math.floor(hash(i + 3, j + 7) * 4)]!, 0.02, "#0E1830"),
    "--meander": paint(8, 9, 4, 1, (i, j) => (j === 0 || j === 8 ? "#B9472E" : MEANDER[j]![i] === "X" ? "#13233A" : "#FBF5E6")),
    "--wave": paint(8, 9, 4, 1, (i, j) => (j === 0 || j === 8 ? "#1E8FA3" : WAVE[j]![i] === "X" ? "#13233A" : "#FBF5E6")),
    "--frame": frame("#B9472E", "#FBF5E6", "#13233A", "#FBF5E6"),
    "--frame-sea": frame("#1E8FA3", "#FBF5E6", "#13233A", "#FBF5E6"),
    "--frame-night": frame("#D9A441", "#1D2D4F", "#0B1430", "#16243F"),
    // The lit meander under an active navigation tile: an ochre key on navy, two pixels per stone.
    "--meander-gold": paint(8, 7, 2, 0.4, (i, j) => (MEANDER[j + 1]![i] === "X" ? "#D9A441" : "#13233A"), 0.03, "#0B1626"),
    // A cream inlay of small stones for lit plates.
    "--tess-plate": paint(8, 8, 4, 0.8, (i, j) => ["#FBF5E6", "#F6EDD8", "#FFF8E9", "#F3E9D2"][Math.floor(hash(i + 11, j + 5) * 4)]!, 0.02, "#E2D3B2"),
    "--rule8":paint(4, 2, 4, 1, (i, j) => (j === 0 ? "#13233A" : i % 2 ? "#B9472E" : "#FBF5E6")),
    // Night: the same stones at dusk. Card insides in lifted slate, keys in muted gold, edges in muted terra.
    "--frame-dusk": frame("#A8553C", "#22324F", "#0B1430", "#1E2B42"),
    "--frame-sea-dusk": frame("#2A8597", "#22324F", "#0B1430", "#1E2B42"),
    "--meander-dusk": paint(8, 9, 4, 1, (i, j) => (j === 0 || j === 8 ? "#A8553C" : MEANDER[j]![i] === "X" ? "#B8913F" : "#1B273C")),
    "--wave-dusk": paint(8, 9, 4, 1, (i, j) => (j === 0 || j === 8 ? "#2A8597" : WAVE[j]![i] === "X" ? "#B8913F" : "#1B273C")),
    "--tess-plate-dusk": paint(8, 8, 4, 0.8, (i, j) => ["#1E2B42", "#1B283D", "#22304A", "#1A263A"][Math.floor(hash(i + 11, j + 5) * 4)]!, 0.02, "#0E1830"),
    "--rule8-dusk": paint(4, 2, 4, 1, (i, j) => (j === 0 ? "#0B1430" : i % 2 ? "#A8553C" : "#22324F")),
  };
  for (const [k, v] of Object.entries(vars)) if (v) root.style.setProperty(k, v);
}
