import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionAnalytics } from "../analytics/schema";
import { createToolDefinitions, DeveloperToolAdapter } from "./registry";

const handlers = () => {
  let agentName = "AI Agent";
  return {
    readCanvas: vi.fn(() => ({ revision: "scene_1", elements: [] })),
    readSelection: vi.fn(() => ({ selectedIds: ["shape-1"] })),
    addElements: vi.fn((input) => ({
      addedIds: input.elements.map((item: { id: string }) => item.id),
    })),
    updateElements: vi.fn((input) => ({
      updatedIds: input.updates.map((item: { id: string }) => item.id),
    })),
    deleteElements: vi.fn((input) => ({ deletedIds: input.ids })),
    connectElements: vi.fn((input) => ({
      addedIds: input.connections.map((item: { id: string }) => item.id),
    })),
    moveAgentCursor: vi.fn((input) => ({ agent: agentName, ...input })),
    setAgentIdentity: vi.fn((input) => {
      agentName = input.name;
      return { agent: agentName };
    }),
  };
};

describe("WebMCP direct-edit adapter", () => {
  it("discovers direct tools and invokes validated handlers", async () => {
    const callbacks = handlers();
    const adapter = new DeveloperToolAdapter();
    adapter.replace(createToolDefinitions(callbacks, { hasSelection: false }));

    expect(adapter.listTools().map((tool) => tool.name)).toEqual([
      "add_elements",
      "connect_elements",
      "delete_elements",
      "move_agent_cursor",
      "read_canvas",
      "set_agent_identity",
      "update_elements",
    ]);
    expect(
      adapter.listTools().find((tool) => tool.name === "delete_elements")
        ?.annotations,
    ).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(
      adapter.listTools().find((tool) => tool.name === "read_canvas")
        ?.description,
    ).toContain("visualGuidance");
    expect(
      adapter.listTools().find((tool) => tool.name === "add_elements")
        ?.description,
    ).toContain("30-50 purposeful elements");
    await expect(adapter.invoke("read_canvas", {})).resolves.toMatchObject({
      structuredContent: { revision: "scene_1" },
    });
    await expect(
      adapter.invoke("update_elements", {
        updates: [{ id: "shape-1", x: 120 }],
      }),
    ).resolves.toMatchObject({ structuredContent: { updatedIds: ["shape-1"] } });
    await expect(
      adapter.invoke("update_elements", { updates: [{ id: "shape-1" }] }),
    ).rejects.toThrow();
    expect(callbacks.updateElements).toHaveBeenCalledTimes(1);
    await expect(
      adapter.invoke("set_agent_identity", { name: "Codex" }),
    ).resolves.toMatchObject({ structuredContent: { agent: "Codex" } });
    await expect(
      adapter.invoke("move_agent_cursor", {
        x: 420,
        y: 260,
        activity: "thinking",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        agent: "Codex",
        x: 420,
        y: 260,
        activity: "thinking",
      },
    });

    adapter.replace(createToolDefinitions(callbacks, { hasSelection: true }));
    expect(adapter.listTools().map((tool) => tool.name)).toContain(
      "read_selection",
    );
  });

  it("reports only controlled execution metadata", async () => {
    const callbacks = handlers();
    const executions: ToolExecutionAnalytics[] = [];
    const adapter = new DeveloperToolAdapter();
    adapter.replace(
      createToolDefinitions(callbacks, {
        hasSelection: false,
        onToolExecution: (execution) => executions.push(execution),
      }),
    );

    await adapter.invoke("add_elements", {
      elements: [
        { id: "one", type: "rectangle", x: 0, y: 0, text: "secret" },
        { id: "two", type: "ellipse", x: 200, y: 0 },
      ],
    });
    await expect(
      adapter.invoke("update_elements", { updates: [{ id: "one" }] }),
    ).rejects.toThrow();

    expect(executions).toHaveLength(2);
    expect(executions[0]).toMatchObject({
      toolName: "add_elements",
      outcome: "success",
      affectedCount: 2,
    });
    expect(executions[1]).toMatchObject({
      toolName: "update_elements",
      outcome: "failure",
      affectedCount: 0,
      errorCode: "invalid_input",
    });
    expect(JSON.stringify(executions)).not.toContain("secret");
  });
});

describe("native registration lifecycle", () => {
  it("cleans up every registered direct tool with one AbortController", async () => {
    const definitions = createToolDefinitions(handlers(), {
      hasSelection: false,
    });
    const registrations: { name: string; signal: AbortSignal }[] = [];
    const context = {
      registerTool: vi.fn(async (tool, options) => {
        registrations.push({ name: tool.name, signal: options.signal });
      }),
    };
    const adapter = new DeveloperToolAdapter();
    adapter.replace(definitions);
    const lifecycle = adapter.registerNative(context);
    await lifecycle.ready;

    expect(registrations).toHaveLength(7);
    expect(registrations.every(({ signal }) => !signal.aborted)).toBe(true);
    lifecycle.cleanup();
    expect(registrations.every(({ signal }) => signal.aborted)).toBe(true);
  });
});
