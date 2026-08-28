import { describe, expect, it } from "vitest";
import {
  centerOfElements,
  cursorTravelDuration,
  pointOnCursorPath,
} from "./agent-cursor-motion";

describe("agent cursor motion", () => {
  it("uses bounded travel time that grows with distance", () => {
    expect(cursorTravelDuration({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(280);
    expect(cursorTravelDuration({ x: 0, y: 0 }, { x: 400, y: 0 })).toBe(520);
    expect(cursorTravelDuration({ x: 0, y: 0 }, { x: 10_000, y: 0 })).toBe(
      900,
    );
  });

  it("starts and ends exactly while following a curved path", () => {
    const from = { x: 100, y: 100 };
    const to = { x: 500, y: 100 };

    expect(pointOnCursorPath(from, to, 0, 1)).toEqual(from);
    expect(pointOnCursorPath(from, to, 1, 1)).toEqual(to);
    expect(pointOnCursorPath(from, to, 0.5, 1).y).toBeGreaterThan(100);
    expect(pointOnCursorPath(from, to, 0.5, -1).y).toBeLessThan(100);
  });

  it("targets the center of live element bounds", () => {
    expect(
      centerOfElements([
        { x: 100, y: 80, width: 200, height: 100 },
        { x: 500, y: 180, width: 100, height: 80 },
        { x: 900, y: 900, width: 50, height: 50, isDeleted: true },
      ]),
    ).toEqual({ x: 350, y: 170 });
    expect(centerOfElements([])).toBeNull();
  });
});
