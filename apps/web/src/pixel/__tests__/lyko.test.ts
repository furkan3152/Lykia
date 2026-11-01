import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LYKO_EYES, LYKO_H, LYKO_MOUTHS, LYKO_SIDE_ART, LYKO_SIDE_H, LYKO_SIDE_W, LYKO_W, lykoHead, lykoSide, makeLykoHead, sheep, wolf } from "../lyko";
import { drawLykoMood, LYKO_MOODS, MOOD_H, MOOD_TRAITS, MOOD_W } from "../moods";
import { fromArt, gridSize, mirror, mini, outline } from "../sprite";

function fakeSurface() {
  const calls: Array<[number, number, number, number]> = [];
  return {
    calls,
    surface: {
      fillStyle: "" as string | CanvasGradient | CanvasPattern,
      fillRect: (x: number, y: number, w: number, h: number) => calls.push([x, y, w, h]),
      clearRect: () => undefined,
    },
  };
}

describe("Lyko's portrait", () => {
  it("is 32 x 34 and symmetric apart from the tag shine and nose highlight", () => {
    const grid = makeLykoHead();
    assert.equal(grid.length, LYKO_H);
    for (const row of grid) assert.equal(row.length, LYKO_W);
    let asymmetric = 0;
    for (let y = 0; y < 27; y += 1) for (let x = 0; x < 16; x += 1) if (grid[y]![x] !== grid[y]![31 - x]) asymmetric += 1;
    assert.ok(asymmetric <= 2, `asymmetric pixels: ${asymmetric}`);
  });

  it("draws every eye and mouth, and memoises", () => {
    for (const eye of LYKO_EYES) for (const mouth of LYKO_MOUTHS) assert.equal(makeLykoHead({ eye, mouth }).length, LYKO_H);
    assert.equal(lykoHead({ eye: "happy" }), lykoHead({ eye: "happy" }));
    assert.notDeepEqual(makeLykoHead({ eye: "open" }), makeLykoHead({ eye: "closed" }));
  });

  it("wears a collar with a steel tag (the Künye)", () => {
    const grid = makeLykoHead({ shine: true });
    const colors = new Set(grid.flat().filter(Boolean));
    assert.ok(colors.has("#DCE2E6"), "tag steel");
    assert.ok(colors.has("#5B3A22"), "leather collar");
    assert.ok(colors.has("#2B2420"), "black mask");
  });
});

describe("side sprites, flock and wolves", () => {
  it("side art rows are equal width and every pixel is in the palette", () => {
    for (const [pose, rows] of Object.entries(LYKO_SIDE_ART)) {
      assert.equal(rows.length, LYKO_SIDE_H, pose);
      for (const row of rows) assert.equal(row.length, LYKO_SIDE_W, pose);
    }
    for (const pose of ["runA", "runB", "sit", "lie"] as const) {
      const g = lykoSide(pose);
      assert.equal(gridSize(g).width, LYKO_SIDE_W);
      assert.deepEqual(lykoSide(pose, true), mirror(g));
    }
  });

  it("sheep and wolves build", () => {
    assert.ok(gridSize(sheep()).width >= 10);
    assert.ok(gridSize(wolf()).width >= 18);
  });

  it("fromArt refuses unknown pixels; outline and mini behave", () => {
    assert.throws(() => fromArt(["x?"], { x: "#000" }));
    const g = fromArt(["x"], { x: "#000" });
    assert.equal(outline([[null, null, null], [null, "#000", null], [null, null, null]])[0]![1], "#1B1714");
    assert.equal(mini([["#1", "#2"], ["#3", "#4"]])[0]![0], "#1");
    assert.equal(g[0]![0], "#000");
  });
});

describe("moods", () => {
  it("every core mood has traits and draws inside its canvas", () => {
    for (const mood of LYKO_MOODS) {
      assert.ok(MOOD_TRAITS[mood]);
      const { surface, calls } = fakeSurface();
      drawLykoMood(surface, { mood, seconds: 1.3 });
      assert.ok(calls.length > 100, mood);
      for (const [x, y] of calls) {
        assert.ok(x >= -1 && x < MOOD_W + 1 && y >= -1 && y < MOOD_H + 1, `${mood} out of bounds at ${x},${y}`);
      }
    }
  });
});
