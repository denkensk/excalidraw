import { pointFrom, radiansToDegrees } from "@excalidraw/math";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { LocalPoint, Radians } from "@excalidraw/math";

import { getArrowheadPoints } from "../src/bounds";
import {
  EXCALIDRAWZ_ARROW_ARROWHEAD_ANGLE,
  EXCALIDRAWZ_ARROW_ARROWHEAD_SIZE,
} from "../src/excalidrawZArrowheads";
import { ShapeCache } from "../src/shape";

// the arrow points right, along the x axis
const getArrowArrowheadSides = (length: number) => {
  const arrow = API.createElement({
    type: "arrow",
    points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(length, 0)],
    endArrowhead: "arrow",
    roughness: 0,
  });
  const [tipX, tipY, x1, y1, x2, y2] = getArrowheadPoints(
    arrow,
    ShapeCache.generateElementShape(arrow, null),
    "end",
    "arrow",
  )!;

  return [
    [x1 - tipX, y1 - tipY],
    [x2 - tipX, y2 - tipY],
  ].map(([dx, dy]) => ({
    length: Math.hypot(dx, dy),
    angle: radiansToDegrees(Math.abs(Math.atan2(dy, -dx)) as Radians),
  }));
};

describe("ExcalidrawZ arrowheads", () => {
  it("draws full-size arrow arrowheads with the shorter sides", () => {
    for (const side of getArrowArrowheadSides(200)) {
      expect(side.length).toBeCloseTo(EXCALIDRAWZ_ARROW_ARROWHEAD_SIZE);
      expect(side.angle).toBeCloseTo(EXCALIDRAWZ_ARROW_ARROWHEAD_ANGLE);
    }
  });

  it("doesn't close up arrow arrowheads scaled down on a short arrow", () => {
    // scaled down to half of the arrow's length
    const length = EXCALIDRAWZ_ARROW_ARROWHEAD_SIZE * 1.5;

    for (const side of getArrowArrowheadSides(length)) {
      expect(side.length).toBeCloseTo(length / 2);
      // opening up to at most 30°
      expect(side.angle).toBeGreaterThan(
        EXCALIDRAWZ_ARROW_ARROWHEAD_ANGLE - 0.01,
      );
      expect(side.angle).toBeLessThan(30.01);
    }
  });
});
