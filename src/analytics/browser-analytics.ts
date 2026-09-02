import {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventSchema,
  bucketElementCount,
  type AnalyticsEvent,
  type ToolExecutionAnalytics,
  type WebMcpMode,
} from "./schema";

const DISTINCT_ID_KEY = "agent-canvas.analytics.distinct-id.v1";
const RETURNING_VISITOR_KEY = "agent-canvas.analytics.seen.v1";
const SESSION_ID_KEY = "agent-canvas.analytics.session-id.v1";
const OPEN_EVENT_KEY = "agent-canvas.analytics.opened.v1";
const CAPABILITY_EVENT_KEY = "agent-canvas.analytics.capability.v1";
const HUMAN_EDIT_IDLE_MS = 1_800;
const AGENT_WORK_IDLE_MS = 2_500;
const ANALYTICS_ORIGINS = new Set([
  "https://agent-canvas.yuvraj.tech",
  "https://agent-canvas-lyart.vercel.app",
]);

interface WorkSummary {
  startedAt: number;
  toolCallCount: number;
  cursorMoveCount: number;
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
  connectedCount: number;
  hasMutation: boolean;
  elementCountAfter: number;
}

interface HumanEditSummary {
  elementCountBefore: number;
  elementCountAfter: number;
}

export interface BrowserAnalyticsOptions {
  hasSavedCanvas: boolean;
  initialElementCount: number;
  initialWebMcpMode: WebMcpMode;
  enabled?: boolean;
  deploymentEnvironment?: "production" | "preview" | "development" | "test";
  appVersion?: string;
  localStorage?: Storage;
  sessionStorage?: Storage;
  transport?: (event: AnalyticsEvent) => void | Promise<void>;
  now?: () => number;
}

export class BrowserAnalytics {
  private readonly enabled: boolean;
  private readonly localStorage: Storage;
  private readonly sessionStorage: Storage;
  private readonly transport: (event: AnalyticsEvent) => void | Promise<void>;
  private readonly now: () => number;
  private readonly distinctId: string;
  private readonly sessionId: string;
  private readonly appVersion: string;
  private readonly deploymentEnvironment:
    | "production"
    | "preview"
    | "development"
    | "test";
  private webMcpMode: WebMcpMode;
  private workSummary: WorkSummary | null = null;
  private humanEditSummary: HumanEditSummary | null = null;
  private workTimer: number | null = null;
  private humanTimer: number | null = null;
  private afterAgentWork = false;
  private readonly handlePageHide = () => this.flushPending();

  constructor(options: BrowserAnalyticsOptions) {
    this.enabled =
      options.enabled ?? ANALYTICS_ORIGINS.has(window.location.origin);
    this.localStorage = options.localStorage ?? window.localStorage;
    this.sessionStorage = options.sessionStorage ?? window.sessionStorage;
    this.transport = options.transport ?? sendAnalyticsEvent;
    this.now = options.now ?? Date.now;
    this.distinctId = this.enabled
      ? getOrCreateId(this.localStorage, DISTINCT_ID_KEY)
      : "analytics-disabled";
    this.sessionId = this.enabled
      ? getOrCreateId(this.sessionStorage, SESSION_ID_KEY)
      : "analytics-disabled";
    this.appVersion = options.appVersion ?? __APP_VERSION__;
    this.deploymentEnvironment =
      options.deploymentEnvironment ??
      (ANALYTICS_ORIGINS.has(window.location.origin)
        ? "production"
        : "development");
    this.webMcpMode = options.initialWebMcpMode;

    if (!this.enabled) return;
    window.addEventListener("pagehide", this.handlePageHide);
    this.trackCanvasOpened(options.hasSavedCanvas, options.initialElementCount);
  }

  trackCapability(capability: WebMcpMode, toolCount: number): void {
    this.webMcpMode = capability;
    if (!this.enabled || safeGet(this.sessionStorage, CAPABILITY_EVENT_KEY)) {
      return;
    }
    safeSet(this.sessionStorage, CAPABILITY_EVENT_KEY, "1");
    this.capture({
      event: "webmcp_capability_detected",
      distinct_id: this.distinctId,
      properties: {
        ...this.baseProperties(),
        capability,
        tool_count: clampCount(toolCount),
      },
    });
  }

  trackToolExecution(
    execution: ToolExecutionAnalytics,
    elementCountAfter: number,
  ): void {
    if (!this.enabled) return;
    this.updateWorkSummary(execution, elementCountAfter);
    if (execution.toolName === "move_agent_cursor") return;

    this.capture({
      event: "webmcp_tool_executed",
      distinct_id: this.distinctId,
      properties: {
        ...this.baseProperties(),
        tool_name: execution.toolName,
        outcome: execution.outcome,
        duration_ms: clampDuration(execution.durationMs),
        affected_count: clampCount(execution.affectedCount),
        element_count_after: clampCount(elementCountAfter),
        ...(execution.errorCode ? { error_code: execution.errorCode } : {}),
      },
    });
  }

  recordHumanCanvasEdit(
    elementCountBefore: number,
    elementCountAfter: number,
  ): void {
    if (!this.enabled) return;
    if (!this.humanEditSummary) {
      this.humanEditSummary = {
        elementCountBefore: clampCount(elementCountBefore),
        elementCountAfter: clampCount(elementCountAfter),
      };
    } else {
      this.humanEditSummary.elementCountAfter = clampCount(elementCountAfter);
    }
    if (this.humanTimer !== null) window.clearTimeout(this.humanTimer);
    this.humanTimer = window.setTimeout(
      () => this.flushHumanEdit(),
      HUMAN_EDIT_IDLE_MS,
    );
  }

