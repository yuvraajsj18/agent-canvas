import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible();
});

test("shows only the standard Excalidraw surface", async ({ page }) => {
  await expect(page.getByTestId("agent-cursor")).toHaveCount(0);
  await expect(page.locator(".review-panel")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toHaveCount(0);
  await expect(page.getByTestId("proposal-overlay")).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    root: document.getElementById("root")?.getBoundingClientRect().toJSON(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    state: window.__AGENT_CANVAS_TEST__?.getState(),
  }));
  expect(layout.root?.width).toBe(layout.viewport.width);
  expect(layout.root?.height).toBe(layout.viewport.height);
  expect((layout.state as { elementCount: number }).elementCount).toBe(0);
});

test("WebMCP adapter edits immediately, supports selection, undo, and persistence", async ({
  page,
}) => {
  const initialTools = await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.listTools().map((tool) => tool.name),
  );
  expect(initialTools).toEqual([
    "add_elements",
    "connect_elements",
    "delete_elements",
    "move_agent_cursor",
    "read_canvas",
    "set_agent_identity",
    "update_elements",
  ]);

  const identityResult = await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("set_agent_identity", {
      name: "Codex",
    }),
  );
  expect(identityResult?.structuredContent).toEqual({ agent: "Codex" });

  const moveResult = await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("move_agent_cursor", {
      x: 420,
      y: 260,
      activity: "thinking",
    }),
  );
  expect(moveResult?.structuredContent).toMatchObject({
    agent: "Codex",
    x: 420,
    y: 260,
    activity: "thinking",
  });
  const cursor = page.getByTestId("agent-cursor");
  await expect(cursor).toBeVisible();
  await expect(cursor).toHaveAttribute("data-agent-name", "Codex");
  await expect(page.getByTestId("agent-cursor-name")).toHaveText("Codex");
  await expect(cursor).toHaveAttribute("data-target-x", "420");
  await expect(cursor).toHaveAttribute("data-target-y", "260");
  await expect(cursor).toHaveAttribute("data-activity", "thinking");
  await expect(cursor).toHaveAttribute("data-phase", "settled", {
    timeout: 2_000,
  });
  expect(await cursor.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe(
    "none",
  );

  await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("move_agent_cursor", {
      x: 1_200,
      y: 800,
      activity: "moving",
    }),
  );
  await page.waitForTimeout(50);
  await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("move_agent_cursor", {
      x: 160,
      y: 120,
      activity: "reading",
    }),
  );
  await expect(cursor).toHaveAttribute("data-target-x", "160");
  await expect(cursor).toHaveAttribute("data-target-y", "120");
  await expect(cursor).toHaveAttribute("data-phase", "settled", {
    timeout: 2_000,
  });
  const interruptedPosition = await cursor.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y };
  });
  await page.waitForTimeout(950);
  const finalInterruptedPosition = await cursor.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y };
  });
  expect(finalInterruptedPosition.x).toBeCloseTo(interruptedPosition.x, 1);
  expect(finalInterruptedPosition.y).toBeCloseTo(interruptedPosition.y, 1);

  const transformBeforeZoom = await cursor.getAttribute("style");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(() => cursor.getAttribute("style"))
    .not.toBe(transformBeforeZoom);
  await expect(cursor).toHaveAttribute("data-target-x", "160");
  await expect(cursor).toHaveAttribute("data-target-y", "120");

  await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("add_elements", {
      elements: [
        {
          id: "plan",
          type: "rectangle",
          x: 300,
          y: 130,
          width: 220,
          height: 110,
          text: "Plan",
          backgroundColor: "#e7f5ff",
          strokeColor: "#1971c2",
        },
        {
          id: "ship",
          type: "ellipse",
          x: 700,
          y: 150,
          width: 180,
          height: 90,
          text: "Ship",
          backgroundColor: "#ebfbee",
          strokeColor: "#2f9e44",
        },
      ],
    }),
  );
  expect(await page.evaluate(() => window.__AGENT_CANVAS_TEST__?.getAgentCursor())).toMatchObject(
    {
      activity: "reading",
      label: "Checking",
      target: { x: 590, y: 185 },
    },
  );
  await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("connect_elements", {
      connections: [
        {
          id: "plan-to-ship",
          fromId: "plan",
          toId: "ship",
          label: "then",
        },
      ],
    }),
  );

  let canvas = await readCanvasWithAdapter(page);
  expect(canvas.elements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "plan", text: "Plan" }),
      expect.objectContaining({ id: "ship", text: "Ship" }),
      expect.objectContaining({
        id: "plan-to-ship",
        startId: "plan",
        endId: "ship",
      }),
    ]),
  );

  await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("update_elements", {
      updates: [{ id: "plan", x: 370, text: "Plan now" }],
    }),
  );
  canvas = await readCanvasWithAdapter(page);
  expect(canvas.elements.find((item) => item.id === "plan")).toMatchObject({
    x: 370,
    text: "Plan now",
  });

  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () =>
      (await readCanvasWithAdapter(page)).elements.find(
        (item) => item.id === "plan",
      ),
    )
    .toMatchObject({ x: 300, text: "Plan" });

  await page.evaluate(() => window.__AGENT_CANVAS_TEST__?.selectElements(["plan"]));
  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__EXCALIDRAW_WEBMCP_ADAPTER__?.listTools().map((tool) => tool.name),
      ),
    )
    .toContain("read_selection");
  const selection = await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("read_selection", {}),
  );
  expect(selection?.structuredContent.selectedIds).toEqual(["plan"]);
  await expect(cursor).toHaveAttribute("data-phase", "settled", {
    timeout: 2_000,
  });

  await page.screenshot({
    path: "artifacts/agent-canvas-webmcp.png",
    fullPage: true,
  });
  await expect(cursor).toHaveCount(0, { timeout: 4_000 });
  await page.reload();
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible();
  canvas = await readCanvasWithAdapter(page);
  expect(canvas.elements.map((item) => item.id)).toEqual(
    expect.arrayContaining(["plan", "ship", "plan-to-ship"]),
  );
});

