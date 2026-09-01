import type { SceneElementLike } from "./types";

export const DETAILED_ILLUSTRATION_MIN_ELEMENTS = 30;
export const ADD_ELEMENTS_MAX_ELEMENTS = 50;

export interface CanvasVisualGuidance {
  sceneStyle: "empty" | "simple" | "layered";
  visibleElementCount: number;
  filledShapeCount: number;
  distinctColorCount: number;
  illustrationTarget: {
    minimumElements: number;
    maximumElementsPerCall: number;
    matchExistingDetail: boolean;
  };
  instructions: string[];
}

export interface IllustrationQualityReminder {
  addedVisibleElementCount: number;
  detailedIllustrationMinimum: number;
  status: "detailed" | "draft-if-illustration";
  instruction: string;
}

const SHAPE_TYPES = new Set(["rectangle", "diamond", "ellipse"]);

export function buildCanvasVisualGuidance(
  elements: readonly SceneElementLike[],
): CanvasVisualGuidance {
  const visible = elements.filter(
    (element) =>
      !element.isDeleted &&
      !(element.type === "text" && typeof element.containerId === "string"),
  );
  const filledShapeCount = visible.filter(
    (element) =>
      SHAPE_TYPES.has(element.type) &&
      typeof element.backgroundColor === "string" &&
      element.backgroundColor !== "transparent",
  ).length;
  const distinctColors = new Set(
    visible.flatMap((element) =>
      [element.strokeColor, element.backgroundColor].filter(
        (color): color is string =>
          typeof color === "string" && color !== "transparent",
      ),
    ),
  );
  const sceneStyle =
    visible.length === 0
      ? "empty"
      : visible.length >= 20 &&
          filledShapeCount >= 10 &&
          distinctColors.size >= 4
        ? "layered"
        : "simple";

  return {
    sceneStyle,
    visibleElementCount: visible.length,
    filledShapeCount,
    distinctColorCount: distinctColors.size,
    illustrationTarget: {
      minimumElements: DETAILED_ILLUSTRATION_MIN_ELEMENTS,
      maximumElementsPerCall: ADD_ELEMENTS_MAX_ELEMENTS,
      matchExistingDetail: sceneStyle === "layered",
    },
    instructions: [
      "For an illustration, match the scale, colors, fills, and detail of nearby artwork.",
      `A finished illustrated subject needs ${DETAILED_ILLUSTRATION_MIN_ELEMENTS}-${ADD_ELEMENTS_MAX_ELEMENTS} purposeful visible elements. Do not stop at an outline or wireframe.`,
      "Build a filled silhouette with layered parts, facial or focal details, accents, highlights, and a ground shadow when they fit the subject.",
      `Use another add_elements call when a finished scene needs more than ${ADD_ELEMENTS_MAX_ELEMENTS} elements.`,
      "Keep flowcharts and structural diagrams concise when that is the user's intent.",
    ],
  };
}

export function buildIllustrationQualityReminder(
  addedVisibleElementCount: number,
): IllustrationQualityReminder {
  const detailed =
    addedVisibleElementCount >= DETAILED_ILLUSTRATION_MIN_ELEMENTS;
  return {
    addedVisibleElementCount,
    detailedIllustrationMinimum: DETAILED_ILLUSTRATION_MIN_ELEMENTS,
    status: detailed ? "detailed" : "draft-if-illustration",
    instruction: detailed
      ? "This call meets the element-count target for one detailed illustrated subject. Read the canvas and check the visible result before completion."
      : `If the user requested an illustration, this is still a simple draft. Continue adding layered detail until the subject has at least ${DETAILED_ILLUSTRATION_MIN_ELEMENTS} purposeful visible elements.`,
  };
}