  dispose(): void {
    if (!this.enabled) return;
    window.removeEventListener("pagehide", this.handlePageHide);
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    if (this.humanTimer !== null) window.clearTimeout(this.humanTimer);
    this.workTimer = null;
    this.humanTimer = null;
  }

  private trackCanvasOpened(
    hasSavedCanvas: boolean,
    initialElementCount: number,
  ): void {
    if (safeGet(this.sessionStorage, OPEN_EVENT_KEY)) return;
    const returningVisitor = Boolean(
      safeGet(this.localStorage, RETURNING_VISITOR_KEY),
    );
    safeSet(this.sessionStorage, OPEN_EVENT_KEY, "1");
    safeSet(this.localStorage, RETURNING_VISITOR_KEY, "1");
    this.capture({
      event: "agent_canvas_opened",
      distinct_id: this.distinctId,
      properties: {
        ...this.baseProperties(),
        returning_visitor: returningVisitor,
        has_saved_canvas: hasSavedCanvas,
        initial_element_count_bucket: bucketElementCount(initialElementCount),
      },
    });
  }

  private updateWorkSummary(
    execution: ToolExecutionAnalytics,
    elementCountAfter: number,
  ): void {
    const now = this.now();
    if (!this.workSummary) {
      this.workSummary = {
        startedAt: Math.max(0, now - clampDuration(execution.durationMs)),
        toolCallCount: 0,
        cursorMoveCount: 0,
        addedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        connectedCount: 0,
        hasMutation: false,
        elementCountAfter: clampCount(elementCountAfter),
      };
    }

    const summary = this.workSummary;
    summary.elementCountAfter = clampCount(elementCountAfter);
    if (execution.toolName === "move_agent_cursor") {
      if (execution.outcome === "success") summary.cursorMoveCount += 1;
    } else {
      summary.toolCallCount += 1;
    }

    if (execution.outcome === "success") {
      const affected = clampCount(execution.affectedCount);
      if (execution.toolName === "add_elements") {
        summary.addedCount += affected;
        summary.hasMutation = true;
      } else if (execution.toolName === "update_elements") {
        summary.updatedCount += affected;
        summary.hasMutation = true;
      } else if (execution.toolName === "delete_elements") {
        summary.deletedCount += affected;
        summary.hasMutation = true;
      } else if (execution.toolName === "connect_elements") {
        summary.connectedCount += affected;
        summary.hasMutation = true;
      }
    }

    if (summary.hasMutation) this.afterAgentWork = true;
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    this.workTimer = window.setTimeout(
      () => this.flushAgentWork(),
      AGENT_WORK_IDLE_MS,
    );
  }

  private flushPending(): void {
    this.flushAgentWork();
    this.flushHumanEdit();
  }

  private flushAgentWork(): void {
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    this.workTimer = null;
    const summary = this.workSummary;
    this.workSummary = null;
    if (!summary?.hasMutation) return;
    this.capture({
      event: "agent_work_completed",
      distinct_id: this.distinctId,
      properties: {
        ...this.baseProperties(),
        duration_ms: clampDuration(this.now() - summary.startedAt),
        tool_call_count: clampCount(summary.toolCallCount),
        cursor_move_count: clampCount(summary.cursorMoveCount),
        added_count: clampCount(summary.addedCount),
        updated_count: clampCount(summary.updatedCount),
        deleted_count: clampCount(summary.deletedCount),
        connected_count: clampCount(summary.connectedCount),
        element_count_after: summary.elementCountAfter,
      },
    });
  }

  private flushHumanEdit(): void {
    if (this.humanTimer !== null) window.clearTimeout(this.humanTimer);
    this.humanTimer = null;
    const summary = this.humanEditSummary;
    this.humanEditSummary = null;
    if (!summary) return;
    this.capture({
      event: "human_canvas_edited",
      distinct_id: this.distinctId,
      properties: {
        ...this.baseProperties(),
        element_count_before: summary.elementCountBefore,
        element_count_after: summary.elementCountAfter,
        after_agent_work: this.afterAgentWork,
      },
    });
  }

  private baseProperties() {
    return {
      session_id: this.sessionId,
      app_version: this.appVersion,
      deployment_environment: this.deploymentEnvironment,
      webmcp_mode: this.webMcpMode,
      schema_version: ANALYTICS_SCHEMA_VERSION,
    } as const;
  }

  private capture(event: AnalyticsEvent): void {
    const parsed = analyticsEventSchema.safeParse(event);
    if (!parsed.success) return;
    try {
      void Promise.resolve(this.transport(parsed.data)).catch(() => undefined);
    } catch {
      // Analytics must never affect canvas work.
    }
  }
}

declare const __APP_VERSION__: string;

function sendAnalyticsEvent(event: AnalyticsEvent): Promise<void> {
  return fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    credentials: "same-origin",
    keepalive: true,
  }).then(() => undefined);
}

function getOrCreateId(storage: Storage, key: string): string {
  const existing = safeGet(storage, key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  safeSet(storage, key, id);
  return id;
}

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Analytics remains optional when browser storage is unavailable.
  }
}

function clampCount(value: number): number {
  return Math.min(100_000, Math.max(0, Math.round(value)));
}

function clampDuration(value: number): number {
  return Math.min(600_000, Math.max(0, Math.round(value)));
}
