import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { BrowserAnalytics } from "./analytics/browser-analytics";
import type {
  AnalyticsEvent,
  ToolExecutionAnalytics,
  WebMcpMode,
} from "./analytics/schema";
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
import { buildIllustrationQualityReminder } from "./core/visual-guidance";
import {
  AgentCursor,
  type AgentCursorViewport,
} from "./cursor/AgentCursor";
import {
  centerOfElements,
  cursorTravelDuration,
  splitIntoCursorStages,
  type AgentCursorActivity,
  type AgentCursorCommand,
  type ScenePoint,
} from "./cursor/agent-cursor-motion";
import type { ToolHandlers } from "./webmcp/registry";
import { useWebMcp } from "./webmcp/use-webmcp";
import "./styles.css";

const DEFAULT_AGENT_NAME = "AI Agent";
const AGENT_CURSOR_IDLE_MS = 2_200;
const AGENT_CURSOR_EXIT_MS = 180;
const AGENT_STAGE_SETTLE_MS = 90;
const MAX_AGENT_STAGES = 5;
type CaptureUpdateValue =
  (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction];

function asScene(elements: readonly ExcalidrawElement[]): SceneElementLike[] {
  return elements as unknown as SceneElementLike[];
}

function asExcalidraw(
  elements: readonly SceneElementLike[],
): ExcalidrawElement[] {
  return elements as unknown as ExcalidrawElement[];
}

function loadInitialWorkspace(): {
  elements: ExcalidrawElement[];
  hasSavedCanvas: boolean;
} {
  try {
    const workspace = loadWorkspace<SceneElementLike>(window.localStorage);
    return {
      elements: workspace ? asExcalidraw(workspace.elements) : [],
      hasSavedCanvas: Boolean(workspace),
    };
  } catch {
    return { elements: [], hasSavedCanvas: false };
  }
}

