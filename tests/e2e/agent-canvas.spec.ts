import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible();
});

test("shows only the standard Excalidraw surface", async ({ page }) => {
  await expect(page.getByText("Nova", { exact: true })).toHaveCount(0);
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
    "read_canvas",
    "update_elements",
  ]);

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

  await page.screenshot({
    path: "artifacts/agent-canvas-webmcp.png",
    fullPage: true,
  });
  await page.waitForTimeout(350);
  await page.reload();
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible();
  canvas = await readCanvasWithAdapter(page);
  expect(canvas.elements.map((item) => item.id)).toEqual(
    expect.arrayContaining(["plan", "ship", "plan-to-ship"]),
  );
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
    "read_canvas",
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
    const tools = await modelContext.getTools();
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
            text: "Native WebMCP",
          },
        ],
      }),
    );
  });

  const nativeRead = await page.evaluate(async () => {
    const modelContext = (
      document as Document & { modelContext: BrowserModelContext }
    ).modelContext;
    const tools = await modelContext.getTools();
    const readTool = tools.find((tool) => tool.name === "read_canvas");
    if (!readTool) throw new Error("read_canvas was not discovered.");
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
      expect.objectContaining({ id: "native-box", text: "Native WebMCP" }),
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
      selectElements(ids: string[]): void;
    };
  }
}