test("agent work appears in visible stages, stays one undo step, and leaves", async ({
  page,
}) => {
  await page.evaluate(() => {
    const stageState = window as typeof window & {
      __STAGE_TEST__?: { done: boolean; error?: string };
    };
    stageState.__STAGE_TEST__ = { done: false };
    void window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("add_elements", {
      elements: Array.from({ length: 10 }, (_, index) => ({
        id: `stage-${index + 1}`,
        type: index % 2 === 0 ? "rectangle" : "ellipse",
        x: 180 + (index % 5) * 190,
        y: 180 + Math.floor(index / 5) * 180,
        width: 140,
        height: 90,
        text: `Step ${index + 1}`,
      })),
    })
      .then(() => {
        stageState.__STAGE_TEST__ = { done: true };
      })
      .catch((error: unknown) => {
        stageState.__STAGE_TEST__ = {
          done: true,
          error: error instanceof Error ? error.message : String(error),
        };
      });
  });

  const cursor = page.getByTestId("agent-cursor");
  await expect(cursor).toBeVisible();
  await expect(cursor).toHaveAttribute("data-activity", "editing");
  await expect(page.getByTestId("agent-cursor-activity")).toContainText(
    "Drawing",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => {
          const state = window.__AGENT_CANVAS_TEST__?.getState() as {
            elements: { opacity?: number }[];
          };
          return state.elements.filter((element) => element.opacity !== 0).length;
        },
      ),
    )
    .toBeGreaterThan(0);
  const partialCount = await page.evaluate(
    () => {
      const state = window.__AGENT_CANVAS_TEST__?.getState() as {
        elements: { opacity?: number }[];
      };
      return state.elements.filter((element) => element.opacity !== 0).length;
    },
  );
  expect(partialCount).toBeLessThan(10);
  await page.screenshot({
    path: "artifacts/agent-canvas-working.png",
    fullPage: true,
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const stageState = window as typeof window & {
          __STAGE_TEST__?: { done: boolean; error?: string };
        };
        return stageState.__STAGE_TEST__;
      }),
    )
    .toEqual({ done: true });
  expect(
    await page.evaluate(
      () =>
        (window.__AGENT_CANVAS_TEST__?.getState() as { elementCount: number })
          .elementCount,
    ),
  ).toBe(10);
  await expect(page.getByTestId("agent-cursor-activity")).toHaveText(
    "Checking",
  );

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__AGENT_CANVAS_TEST__?.getState() as { elementCount: number })
            .elementCount,
      ),
    )
    .toBe(0);
  await expect(cursor).toHaveCount(0, { timeout: 4_000 });
});

