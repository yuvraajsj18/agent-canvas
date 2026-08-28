import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import {
  addCanvasElements,
  connectCanvasElements,
  deleteCanvasElements,
  readCanvasSnapshot,
  sceneRevision,
  updateCanvasElements,
} from "./core/canvas-ops";
import { loadWorkspace, saveWorkspace } from "./core/storage";
import type { SceneElementLike } from "./core/types";
import type { ToolHandlers } from "./webmcp/registry";
import { useWebMcp } from "./webmcp/use-webmcp";
import "./styles.css";

function asScene(elements: readonly ExcalidrawElement[]): SceneElementLike[] {
  return elements as unknown as SceneElementLike[];
}

function asExcalidraw(
  elements: readonly SceneElementLike[],
): ExcalidrawElement[] {
  return elements as unknown as ExcalidrawElement[];
}

function loadInitialElements(): ExcalidrawElement[] {
  try {
    const workspace = loadWorkspace<SceneElementLike>(window.localStorage);
    return workspace ? asExcalidraw(workspace.elements) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const initialElementsRef = useRef<ExcalidrawElement[]>(loadInitialElements());
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(api);
  const elementsRef = useRef<readonly ExcalidrawElement[]>(
    initialElementsRef.current,
  );
  const selectedIdsRef = useRef<string[]>(selectedIds);
  const saveTimerRef = useRef<number | null>(null);

  apiRef.current = api;
  selectedIdsRef.current = selectedIds;

  const readLiveElements = useCallback((): SceneElementLike[] => {
    const currentApi = apiRef.current;
    return currentApi
      ? asScene(currentApi.getSceneElementsIncludingDeleted())
      : asScene(elementsRef.current);
  }, []);

  const commitElements = useCallback((elements: readonly SceneElementLike[]) => {
    const currentApi = apiRef.current;
    if (!currentApi) throw new Error("The Excalidraw canvas is not ready.");
    elementsRef.current = asExcalidraw(elements);
    currentApi.updateScene({
      elements: asExcalidraw(elements) as never,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, []);

  const toolHandlers = useMemo<ToolHandlers>(
    () => ({
      readCanvas: () => readCanvasSnapshot(readLiveElements()),
      readSelection: () => {
        const selected = new Set(selectedIdsRef.current);
        const snapshot = readCanvasSnapshot(readLiveElements());
        return {
          selectedIds: [...selected],
          revision: snapshot.revision,
          elements: snapshot.elements.filter((element) =>
            selected.has(element.id),
          ),
        };
      },
      addElements: (input) => {
        const live = readLiveElements();
        const skeletons = input.elements.map((element) =>
          toElementSkeleton(element),
        );
        const materialized = asScene(
          convertToExcalidrawElements(skeletons as never, {
            regenerateIds: false,
          }) as ExcalidrawElement[],
        );
        const frameAssignments = input.elements
          .filter((element) => element.type === "frame")
          .map((element) => ({
            frameId: element.id,
            childIds: element.children ?? [],
          }));
        const result = addCanvasElements(
          live,
          materialized,
          frameAssignments,
        );
        commitElements(result.elements);
        return {
          addedElementIds: input.elements.map((element) => element.id),
          materializedElementIds: result.addedIds,
          revision: sceneRevision(result.elements),
        };
      },
      updateElements: (input) => {
        const result = updateCanvasElements(
          readLiveElements(),
          input.updates,
        );
        commitElements(result.elements);
        return {
          updatedElementIds: result.updatedIds,
          revision: sceneRevision(result.elements),
        };
      },
      deleteElements: (input) => {
        const result = deleteCanvasElements(readLiveElements(), input.ids);
        commitElements(result.elements);
        return {
          deletedElementIds: result.deletedIds,
          cascadeDeletedElementIds: result.cascadeDeletedIds,
          revision: sceneRevision(result.elements),
        };
      },
      connectElements: (input) => {
        const live = readLiveElements();
        const liveById = new Map(
          live.filter((element) => !element.isDeleted).map((element) => [element.id, element]),
        );
        const skeletons = input.connections.map((connection) => {
          const start = liveById.get(connection.fromId);
          const end = liveById.get(connection.toId);
          if (!start) {
            throw new Error(`Unknown live connection endpoint: ${connection.fromId}`);
          }
          if (!end) {
            throw new Error(`Unknown live connection endpoint: ${connection.toId}`);
          }
          const startX = start.x + start.width / 2;
          const startY = start.y + start.height / 2;
          const endX = end.x + end.width / 2;
          const endY = end.y + end.height / 2;
          return {
            id: connection.id,
            type: "arrow",
            x: startX,
            y: startY,
            width: endX - startX,
            height: endY - startY,
            points: [
              [0, 0],
              [endX - startX, endY - startY],
            ],
            startBinding: binding(connection.fromId),
            endBinding: binding(connection.toId),
            endArrowhead: "arrow",
            strokeColor: connection.strokeColor,
            strokeStyle: connection.strokeStyle,
            label: connection.label
              ? { text: connection.label, fontSize: 16 }
              : undefined,
          };
        });
        const materialized = asScene(
          convertToExcalidrawElements(skeletons as never, {
            regenerateIds: false,
          }) as ExcalidrawElement[],
        );
        const result = connectCanvasElements(
          live,
          materialized,
          input.connections.map((connection) => ({
            arrowId: connection.id,
            fromId: connection.fromId,
            toId: connection.toId,
          })),
        );
        commitElements(result.elements);
        return {
          addedConnectionIds: input.connections.map(
            (connection) => connection.id,
          ),
          materializedElementIds: result.addedIds,
          revision: sceneRevision(result.elements),
        };
      },
    }),
    [commitElements, readLiveElements],
  );

  useWebMcp(toolHandlers, { hasSelection: selectedIds.length > 0 });

  const handleChange = useCallback(
    (nextElements: readonly ExcalidrawElement[], nextAppState: AppState) => {
      elementsRef.current = nextElements;
      const nextSelectedIds = Object.entries(nextAppState.selectedElementIds)
        .filter(([, selected]) => selected)
        .map(([id]) => id)
        .sort();
      if (nextSelectedIds.join("|") !== selectedIdsRef.current.join("|")) {
        selectedIdsRef.current = nextSelectedIds;
        setSelectedIds(nextSelectedIds);
      }

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        try {
          saveWorkspace(window.localStorage, {
            elements: asScene(elementsRef.current),
            savedAt: Date.now(),
          });
        } catch {
          // The canvas stays usable if browser storage is unavailable.
        }
      }, 200);
    },
    [],
  );

  useEffect(() => {
    if (!api) return;
    api.history.clear();
  }, [api]);

  useEffect(() => {
    window.__AGENT_CANVAS_TEST__ = {
      getState: () => readCanvasSnapshot(readLiveElements()),
      selectElements: (ids) => {
        const currentApi = apiRef.current;
        if (!currentApi) throw new Error("The Excalidraw canvas is not ready.");
        currentApi.updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(
              ids.map((id) => [id, true]),
            ),
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      },
    };
    return () => {
      delete window.__AGENT_CANVAS_TEST__;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [readLiveElements]);

  return (
    <main className="canvas-root" aria-label="Excalidraw canvas">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={{
          elements: initialElementsRef.current,
          appState: { viewBackgroundColor: "#ffffff" },
        }}
        onChange={handleChange}
      />
    </main>
  );
}

function toElementSkeleton(element: {
  id: string;
  type: "rectangle" | "diamond" | "ellipse" | "text" | "frame";
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  strokeStyle?: "solid" | "dashed" | "dotted";
  fillStyle?: "solid" | "hachure" | "cross-hatch";
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  locked?: boolean;
  children?: string[];
}) {
  const common = {
    id: element.id,
    type: element.type,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    strokeStyle: element.strokeStyle,
    fillStyle: element.fillStyle,
    strokeWidth: element.strokeWidth,
    roughness: element.roughness,
    opacity: element.opacity,
    locked: element.locked,
  };
  if (element.type === "text") {
    return { ...common, type: "text", text: element.text };
  }
  if (element.type === "frame") {
    return {
      ...common,
      type: "frame",
      name: element.text,
      children: element.children ?? [],
    };
  }
  return {
    ...common,
    label: element.text ? { text: element.text, fontSize: 20 } : undefined,
  };
}

function binding(elementId: string) {
  return { elementId, focus: 0, gap: 1, fixedPoint: null };
}

declare global {
  interface Window {
    __AGENT_CANVAS_TEST__?: {
      getState(): unknown;
      selectElements(ids: string[]): void;
    };
  }
}
