import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as S from "../scenes";
import { ALL_SPRITES, PAL, lykoFace, type FaceMood } from "../sprites";
import { assembleDelay, buffer, drawTesserae, hash, mix, shade, validateArt } from "../tessera";

function recorder() {
  const rects: { x: number; y: number; w: number; h: number; c: string; a: number }[] = [];
  return {
    rects,
    fillStyle: "" as string,
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, c: String(this.fillStyle), a: this.globalAlpha });
    },
    clearRect() {},
  };
}

describe("tessera renderer", () => {
  it("is deterministic and bounded", () => {
    assert.equal(hash(3, 4), hash(3, 4));
    for (let i = 0; i < 50; i++) assert.ok(hash(i, i * 7) >= 0 && hash(i, i * 7) <= 1);
    assert.equal(shade("#808080", 1), "rgb(128,128,128)");
    assert.equal(shade("#ffffff", 2), "rgb(255,255,255)");
    assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  });

  it("lays one stone (plus grout) per filled cell", () => {
    const b = buffer(4, 3);
    b.px("#B9472E", 0, 0, 2, 1);
    const ctx = recorder();
    drawTesserae(ctx, b, { tile: 6, gap: 1 });
    assert.equal(ctx.rects.length, 4); // 2 cells x (grout + stone)
    const plain = recorder();
    drawTesserae(plain, b, { tile: 1, gap: 0, jitter: 0 });
    assert.equal(plain.rects.length, 2);
    assert.equal(plain.rects[0]!.c, "#B9472E");
  });

  it("assembles by a wave: nothing at 0, everything at 1", () => {
    const b = buffer(10, 10);
    b.px("#13233A", 0, 0, 10, 10);
    const empty = recorder();
    drawTesserae(empty, b, { tile: 2, gap: 0, jitter: 0, assemble: 0 });
    assert.equal(empty.rects.length, 0);
    const full = recorder();
    drawTesserae(full, b, { tile: 2, gap: 0, jitter: 0, assemble: 1 });
    assert.equal(full.rects.length, 100);
    assert.ok(assembleDelay(0, 0, 10, 10) < assembleDelay(9, 9, 10, 10));
  });
});

describe("sprites", () => {
  it("use only palette colours", () => {
    for (const [name, rows] of Object.entries(ALL_SPRITES)) assert.deepEqual(validateArt(rows, PAL), [], name);
  });

  it("face moods keep the portrait's size", () => {
    for (const mood of ["watching", "happy", "alert", "sleeping", "growling", "proud", "resting", "herding"] as FaceMood[]) {
      const rows = lykoFace(mood);
      assert.equal(rows.length, 28, mood);
      assert.deepEqual(validateArt(rows, PAL), [], mood);
    }
  });
});

describe("scenes", () => {
  const pens = [{ label: "a", apy: 5.8 }, { label: "b", apy: 6.1 }, { label: "c", apy: 4.3 }];
  it("are deterministic for the same data and time", () => {
    const a = S.bay({ pens, flock: ["USDC", "EURC"], wolves: 2, lit: true }, 1.5);
    const b = S.bay({ pens, flock: ["USDC", "EURC"], wolves: 2, lit: true }, 1.5);
    assert.deepEqual(a.g, b.g);
    assert.equal(a.W, S.BAY_W);
    assert.equal(a.H, S.BAY_H);
  });

  it("grow taller grass for higher yields", () => {
    const tallest = (apy: number) => {
      const b = S.pastures({ pens: [{ label: "x", apy }, { label: "max", apy: 10 }], grow: 1, lit: false }, 0);
      let top = b.H;
      for (let y = 0; y < b.H; y++) for (let x = 8; x < 90; x++) if (b.g[y]![x] === "#5FB445" || b.g[y]![x] === "#3F9A35") top = Math.min(top, y);
      return b.H - top;
    };
    assert.ok(tallest(9) > tallest(2));
  });

  it("the whistle turns the bay to night", () => {
    const day = S.bay({ pens, flock: [], wolves: 0, lit: false }, 0);
    const night = S.bay({ pens, flock: [], wolves: 0, lit: false, night: true }, 0);
    assert.notDeepEqual(day.g[2], night.g[2]);
  });

  it("every builder draws inside its frame", () => {
    const all = [
      S.pasture({ holdings: [{ symbol: "USDC", usd: 10, where: "wallet", kind: "token" }], gatewayUsdc: 1, lit: true }, 0),
      S.kennel({ pups: [{ role: "treasurer", status: "active", depth: 1 }], lit: true }, 0),
      S.fenceScene({ caps: [{ label: "a", usd: 1 }], gates: 2, whistle: true, strangers: false, lit: true }, 0),
      S.sniff({ level: "danger", wolves: 3, lit: true }, 2),
      S.harbor({ stops: 3, settled: 2, ferry: true, lit: true }, 1),
      S.arcadia(0),
      S.strip({ lit: true, running: true }, 3),
    ];
    for (const b of all) {
      assert.equal(b.g.length, b.H);
      assert.ok(b.g.every((row) => row.length === b.W));
      assert.ok(b.g.flat().some(Boolean));
    }
  });
});
