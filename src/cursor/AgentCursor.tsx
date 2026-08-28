import { sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import { useEffect, useRef, useState } from "react";
import type { AppState } from "@excalidraw/excalidraw/types";
import {
  cursorTravelDuration,
  pointOnCursorPath,
  type AgentCursorActivity,
  type AgentCursorCommand,
  type ScenePoint,
} from "./agent-cursor-motion";

export type AgentCursorViewport = Pick<
  AppState,
  "zoom" | "offsetLeft" | "offsetTop" | "scrollX" | "scrollY"
>;

interface AgentCursorProps {
  command: AgentCursorCommand | null;
  viewport: AgentCursorViewport | null;
  root: HTMLElement | null;
}

export function AgentCursor({ command, viewport, root }: AgentCursorProps) {
  const [scenePosition, setScenePosition] = useState<ScenePoint | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const positionRef = useRef<ScenePoint | null>(null);

  useEffect(() => {
    if (!command) return;

    const target = command.target;
    const start = positionRef.current ?? {
      x: target.x - 120,
      y: target.y + 72,
    };
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frameId = 0;

    if (reduceMotion) {
      positionRef.current = target;
      setScenePosition(target);
      setIsMoving(false);
      return;
    }

    const duration = cursorTravelDuration(start, target);
    const curveDirection = command.sequence % 2 === 0 ? 1 : -1;
    let startedAt: number | null = null;
    setIsMoving(true);

    const drawFrame = (time: number) => {
      startedAt ??= time;
      const progress = Math.min(1, (time - startedAt) / duration);
      const position = pointOnCursorPath(
        start,
        target,
        progress,
        curveDirection,
      );
      positionRef.current = position;
      setScenePosition(position);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(drawFrame);
      } else {
        setIsMoving(false);
      }
    };

    frameId = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [command]);

  if (!command || !scenePosition || !viewport || !root) return null;

  const viewportPosition = sceneCoordsToViewportCoords(
    { sceneX: scenePosition.x, sceneY: scenePosition.y },
    viewport,
  );
  const rootBounds = root.getBoundingClientRect();
  const activityLabel = labelForActivity(command.activity);

  return (
    <div
      className="agent-cursor"
      data-activity={command.activity}
      data-phase={isMoving ? "moving" : "settled"}
      data-target-x={command.target.x}
      data-target-y={command.target.y}
      data-testid="agent-cursor"
      style={{
        transform: `translate3d(${viewportPosition.x - rootBounds.left}px, ${
          viewportPosition.y - rootBounds.top
        }px, 0)`,
      }}
      aria-hidden="true"
    >
      <svg
        className="agent-cursor__pointer"
        width="25"
        height="31"
        viewBox="0 0 25 31"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3.3 2.8L21.2 16.1L12.8 17.6L8.1 25.7L3.3 2.8Z"
          fill="currentColor"
          stroke="white"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </svg>
      <span className="agent-cursor__badge">
        <span className="agent-cursor__status" />
        <span>Nova</span>
        <span className="agent-cursor__activity">{activityLabel}</span>
      </span>
    </div>
  );
}

function labelForActivity(activity: AgentCursorActivity): string {
  switch (activity) {
    case "reading":
      return "Reading";
    case "editing":
      return "Editing";
    case "thinking":
      return "Thinking";
    default:
      return "Moving";
  }
}
