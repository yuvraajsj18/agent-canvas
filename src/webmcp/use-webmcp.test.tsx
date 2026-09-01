import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NativeModelContext,
  ToolHandlers,
  WebMcpToolDefinition,
} from "./registry";
import { useWebMcp } from "./use-webmcp";

interface Registration {
  tool: WebMcpToolDefinition;
  signal: AbortSignal;
}

function handlers(marker: number): ToolHandlers {
  return {
    readCanvas: () => ({ marker }),
    readSelection: () => ({ marker, selectedIds: ["shape-1"] }),
    addElements: (input) => ({ marker, count: input.elements.length }),
    updateElements: (input) => ({ marker, count: input.updates.length }),
    deleteElements: (input) => ({ marker, count: input.ids.length }),
    connectElements: (input) => ({ marker, count: input.connections.length }),
    moveAgentCursor: (input) => ({ marker, ...input }),
    setAgentIdentity: (input) => ({ marker, agent: input.name }),
  };
}

function Probe({
  hasSelection,
  marker,
}: {
  hasSelection: boolean;
  marker: number;
}) {
  useWebMcp(handlers(marker), { hasSelection });
  return null;
}

afterEach(() => {
  Reflect.deleteProperty(document, "modelContext");
  delete window.__EXCALIDRAW_WEBMCP_ADAPTER__;
});

describe("useWebMcp registration stability", () => {
  it("keeps base tool registrations alive while selection changes", async () => {
    const registrations: Registration[] = [];
    const context: NativeModelContext = {
      registerTool: vi.fn(async (tool, options) => {
        registrations.push({ tool, signal: options.signal });
      }),
    };
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: context,
    });

    const view = render(<Probe hasSelection={false} marker={1} />);
    await waitFor(() => expect(registrations).toHaveLength(7));
    const baseRegistrations = [...registrations];
    const registeredRead = baseRegistrations.find(
      ({ tool }) => tool.name === "read_canvas",
    )?.tool;
    expect(registeredRead).toBeDefined();

    view.rerender(<Probe hasSelection marker={2} />);
    await waitFor(() => expect(registrations).toHaveLength(8));
    expect(registrations.at(-1)?.tool.name).toBe("read_selection");
    expect(baseRegistrations.every(({ signal }) => !signal.aborted)).toBe(true);
    await expect(registeredRead?.execute({})).resolves.toMatchObject({
      structuredContent: { marker: 2 },
    });

    const selectionSignal = registrations.at(-1)?.signal;
    view.rerender(<Probe hasSelection={false} marker={3} />);
    await waitFor(() => expect(selectionSignal?.aborted).toBe(true));
    expect(baseRegistrations.every(({ signal }) => !signal.aborted)).toBe(true);

    view.unmount();
    expect(baseRegistrations.every(({ signal }) => signal.aborted)).toBe(true);
  });
});
