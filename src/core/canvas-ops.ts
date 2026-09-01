import { stableId } from "./ids";
import type { SceneElementLike } from "./types";
import { buildCanvasVisualGuidance } from "./visual-guidance";

export interface CanvasElementUpdate {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  strokeStyle?: "solid" | "dashed" | "dotted";
  fillStyle?: "solid" | "hachure" | "cross-hatch";
  opacity?: number;
  locked?: boolean;
}

export interface CanvasMutationResult<T extends SceneElementLike> {
  elements: T[];
  updatedIds: string[];
}

export interface FrameAssignment {
  frameId: string;
  childIds: string[];
}

export interface CanvasAddResult<T extends SceneElementLike> {
  elements: T[];
  addedIds: string[];
}

export interface CanvasConnection {
  arrowId: string;
  fromId: string;
  toId: string;
}

export interface CanvasDeleteResult<T extends SceneElementLike> {
  elements: T[];
  deletedIds: string[];
  cascadeDeletedIds: string[];
}

export class LockedElementError extends Error {
  constructor(public readonly elementId: string) {
    super(`Locked element cannot be changed: ${elementId}`);
    this.name = "LockedElementError";
  }
}

export function sceneRevision(elements: readonly SceneElementLike[]): string {
  return stableId(
    "scene",
    elements
      .filter((item) => !item.isDeleted)
      .map((item) => [
        item.id,
        item.type,
        item.x,
        item.y,
        item.width,
        item.height,
        item.angle ?? 0,
        item.version ?? 0,
        item.frameId ?? null,
        item.locked ?? false,
        typeof item.text === "string" ? item.text : null,
        typeof item.containerId === "string" ? item.containerId : null,
        bindingId(item.startBinding),
        bindingId(item.endBinding),
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

export function readCanvasSnapshot(elements: readonly SceneElementLike[]) {
  const live = elements.filter((item) => !item.isDeleted);
  const parents = live.filter(
    (item) => item.type !== "text" || typeof item.containerId !== "string",
  );
  return {
    revision: sceneRevision(live),
    elementCount: parents.length,
    visualGuidance: buildCanvasVisualGuidance(live),
    elements: parents.map((item) => compactElement(item, live)),
  };
}

export function addCanvasElements<T extends SceneElementLike>(
  currentElements: readonly T[],
  materializedElements: readonly T[],
  frameAssignments: readonly FrameAssignment[] = [],
  now = Date.now(),
): CanvasAddResult<T> {
  const existingIds = new Set(currentElements.map((item) => item.id));
  const addedIds = new Set<string>();
  for (const element of materializedElements) {
    if (existingIds.has(element.id) || addedIds.has(element.id)) {
      throw new Error(`Element ID already exists: ${element.id}`);
    }
    addedIds.add(element.id);
  }

  const combined = [...currentElements, ...materializedElements];
  const combinedById = new Map(combined.map((item) => [item.id, item]));
  const frameByChildId = new Map<string, string>();
  for (const assignment of frameAssignments) {
    const frame = combinedById.get(assignment.frameId);
    if (!frame || frame.type !== "frame" || frame.isDeleted) {
      throw new Error(`Unknown live frame: ${assignment.frameId}`);
    }
    for (const childId of assignment.childIds) {
      const child = combinedById.get(childId);
      if (!child || child.isDeleted) {
        throw new Error(`Unknown live frame child: ${childId}`);
      }
      if (child.locked && !addedIds.has(childId)) {
        throw new LockedElementError(childId);
      }
      frameByChildId.set(childId, assignment.frameId);
    }
  }

  const elements = combined.map((element) => {
    const parentId =
      typeof element.containerId === "string" ? element.containerId : element.id;
    const frameId = frameByChildId.get(parentId);
    return frameId ? bumpElement(element, { frameId }, now) : element;
  });

  return { elements, addedIds: [...addedIds] };
}

export function connectCanvasElements<T extends SceneElementLike>(
  currentElements: readonly T[],
  materializedElements: readonly T[],
  connections: readonly CanvasConnection[],
  now = Date.now(),
): CanvasAddResult<T> {
  const currentById = new Map(currentElements.map((item) => [item.id, item]));
  const materializedIds = new Set(materializedElements.map((item) => item.id));
  for (const connection of connections) {
    if (!materializedIds.has(connection.arrowId)) {
      throw new Error(`Missing materialized arrow: ${connection.arrowId}`);
    }
    for (const endpointId of [connection.fromId, connection.toId]) {
      const endpoint = currentById.get(endpointId);
      if (!endpoint || endpoint.isDeleted) {
        throw new Error(`Unknown live connection endpoint: ${endpointId}`);
      }
      if (endpoint.locked) throw new LockedElementError(endpointId);
    }
  }

  const added = addCanvasElements(currentElements, materializedElements, [], now);
  const connectionByArrowId = new Map(
    connections.map((connection) => [connection.arrowId, connection]),
  );
  const elements = added.elements.map((element) => {
    const connection = connectionByArrowId.get(element.id);
    if (connection) {
      return {
        ...element,
        startBinding: binding(connection.fromId),
        endBinding: binding(connection.toId),
      } as T;
    }
    const endpointConnections = connections.filter(
      (candidate) =>
        candidate.fromId === element.id || candidate.toId === element.id,
    );
    return endpointConnections.reduce(
      (next, candidate) => addBoundElement(next, candidate.arrowId, now),
      element,
    );
  });

  return { elements, addedIds: added.addedIds };
}

export function deleteCanvasElements<T extends SceneElementLike>(
  currentElements: readonly T[],
  requestedIds: readonly string[],
  now = Date.now(),
): CanvasDeleteResult<T> {
  const currentById = new Map(currentElements.map((item) => [item.id, item]));
  const deletedIds = [...new Set(requestedIds)];
  const toDelete = new Set(deletedIds);
  for (const id of deletedIds) {
    const target = currentById.get(id);
    if (!target || target.isDeleted) throw new Error(`Unknown live element: ${id}`);
    if (target.locked) throw new LockedElementError(id);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const element of currentElements) {
      if (toDelete.has(element.id)) continue;
      const isBoundText =
        typeof element.containerId === "string" &&
        toDelete.has(element.containerId);
      const isConnectedArrow =
        element.type === "arrow" &&
        [bindingId(element.startBinding), bindingId(element.endBinding)].some(
          (id) => id && toDelete.has(id),
        );
      if (isBoundText || isConnectedArrow) {
        toDelete.add(element.id);
        changed = true;
      }
    }
  }

  const elements = currentElements.map((element) => {
    if (toDelete.has(element.id)) {
      return bumpElement(element, { isDeleted: true }, now);
    }

    const patch: Record<string, unknown> = {};
    const currentBindings = element.boundElements ?? [];
    const nextBindings = currentBindings.filter((binding) => !toDelete.has(binding.id));
    if (nextBindings.length !== currentBindings.length) {
      patch.boundElements = nextBindings;
    }
    if (typeof element.frameId === "string" && toDelete.has(element.frameId)) {
      patch.frameId = null;
    }
    return Object.keys(patch).length ? bumpElement(element, patch, now) : element;
  });

  return {
    elements,
    deletedIds,
    cascadeDeletedIds: [...toDelete]
      .filter((id) => !deletedIds.includes(id))
      .sort(),
  };
}

export function updateCanvasElements<T extends SceneElementLike>(
  currentElements: readonly T[],
  updates: readonly CanvasElementUpdate[],
  now = Date.now(),
): CanvasMutationResult<T> {
  const currentById = new Map(currentElements.map((item) => [item.id, item]));
  const updatesById = new Map(updates.map((update) => [update.id, update]));

  for (const update of updates) {
    const target = currentById.get(update.id);
    if (!target || target.isDeleted) {
      throw new Error(`Unknown live element: ${update.id}`);
    }
    if (target.locked) {
      throw new LockedElementError(update.id);
    }
  }

  const elements = currentElements.map((element) => {
    const directUpdate = updatesById.get(element.id);
    if (directUpdate) {
      return bumpElement(element, patchForElement(element, directUpdate), now);
    }

    if (typeof element.containerId !== "string") return element;
    const container = currentById.get(element.containerId);
    const containerUpdate = updatesById.get(element.containerId);
    if (!container || !containerUpdate) return element;

    const patch: Record<string, unknown> = {};
    if (typeof containerUpdate.x === "number") {
      patch.x = element.x + containerUpdate.x - container.x;
    }
    if (typeof containerUpdate.y === "number") {
      patch.y = element.y + containerUpdate.y - container.y;
    }
    if (typeof containerUpdate.text === "string") {
      patch.text = containerUpdate.text;
      patch.originalText = containerUpdate.text;
      patch.rawText = containerUpdate.text;
    }

    return Object.keys(patch).length ? bumpElement(element, patch, now) : element;
  });

  return { elements, updatedIds: updates.map((update) => update.id) };
}

function patchForElement(
  element: SceneElementLike,
  update: CanvasElementUpdate,
): Record<string, unknown> {
  const { text } = update;
  const patch = Object.fromEntries(
    Object.entries(update).filter(
      ([key, value]) => key !== "id" && key !== "text" && value !== undefined,
    ),
  );
  if (typeof text === "string" && element.type === "text") {
    patch.text = text;
    patch.originalText = text;
    patch.rawText = text;
  }
  return patch;
}

function bumpElement<T extends SceneElementLike>(
  element: T,
  patch: Record<string, unknown>,
  now: number,
): T {
  return {
    ...element,
    ...patch,
    version: (element.version ?? 0) + 1,
    versionNonce: nextVersionNonce(element.versionNonce),
    updated: now,
  };
}

function nextVersionNonce(current: number | undefined): number {
  return ((current ?? 0) + 1) >>> 0;
}

function binding(elementId: string) {
  return { elementId, focus: 0, gap: 1, fixedPoint: null };
}

function compactElement(
  element: SceneElementLike,
  scene: readonly SceneElementLike[],
) {
  const boundText =
    element.type === "text"
      ? element
      : scene.find(
          (candidate) =>
            candidate.type === "text" && candidate.containerId === element.id,
        );
  return {
    id: element.id,
    type: element.type,
    x: Math.round(element.x),
    y: Math.round(element.y),
    width: Math.round(element.width),
    height: Math.round(element.height),
    angle: element.angle ?? 0,
    version: element.version ?? 0,
    locked: Boolean(element.locked),
    frameId: element.frameId ?? null,
    text:
      typeof boundText?.text === "string"
        ? boundText.text.slice(0, 1_000)
        : undefined,
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    strokeStyle: element.strokeStyle,
    fillStyle: element.fillStyle,
    opacity: element.opacity,
    startId: bindingId(element.startBinding),
    endId: bindingId(element.endBinding),
    boundElementIds: (element.boundElements ?? []).map((item) => item.id),
  };
}

function bindingId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const elementId = (value as { elementId?: unknown }).elementId;
  return typeof elementId === "string" ? elementId : null;
}

function addBoundElement<T extends SceneElementLike>(
  element: T,
  arrowId: string,
  now: number,
): T {
  const existing = element.boundElements ?? [];
  if (existing.some((item) => item.id === arrowId)) return element;
  return bumpElement(
    element,
    { boundElements: [...existing, { id: arrowId, type: "arrow" }] },
    now,
  );
}
