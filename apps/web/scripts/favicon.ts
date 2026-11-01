/**
 * Writes public/favicon.svg from Lyko's pixel portrait (the same grid the
 * app draws), one <rect> per run of equal pixels. Run: npx tsx scripts/favicon.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { lykoHead } from "../src/pixel/lyko";

const grid = lykoHead({ shine: true });
const height = grid.length;
const width = Math.max(...grid.map((row) => row.length));
const rects: string[] = [];
for (let y = 0; y < height; y += 1) {
  const row = grid[y]!;
  let x = 0;
  while (x < row.length) {
    const color = row[x];
    if (!color) {
      x += 1;
      continue;
    }
    let run = 1;
    while (row[x + run] === color) run += 1;
    rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${color}"/>`);
    x += run;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${width + 2} ${height + 2}" shape-rendering="crispEdges">${rects.join("")}</svg>\n`;
writeFileSync(fileURLToPath(new URL("../public/favicon.svg", import.meta.url)), svg);
console.log(`favicon.svg: ${rects.length} runs, ${width}x${height}`);
