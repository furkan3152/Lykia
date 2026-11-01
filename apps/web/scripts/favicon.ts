/**
 * Writes public/favicon.svg: Lyko's face as a round mosaic medallion.
 * Run with `npx tsx scripts/favicon.ts`.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { lykoFace, PAL } from "../src/mosaic/sprites";

const N = 32;
const rects: string[] = [];
const face = lykoFace("happy");
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const dx = x - 15.5;
    const dy = y - 15.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 16) continue;
    let c: string;
    if (d > 15) c = "#13233A";
    else if (d > 14) c = "#B9472E";
    else {
      const ch = face[y + 2]?.[x - 2];
      c = ch && ch !== "." && PAL[ch] ? PAL[ch]! : "#FBF5E6";
    }
    rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`);
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects.join("")}</svg>\n`;
writeFileSync(fileURLToPath(new URL("../public/favicon.svg", import.meta.url)), svg);
console.log("wrote public/favicon.svg");
