import { describe, expect, it } from "vitest";
import type { SceneElementLike } from "./types";
import {
  buildCanvasVisualGuidance,
  buildIllustrationQualityReminder,
} from "./visual-guidance";

function shape(
  id: string,
  index: number,
  backgroundColor = "#e7f5ff",
): SceneElementLike {
  return {
    id,
    type: index % 2 === 0 ? "ellipse" : "rectangle",
    x: index * 20,
    y: index * 10,
    width: 80,
    height: 60,
    strokeColor: ["#1971c2", "#2f9e44", "#e67700", "#9c36b5"][
      index % 4
    ],
    backgroundColor,
  };
}

describe("canvas visual guidance", () => {
  it("gives an empty canvas a detailed illustration target", () => {
    expect(buildCanvasVisualGuidance([])).toMatchObject({
      sceneStyle: "empty",
      visibleElementCount: 0,
      illustrationTarget: {
        minimumElements: 30,
        maximumElementsPerCall: 50,
        matchExistingDetail: false,
      },
    });
  });

  it("detects a layered scene and ignores deleted or bound text elements", () => {
    const elements = Array.from({ length: 30 }, (_, index) =>
      shape(`shape-${index}`, index),
    );
    elements.push({
      ...shape("bound-label", 31),
      type: "text",
      containerId: "shape-0",
      text: "Label",
    });
    elements.push({ ...shape("deleted", 32), isDeleted: true });

    expect(buildCanvasVisualGuidance(elements)).toMatchObject({
      sceneStyle: "layered",
      visibleElementCount: 30,
      filledShapeCount: 30,
      distinctColorCount: 5,
      illustrationTarget: { matchExistingDetail: true },
    });
  });

  it("marks a small illustration call as a draft and a rich call as detailed", () => {
    expect(buildIllustrationQualityReminder(9)).toMatchObject({
      status: "draft-if-illustration",
      addedVisibleElementCount: 9,
      detailedIllustrationMinimum: 30,
    });
    expect(buildIllustrationQualityReminder(33)).toMatchObject({
      status: "detailed",
      addedVisibleElementCount: 33,
    });
  });
});