test("native WebMCP discovers and performs direct canvas edits", async ({ page }) => {
  const discovered = await page.evaluate(async () => {
    const modelContext = (
      document as Document & { modelContext: BrowserModelContext }
    ).modelContext;
    const tools = await modelContext.getTools();
    return tools.map((tool) => ({
      name: tool.name,
      annotations: tool.annotations,
    }));
  });
  expect(discovered.map((tool) => tool.name).sort()).toEqual([
    "add_elements",
    "connect_elements",
    "delete_elements",
    "move_agent_cursor",
    "read_canvas",
    "set_agent_identity",
    "update_elements",
  ]);
  expect(discovered.find((tool) => tool.name === "read_canvas")?.annotations).toMatchObject({
    readOnlyHint: true,
    untrustedContentHint: true,
  });
  expect(
    discovered.find((tool) => tool.name === "delete_elements")?.annotations,
  ).toMatchObject({
    readOnlyHint: false,
    untrustedContentHint: true,
  });

  await page.evaluate(async () => {
    const modelContext = (
      document as Document & { modelContext: BrowserModelContext }
    ).modelContext;
    let tools = await modelContext.getTools();
    const identityTool = tools.find(
      (tool) => tool.name === "set_agent_identity",
    );
    if (!identityTool) throw new Error("set_agent_identity was not discovered.");
    await modelContext.executeTool(
      identityTool,
      JSON.stringify({ name: "Claude" }),
    );
    tools = await modelContext.getTools();
    const addTool = tools.find((tool) => tool.name === "add_elements");
    if (!addTool) throw new Error("add_elements was not discovered.");
    await modelContext.executeTool(
      addTool,
      JSON.stringify({
        elements: [
          {
            id: "native-box",
            type: "rectangle",
            x: 180,
            y: 180,
            width: 220,
            height: 110,
            angle: Math.PI / 6,
            text: "Native WebMCP",
          },
        ],
      }),
    );
  });
  await expect(page.getByTestId("agent-cursor-name")).toHaveText("Claude");

  const nativeRead = await page.evaluate(async () => {
    const modelContext = (
      document as Document & { modelContext: BrowserModelContext }
    ).modelContext;
    const tools = await modelContext.getTools();
    const readTool = tools.find((tool) => tool.name === "read_canvas");
    if (!readTool) throw new Error("read_canvas was not discovered.");
    (
      window as typeof window & { __NATIVE_READ_TOOL__?: BrowserTool }
    ).__NATIVE_READ_TOOL__ = readTool;
    const value = await modelContext.executeTool(readTool, "{}");
    return typeof value === "string"
      ? (JSON.parse(value) as {
          structuredContent: { elements: Record<string, unknown>[] };
        })
      : (value as {
          structuredContent: { elements: Record<string, unknown>[] };
        });
  });
  expect(nativeRead.structuredContent.elements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "native-box",
        text: "Native WebMCP",
        angle: Math.PI / 6,
      }),
    ]),
  );

  await page.evaluate(() =>
    window.__AGENT_CANVAS_TEST__?.selectElements(["native-box"]),
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const modelContext = (
          document as Document & { modelContext: BrowserModelContext }
        ).modelContext;
        return (await modelContext.getTools()).map((tool) => tool.name);
      }),
    )
    .toContain("read_selection");

  const nativeSelection = await page.evaluate(async () => {
    const modelContext = (
      document as Document & { modelContext: BrowserModelContext }
    ).modelContext;
    const tools = await modelContext.getTools();
    const selectionTool = tools.find((tool) => tool.name === "read_selection");
    if (!selectionTool) throw new Error("read_selection was not discovered.");
    const value = await modelContext.executeTool(selectionTool, "{}");
    return typeof value === "string"
      ? (JSON.parse(value) as {
          structuredContent: { selectedIds: string[] };
        })
      : (value as {
          structuredContent: { selectedIds: string[] };
        });
  });
  expect(nativeSelection.structuredContent.selectedIds).toEqual(["native-box"]);

  const stableRead = await page.evaluate(async () => {
    const modelContext = (
      document as Document & { modelContext: BrowserModelContext }
    ).modelContext;
    const oldReadTool = (
      window as typeof window & { __NATIVE_READ_TOOL__?: BrowserTool }
    ).__NATIVE_READ_TOOL__;
    if (!oldReadTool) throw new Error("The original read tool is missing.");
    const value = await modelContext.executeTool(oldReadTool, "{}");
    return typeof value === "string"
      ? (JSON.parse(value) as { structuredContent: { elementCount: number } })
      : (value as { structuredContent: { elementCount: number } });
  });
  expect(stableRead.structuredContent.elementCount).toBe(1);
});

test("agent cursor removes travel motion for reduced-motion users", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  const phaseAfterThreeFrames = await page.evaluate(async () => {
    await window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke(
      "set_agent_identity",
      { name: "Gemini" },
    );
    await window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("move_agent_cursor", {
      x: 640,
      y: 320,
      activity: "thinking",
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );
    return document.querySelector<HTMLElement>("[data-testid='agent-cursor']")
      ?.dataset.phase;
  });

  expect(phaseAfterThreeFrames).toBe("settled");
  await expect(page.getByTestId("agent-cursor")).toHaveAttribute(
    "data-activity",
    "thinking",
  );
  await expect(page.getByTestId("agent-cursor-name")).toHaveText("Gemini");
});

async function readCanvasWithAdapter(page: import("@playwright/test").Page) {
  const result = await page.evaluate(() =>
    window.__EXCALIDRAW_WEBMCP_ADAPTER__?.invoke("read_canvas", {}),
  );
  return result?.structuredContent as {
    revision: string;
    elementCount: number;
    elements: {
      id: string;
      x: number;
      text?: string;
      startId?: string | null;
      endId?: string | null;
    }[];
  };
}

type BrowserTool = {
  name: string;
  annotations?: Record<string, boolean>;
};

type BrowserModelContext = {
  getTools(): Promise<BrowserTool[]>;
  executeTool(tool: BrowserTool, input: string): Promise<unknown>;
};

declare global {
  interface Window {
    __EXCALIDRAW_WEBMCP_ADAPTER__?: {
      listTools(): { name: string }[];
      invoke(
        name: string,
        input: unknown,
      ): Promise<{ structuredContent: Record<string, unknown> }>;
    };
    __AGENT_CANVAS_TEST__?: {
      getState(): unknown;
      getAgentCursor(): {
        activity: string;
        label?: string;
        target: { x: number; y: number };
      } | null;
      selectElements(ids: string[]): void;
    };
  }
}