export default function App() {
  const initialWorkspaceRef = useRef(loadInitialWorkspace());
  const initialElementsRef = useRef<ExcalidrawElement[]>(
    initialWorkspaceRef.current.elements,
  );
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);
  const [cursorCommand, setCursorCommand] =
    useState<AgentCursorCommand | null>(null);
  const [cursorPresent, setCursorPresent] = useState(false);
  const [cursorViewport, setCursorViewport] =
    useState<AgentCursorViewport | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(api);
  const elementsRef = useRef<readonly ExcalidrawElement[]>(
    initialElementsRef.current,
  );
  const selectedIdsRef = useRef<string[]>(selectedIds);
  const agentNameRef = useRef(agentName);
  const cursorCommandRef = useRef<AgentCursorCommand | null>(cursorCommand);
  const cursorSequenceRef = useRef(0);
  const cursorViewportRef = useRef<AgentCursorViewport | null>(cursorViewport);
  const cursorIdleTimerRef = useRef<number | null>(null);
  const cursorExitTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const expectedAgentRevisionsRef = useRef(new Set<string>());
  const sceneObservationReadyRef = useRef(false);
  const lastObservedRevisionRef = useRef(
    sceneRevision(asScene(initialElementsRef.current)),
  );
  const lastObservedElementCountRef = useRef(
    readCanvasSnapshot(asScene(initialElementsRef.current)).elementCount,
  );
  const analyticsRef = useRef<BrowserAnalytics | null>(null);

  useEffect(() => {
    const testAnalytics = isLocalDevelopmentOrigin()
      ? window.__AGENT_CANVAS_ANALYTICS_TEST__
      : undefined;
    const analytics = new BrowserAnalytics({
      hasSavedCanvas: initialWorkspaceRef.current.hasSavedCanvas,
      initialElementCount: lastObservedElementCountRef.current,
      initialWebMcpMode: initialWebMcpMode(),
      enabled: testAnalytics?.enabled,
      deploymentEnvironment: testAnalytics ? "test" : undefined,
      transport: testAnalytics
        ? (event) => testAnalytics.capture(event)
        : undefined,
    });
    analyticsRef.current = analytics;
    return () => {
      analytics.dispose();
      if (analyticsRef.current === analytics) analyticsRef.current = null;
    };
  }, []);

  apiRef.current = api;
  selectedIdsRef.current = selectedIds;
  agentNameRef.current = agentName;
  cursorCommandRef.current = cursorCommand;

  const syncCursorViewport = useCallback((appState: AppState) => {
    const nextViewport = cursorViewportFromAppState(appState);
    if (sameCursorViewport(cursorViewportRef.current, nextViewport)) return;
    cursorViewportRef.current = nextViewport;
    setCursorViewport(nextViewport);
  }, []);

  const clearCursorTimers = useCallback(() => {
    if (cursorIdleTimerRef.current !== null) {
      window.clearTimeout(cursorIdleTimerRef.current);
      cursorIdleTimerRef.current = null;
    }
    if (cursorExitTimerRef.current !== null) {
      window.clearTimeout(cursorExitTimerRef.current);
      cursorExitTimerRef.current = null;
    }
  }, []);

  const scheduleCursorExit = useCallback(() => {
    clearCursorTimers();
    cursorIdleTimerRef.current = window.setTimeout(() => {
      setCursorPresent(false);
      cursorExitTimerRef.current = window.setTimeout(() => {
        cursorCommandRef.current = null;
        setCursorCommand(null);
        cursorExitTimerRef.current = null;
      }, AGENT_CURSOR_EXIT_MS);
      cursorIdleTimerRef.current = null;
    }, AGENT_CURSOR_IDLE_MS);
  }, [clearCursorTimers]);

  const showAgentCursor = useCallback(
    (
      target: ScenePoint,
      activity: AgentCursorActivity,
      label?: string,
    ) => {
      const command = {
        sequence: ++cursorSequenceRef.current,
        target,
        activity,
        label,
      } satisfies AgentCursorCommand;
      clearCursorTimers();
      cursorCommandRef.current = command;
      setCursorCommand(command);
      setCursorPresent(true);
      scheduleCursorExit();
      return command;
    },
    [clearCursorTimers, scheduleCursorExit],
  );

  const focusAgentCursor = useCallback(
    async (
      target: ScenePoint,
      activity: AgentCursorActivity,
      label?: string,
    ) => {
      const previous = cursorCommandRef.current?.target ?? {
        x: target.x - 120,
        y: target.y + 72,
      };
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const command = showAgentCursor(target, activity, label);
      if (!reduceMotion) {
        await wait(cursorTravelDuration(previous, target) + AGENT_STAGE_SETTLE_MS);
      }
      return command;
    },
    [showAgentCursor],
  );

  const setActiveAgentName = useCallback((name: string) => {
    agentNameRef.current = name;
    setAgentName(name);
  }, []);

  const readViewportCenter = useCallback((): ScenePoint => {
    const currentApi = apiRef.current;
    if (!currentApi || !rootElement) return { x: 320, y: 240 };
    const bounds = rootElement.getBoundingClientRect();
    return viewportCoordsToSceneCoords(
      {
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      },
      currentApi.getAppState(),
    );
  }, [rootElement]);

  const targetForElements = useCallback(
    (elements: readonly SceneElementLike[]) =>
      centerOfElements(elements) ?? readViewportCenter(),
    [readViewportCenter],
  );

  const readLiveElements = useCallback((): SceneElementLike[] => {
    const currentApi = apiRef.current;
    return currentApi
      ? asScene(currentApi.getSceneElementsIncludingDeleted())
      : asScene(elementsRef.current);
  }, []);

  const commitElements = useCallback(
    (
      elements: readonly SceneElementLike[],
      captureUpdate: CaptureUpdateValue = CaptureUpdateAction.IMMEDIATELY,
    ) => {
      const currentApi = apiRef.current;
      if (!currentApi) throw new Error("The Excalidraw canvas is not ready.");
      elementsRef.current = asExcalidraw(elements);
      const expectedRevisions = expectedAgentRevisionsRef.current;
      expectedRevisions.add(sceneRevision(elements));
      if (expectedRevisions.size > 20) {
        expectedRevisions.delete(expectedRevisions.values().next().value!);
      }
      currentApi.updateScene({
        elements: asExcalidraw(elements) as never,
        captureUpdate,
      });
    },
    [],
  );

  const toolHandlers = useMemo<ToolHandlers>(
    () => ({
      readCanvas: async () => {
        await focusAgentCursor(readViewportCenter(), "reading", "Reading canvas");
        return readCanvasSnapshot(readLiveElements());
      },
      readSelection: async () => {
        const initialSelected = new Set(selectedIdsRef.current);
        const initialLive = readLiveElements();
        await focusAgentCursor(
          targetForElements(
            initialLive.filter((element) => initialSelected.has(element.id)),
          ),
          "reading",
          "Reading selection",
        );
        const selected = new Set(selectedIdsRef.current);
        const live = readLiveElements();
        const snapshot = readCanvasSnapshot(live);
        return {
          selectedIds: [...selected],
          revision: snapshot.revision,
          elements: snapshot.elements.filter((element) =>
            selected.has(element.id),
          ),
        };
      },
      addElements: async (input) => {
        const initialLive = readLiveElements();
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
        const validatedResult = addCanvasElements(
          initialLive,
          materialized,
          frameAssignments,
        );
        const materializedGroups = input.elements.map((element) =>
          materialized.filter(
            (candidate) =>
              candidate.id === element.id || candidate.containerId === element.id,
          ),
        );
        const stages = splitIntoCursorStages(
          materializedGroups,
          MAX_AGENT_STAGES,
        ).map((stage) => stage.flat());
        const hiddenMaterialized = materialized.map((element) => ({
          ...element,
          opacity: 0,
        }));
        const finalById = new Map(
          materialized.map((element) => [element.id, element]),
        );
        let result = validatedResult;

        for (const [index, stage] of stages.entries()) {
          await focusAgentCursor(
            targetForElements(stage),
            "editing",
            `Drawing ${index + 1}/${stages.length}`,
          );
          if (index === 0) {
            result = addCanvasElements(
              readLiveElements(),
              hiddenMaterialized,
              frameAssignments,
            );
            commitElements(result.elements, CaptureUpdateAction.IMMEDIATELY);
          }
          result = {
            elements: revealStagedElements(
              readLiveElements(),
              finalById,
              new Set(stage.map((element) => element.id)),
            ),
            addedIds: result.addedIds,
          };
          commitElements(result.elements, CaptureUpdateAction.NEVER);
          await waitForStagePaint();
        }

        await focusAgentCursor(
          targetForElements(materialized),
          "reading",
          "Checking",
        );
        return {
          addedElementIds: input.elements.map((element) => element.id),
          materializedElementIds: result.addedIds,
          illustrationQuality: buildIllustrationQualityReminder(
            input.elements.length,
          ),
          revision: sceneRevision(result.elements),
        };
      },
      updateElements: async (input) => {
        const validatedResult = updateCanvasElements(
          readLiveElements(),
          input.updates,
        );
        const updatedIds = new Set(validatedResult.updatedIds);
        await focusAgentCursor(
          targetForElements(
            validatedResult.elements.filter((element) =>
              updatedIds.has(element.id),
            ),
          ),
          "editing",
          input.updates.length === 1 ? "Updating" : `Updating ${input.updates.length}`,
        );
        const result = updateCanvasElements(readLiveElements(), input.updates);
        commitElements(result.elements);
        await waitForStagePaint();
        return {
          updatedElementIds: result.updatedIds,
          revision: sceneRevision(result.elements),
        };
      },
      deleteElements: async (input) => {
        const initialLive = readLiveElements();
        const requestedIds = new Set(input.ids);
        deleteCanvasElements(initialLive, input.ids);
        await focusAgentCursor(
          targetForElements(
            initialLive.filter((element) => requestedIds.has(element.id)),
          ),
          "editing",
          input.ids.length === 1 ? "Removing" : `Removing ${input.ids.length}`,
        );
        const result = deleteCanvasElements(readLiveElements(), input.ids);
        commitElements(result.elements);
        await waitForStagePaint();
        return {
          deletedElementIds: result.deletedIds,
          cascadeDeletedElementIds: result.cascadeDeletedIds,
          revision: sceneRevision(result.elements),
        };
      },
      connectElements: async (input) => {
        const live = readLiveElements();
        const materialized = materializeConnections(live, input.connections);
        const connections = input.connections.map((connection) => ({
          arrowId: connection.id,
          fromId: connection.fromId,
          toId: connection.toId,
        }));
        connectCanvasElements(live, materialized, connections);
        await focusAgentCursor(
          targetForElements(materialized),
          "editing",
          input.connections.length === 1
            ? "Connecting"
            : `Connecting ${input.connections.length}`,
        );
        const currentLive = readLiveElements();
        const currentMaterialized = materializeConnections(
          currentLive,
          input.connections,
        );
        const result = connectCanvasElements(
          currentLive,
          currentMaterialized,
          connections,
        );
        commitElements(result.elements);
        await waitForStagePaint();
        return {
          addedConnectionIds: input.connections.map(
            (connection) => connection.id,
          ),
          materializedElementIds: result.addedIds,
          revision: sceneRevision(result.elements),
        };
      },
      moveAgentCursor: (input) => {
        const command = showAgentCursor(
          { x: input.x, y: input.y },
          input.activity ?? "moving",
        );
        return {
          agent: agentNameRef.current,
          x: command.target.x,
          y: command.target.y,
          activity: command.activity,
          sequence: command.sequence,
        };
      },
      setAgentIdentity: (input) => {
        setActiveAgentName(input.name);
        return { agent: input.name };
      },
    }),
    [
      commitElements,
      focusAgentCursor,
      readViewportCenter,
      readLiveElements,
      showAgentCursor,
      setActiveAgentName,
      targetForElements,
    ],
  );

  const handleToolExecution = useCallback(
    (execution: ToolExecutionAnalytics) => {
      const elementCount = readCanvasSnapshot(readLiveElements()).elementCount;
      analyticsRef.current?.trackToolExecution(execution, elementCount);
    },
    [readLiveElements],
  );

  const webMcp = useWebMcp(toolHandlers, {
    hasSelection: selectedIds.length > 0,
    onToolExecution: handleToolExecution,
  });

  useEffect(() => {
    if (!webMcp.capabilityResolved) return;
    analyticsRef.current?.trackCapability(
      webMcp.capability === "registration-error"
        ? "registration_error"
        : webMcp.capability,
      webMcp.tools.length,
    );
  }, [webMcp.capability, webMcp.capabilityResolved, webMcp.tools.length]);

  const handleChange = useCallback(
    (nextElements: readonly ExcalidrawElement[], nextAppState: AppState) => {
      elementsRef.current = nextElements;
      const nextScene = asScene(nextElements);
      const nextRevision = sceneRevision(nextScene);
      const nextElementCount = readCanvasSnapshot(nextScene).elementCount;
      if (!sceneObservationReadyRef.current) {
        sceneObservationReadyRef.current = true;
      } else if (nextRevision !== lastObservedRevisionRef.current) {
        const isAgentChange = expectedAgentRevisionsRef.current.delete(nextRevision);
        if (!isAgentChange) {
          analyticsRef.current?.recordHumanCanvasEdit(
            lastObservedElementCountRef.current,
            nextElementCount,
          );
        }
      }
      lastObservedRevisionRef.current = nextRevision;
      lastObservedElementCountRef.current = nextElementCount;
      syncCursorViewport(nextAppState);
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
    [syncCursorViewport],
  );

  useEffect(() => {
    if (!api) return;
    api.history.clear();
    syncCursorViewport(api.getAppState());
    return api.onScrollChange(() => syncCursorViewport(api.getAppState()));
  }, [api, syncCursorViewport]);

  useEffect(() => {
    window.__AGENT_CANVAS_TEST__ = {
      getState: () => readCanvasSnapshot(readLiveElements()),
      getAgentCursor: () => cursorCommandRef.current,
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
      clearCursorTimers();
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [clearCursorTimers, readLiveElements]);

  return (
    <main
      ref={setRootElement}
      className="canvas-root"
      aria-label="Excalidraw canvas"
    >
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={{
          elements: initialElementsRef.current,
          appState: { viewBackgroundColor: "#ffffff" },
        }}
        onChange={handleChange}
      />
      <AgentCursor
        agentName={agentName}
        command={cursorCommand}
        present={cursorPresent}
        viewport={cursorViewport}
        root={rootElement}
      />
    </main>
  );
}

function initialWebMcpMode(): WebMcpMode {
  const modelContext = (
    document as Document & {
      modelContext?: { registerTool?: unknown };
    }
  ).modelContext;
  return modelContext && typeof modelContext.registerTool === "function"
    ? "native"
    : "adapter";
}

function isLocalDevelopmentOrigin(): boolean {
  return ["127.0.0.1", "localhost"].includes(window.location.hostname);
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
  angle?: number;
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
    angle: element.angle,
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

function materializeConnections(
  live: readonly SceneElementLike[],
  connections: readonly {
    id: string;
    fromId: string;
    toId: string;
    label?: string;
    strokeColor?: string;
    strokeStyle?: "solid" | "dashed" | "dotted";
  }[],
): SceneElementLike[] {
  const liveById = new Map(
    live
      .filter((element) => !element.isDeleted)
      .map((element) => [element.id, element]),
  );
  const skeletons = connections.map((connection) => {
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
  return asScene(
    convertToExcalidrawElements(skeletons as never, {
      regenerateIds: false,
    }) as ExcalidrawElement[],
  );
}

function binding(elementId: string) {
  return { elementId, focus: 0, gap: 1, fixedPoint: null };
}

function cursorViewportFromAppState(
  appState: AppState,
): AgentCursorViewport {
  return {
    zoom: appState.zoom,
    offsetLeft: appState.offsetLeft,
    offsetTop: appState.offsetTop,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
  };
}

function sameCursorViewport(
  current: AgentCursorViewport | null,
  next: AgentCursorViewport,
): boolean {
  return Boolean(
    current &&
      current.zoom.value === next.zoom.value &&
      current.offsetLeft === next.offsetLeft &&
      current.offsetTop === next.offsetTop &&
      current.scrollX === next.scrollX &&
      current.scrollY === next.scrollY,
  );
}

function revealStagedElements(
  elements: readonly SceneElementLike[],
  finalById: ReadonlyMap<string, SceneElementLike>,
  revealIds: ReadonlySet<string>,
): SceneElementLike[] {
  const now = Date.now();
  return elements.map((element) => {
    if (!revealIds.has(element.id)) return element;
    const finalElement = finalById.get(element.id);
    if (!finalElement) return element;
    return {
      ...element,
      ...finalElement,
      frameId: element.frameId ?? finalElement.frameId,
      version: Math.max(element.version ?? 0, finalElement.version ?? 0) + 1,
      versionNonce: ((element.versionNonce ?? 0) + 1) >>> 0,
      updated: now,
    };
  });
}

function waitForStagePaint(): Promise<void> {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? Promise.resolve()
    : wait(AGENT_STAGE_SETTLE_MS);
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

declare global {
  interface Window {
    __AGENT_CANVAS_TEST__?: {
      getState(): unknown;
      getAgentCursor(): AgentCursorCommand | null;
      selectElements(ids: string[]): void;
    };
    __AGENT_CANVAS_ANALYTICS_TEST__?: {
      enabled: boolean;
      events: AnalyticsEvent[];
      capture(event: AnalyticsEvent): void;
    };
  }
}
