import { describe, expect, it } from "vitest";
import { loadWorkspace, saveWorkspace, STORAGE_KEY } from "./storage";
import type { SceneElementLike } from "./types";

describe("workspace persistence", () => {
  it("round-trips only the live Excalidraw scene", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    const note: SceneElementLike = {
      id: "record-demo",
      type: "rectangle",
      x: 20,
      y: 40,
      width: 180,
      height: 90,
      version: 3,
    };
    const value = {
      elements: [note],
      savedAt: 123,
    };

    saveWorkspace(adapter, value);

    expect(storage.has(STORAGE_KEY)).toBe(true);
    expect(STORAGE_KEY).toBe("agent-canvas.workspace.v2");
    expect(loadWorkspace(adapter)).toEqual(value);
    storage.set(STORAGE_KEY, "not-json");
    expect(loadWorkspace(adapter)).toBeNull();
  });
});
