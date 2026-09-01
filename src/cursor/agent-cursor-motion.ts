import type { SceneElementLike } from "../core/types";

export interface ScenePoint {
  x: number;
  y: number;
}

export type AgentCursorActivity =
  | "moving"
  | "thinking"
  | "reading"
  | "editing";

export interface AgentCursorCommand {
  sequence: number;
  target: ScenePoint;
  activity: AgentCursorActivity;
  label?: string;
}

const MIN_TRAVEL_MS = 280;
const MAX_TRAVEL_MS = 900;

export function cursorTravelDuration(
  from: ScenePoint,
  to: ScenePoint,
): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.min(MAX_TRAVEL_MS, Math.max(MIN_TRAVEL_MS, 240 + distance * 0.7));
}

export function pointOnCursorPath(
  from: ScenePoint,
  to: ScenePoint,
  progress: number,
  curveDirection: 1 | -1,
): ScenePoint {
  const boundedProgress = Math.min(1, Math.max(0, progress));
  const easedProgress = 1 - Math.pow(1 - boundedProgress, 3);
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.hypot(deltaX, deltaY);
  const curve = Math.min(54, distance * 0.12) * curveDirection;
  const normalX = distance === 0 ? 0 : -deltaY / distance;
  const normalY = distance === 0 ? 0 : deltaX / distance;
  const control = {
    x: from.x + deltaX * 0.5 + normalX * curve,
    y: from.y + deltaY * 0.5 + normalY * curve,
  };
  const inverse = 1 - easedProgress;

  return {
    x:
      inverse * inverse * from.x +
      2 * inverse * easedProgress * control.x +
      easedProgress * easedProgress * to.x,
    y:
      inverse * inverse * from.y +
      2 * inverse * easedProgress * control.y +
      easedProgress * easedProgress * to.y,
  };
}

export function centerOfElements(
  elements: readonly Pick<
    SceneElementLike,
    "x" | "y" | "width" | "height" | "isDeleted"
  >[],
): ScenePoint | null {
  const live = elements.filter((element) => !element.isDeleted);
  if (live.length === 0) return null;

  const bounds = live.reduce(
    (current, element) => ({
      minX: Math.min(current.minX, element.x),
      minY: Math.min(current.minY, element.y),
      maxX: Math.max(current.maxX, element.x + element.width),
      maxY: Math.max(current.maxY, element.y + element.height),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );

  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function splitIntoCursorStages<T>(
  items: readonly T[],
  maxStages = 5,
): T[][] {
  if (items.length === 0) return [];

  const stageCount = Math.max(1, Math.min(Math.floor(maxStages), items.length));
  const baseSize = Math.floor(items.length / stageCount);
  const remainder = items.length % stageCount;
  const stages: T[][] = [];
  let start = 0;

  for (let index = 0; index < stageCount; index += 1) {
    const size = baseSize + (index < remainder ? 1 : 0);
    stages.push(items.slice(start, start + size));
    start += size;
  }

  return stages;
}
