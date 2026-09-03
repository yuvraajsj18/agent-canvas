import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAnalytics } from "./browser-analytics";
import type { AnalyticsEvent } from "./schema";

describe("BrowserAnalytics", () => {
  const events: AnalyticsEvent[] = [];
  let persistentStorage: Storage;
  let tabStorage: Storage;
  let pageLoad: object;

  beforeEach(() => {
    vi.useFakeTimers();
    persistentStorage = memoryStorage();
    tabStorage = memoryStorage();
    pageLoad = {};
    events.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createAnalytics() {
    return new BrowserAnalytics({
      enabled: true,
      deploymentEnvironment: "test",
      appVersion: "test-version",
      hasSavedCanvas: false,
      initialElementCount: 0,
      initialWebMcpMode: "adapter",
      localStorage: persistentStorage,
      sessionStorage: tabStorage,
      pageLoad,
      transport: (event) => {
        events.push(event);
      },
    });
  }

  it("captures one pageview per document, including StrictMode remounts", () => {
    const first = createAnalytics();
    const second = createAnalytics();
    first.trackCapability("native", 7);
    second.trackCapability("native", 7);

    expect(events.map((event) => event.event)).toEqual([
      "$pageview",
      "webmcp_capability_detected",
    ]);
    expect(events[0]).toMatchObject({
      properties: {
        returning_visitor: false,
        initial_element_count_bucket: "0",
      },
    });
    first.dispose();
    second.dispose();
  });

  it("counts reloads but keeps the visitor and active session stable", () => {
    const first = createAnalytics();
    first.dispose();
    pageLoad = {};
    const second = createAnalytics();
    expect(events.map((event) => event.event)).toEqual(["$pageview", "$pageview"]);
    expect(events[1].distinct_id).toBe(events[0].distinct_id);
    expect(events[1].properties.$session_id).toBe(events[0].properties.$session_id);
    expect(events[1]).toMatchObject({ properties: { returning_visitor: true } });
    second.dispose();
  });

  it("sends only fixed public page properties, never query strings or fragments", () => {
    window.history.replaceState({}, "", "/?token=private-query#private-board");
    const analytics = createAnalytics();
    expect(events[0].properties).toMatchObject({
      $current_url: "https://agent-canvas.yuvraj.tech/",
      $host: "agent-canvas.yuvraj.tech",
      $pathname: "/",
      schema_version: 2,
    });
    expect(JSON.stringify(events)).not.toContain("private-");
    expect(events[0].properties.$session_id).toMatch(/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    window.history.replaceState({}, "", "/");
    analytics.dispose();
  });

  it("does not emit cursor events and sends one aggregate work summary", () => {
    const analytics = createAnalytics();
    events.length = 0;

    analytics.trackToolExecution(
      {
        toolName: "move_agent_cursor",
        outcome: "success",
        durationMs: 20,
        affectedCount: 0,
      },
      0,
    );
    analytics.trackToolExecution(
      {
        toolName: "read_canvas",
        outcome: "success",
        durationMs: 40,
        affectedCount: 0,
      },
      0,
    );
    analytics.trackToolExecution(
      {
        toolName: "add_elements",
        outcome: "success",
        durationMs: 300,
        affectedCount: 12,
      },
      12,
    );

    expect(events.map((event) => event.event)).toEqual([
      "webmcp_tool_executed",
      "webmcp_tool_executed",
    ]);
    expect(
      events.some(
        (event) =>
          event.event === "webmcp_tool_executed" &&
          event.properties.tool_name === "move_agent_cursor",
      ),
    ).toBe(false);

    vi.advanceTimersByTime(2_500);
    expect(events.at(-1)).toMatchObject({
      event: "agent_work_completed",
      properties: {
        tool_call_count: 2,
        cursor_move_count: 1,
        added_count: 12,
        element_count_after: 12,
      },
    });
    analytics.dispose();
  });

  it("groups human changes into one quiet-period event", () => {
    const analytics = createAnalytics();
    events.length = 0;
    analytics.recordHumanCanvasEdit(3, 4);
    vi.advanceTimersByTime(1_000);
    analytics.recordHumanCanvasEdit(4, 6);
    vi.advanceTimersByTime(1_800);

    expect(events).toEqual([
      expect.objectContaining({
        event: "human_canvas_edited",
        properties: expect.objectContaining({
          element_count_before: 3,
          element_count_after: 6,
          after_agent_work: false,
        }),
      }),
    ]);
    analytics.dispose();
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
