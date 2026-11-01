import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { arcPoint, arcWaypoints, drawValley } from "../valley";

describe("outrun arc geometry", () => {
  it("starts and ends on the ground and peaks in the middle", () => {
    const start = arcPoint(0, 10, 110, 80, 40);
    const end = arcPoint(1, 10, 110, 80, 40);
    const mid = arcPoint(0.5, 10, 110, 80, 40);
    assert.deepEqual(start, { x: 10, y: 80 });
    assert.deepEqual(end, { x: 110, y: 80 });
    assert.deepEqual(mid, { x: 60, y: 40 });
    assert.ok(arcPoint(0.25, 10, 110, 80, 40).y > mid.y);
  });

  it("spaces waypoints evenly, start and fold included", () => {
    assert.deepEqual(arcWaypoints(1), [0]);
    assert.deepEqual(arcWaypoints(3), [0, 0.5, 1]);
  });
});

describe("drawValley", () => {
  it("paints day and night scenes with every option, still and moving", () => {
    for (const night of [false, true]) {
      for (const lyko of ["run", "sit", "lie", "cw", "ccw"] as const) {
        let fills = 0;
        const surface = { fillStyle: "" as string | CanvasGradient | CanvasPattern, fillRect: () => (fills += 1), clearRect: () => undefined };
        drawValley(surface, 240, 100, 3.7, lyko === "sit", { night, lyko, wolves: 3, sheep: [{ size: 3 }, { size: 1 }], outrun: { waypoints: 3, progress: 0.5 } });
        assert.ok(fills > 500, `${night} ${lyko}`);
      }
    }
  });
});
