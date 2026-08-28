import { describe, expect, it } from "vitest";
import {
  addCanvasElements,
  connectCanvasElements,
  deleteCanvasElements,
  LockedElementError,
  readCanvasSnapshot,
  sceneRevision,
  updateCanvasElements,
} from "./canvas-ops";
import type { SceneElementLike } from "./types";

describe("direct canvas updates", () => {
  it("updates a live element immediately while keeping its ID and bound text aligned", () => {
    const scene: SceneElementLike[] = [
      {
        id: "box-1",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 160,
      height: 90,
      version: 1,
      versionNonce: 7,
      boundElements: [{ id: "label-1", type: "text" }],
      },
      {
        id: "label-1",
        type: "text",
        x: 45,
        y: 50,
        width: 90,
      height: 24,
      version: 1,
      versionNonce: 9,
        containerId: "box-1",
        text: "Old label",
        originalText: "Old label",
      },
    ];

    const result = updateCanvasElements(
      scene,
      [{ id: "box-1", x: 60, y: 80, text: "New label" }],
      100,
    );

    expect(result.updatedIds).toEqual(["box-1"]);
    expect(result.elements.find((item) => item.id === "box-1")).toMatchObject({
      id: "box-1",
      x: 60,
      y: 80,
      version: 2,
      versionNonce: 8,
    });
    expect(result.elements.find((item) => item.id === "label-1")).toMatchObject({
      id: "label-1",
      x: 95,
      y: 110,
      text: "New label",
      originalText: "New label",
      version: 2,
      versionNonce: 10,
    });
    expect(scene[0]).toMatchObject({ x: 10, y: 20, version: 1 });
  });

  it("rejects an atomic update when any target is locked", () => {
    const scene: SceneElementLike[] = [
      {
        id: "free",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
      },
      {
        id: "locked",
        type: "rectangle",
        x: 150,
        y: 0,
        width: 100,
        height: 80,
        locked: true,
      },
    ];

    expect(() =>
      updateCanvasElements(scene, [
        { id: "free", x: 20 },
        { id: "locked", x: 180 },
      ]),
    ).toThrowError(LockedElementError);
    expect(scene.map((item) => item.x)).toEqual([0, 150]);
  });

  it("adds materialized elements and places existing objects and labels in a frame", () => {
    const scene: SceneElementLike[] = [
      {
        id: "note",
        type: "rectangle",
        x: 20,
        y: 30,
        width: 140,
        height: 80,
      },
      {
        id: "note-label",
        type: "text",
        x: 50,
        y: 58,
        width: 80,
        height: 24,
        containerId: "note",
        text: "A note",
      },
    ];
    const frame: SceneElementLike = {
      id: "frame-1",
      type: "frame",
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      version: 1,
    };

    const result = addCanvasElements(
      scene,
      [frame],
      [{ frameId: "frame-1", childIds: ["note"] }],
      100,
    );

    expect(result.addedIds).toEqual(["frame-1"]);
    expect(result.elements.find((item) => item.id === "frame-1")).toBe(frame);
    expect(result.elements.find((item) => item.id === "note")?.frameId).toBe(
      "frame-1",
    );
    expect(
      result.elements.find((item) => item.id === "note-label")?.frameId,
    ).toBe("frame-1");
  });

  it("connects live elements with two-way arrow bindings", () => {
    const scene: SceneElementLike[] = [
      {
        id: "start",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        boundElements: null,
      },
      {
        id: "end",
        type: "ellipse",
        x: 250,
        y: 0,
        width: 100,
        height: 80,
        boundElements: [],
      },
    ];
    const arrow: SceneElementLike = {
      id: "arrow-1",
      type: "arrow",
      x: 50,
      y: 40,
      width: 250,
      height: 0,
      startBinding: null,
      endBinding: null,
    };

    const result = connectCanvasElements(
      scene,
      [arrow],
      [{ arrowId: "arrow-1", fromId: "start", toId: "end" }],
      100,
    );

    expect(result.addedIds).toEqual(["arrow-1"]);
    expect(result.elements.find((item) => item.id === "arrow-1")).toMatchObject({
      startBinding: { elementId: "start" },
      endBinding: { elementId: "end" },
    });
    expect(
      result.elements.find((item) => item.id === "start")?.boundElements,
    ).toContainEqual({ id: "arrow-1", type: "arrow" });
    expect(
      result.elements.find((item) => item.id === "end")?.boundElements,
    ).toContainEqual({ id: "arrow-1", type: "arrow" });
  });

  it("deletes dependent text and arrows without leaving broken bindings", () => {
    const scene: SceneElementLike[] = [
      {
        id: "start",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        boundElements: [
          { id: "start-label", type: "text" },
          { id: "arrow-1", type: "arrow" },
        ],
      },
      {
        id: "start-label",
        type: "text",
        x: 20,
        y: 25,
        width: 60,
        height: 24,
        containerId: "start",
        text: "Start",
      },
      {
        id: "end",
        type: "ellipse",
        x: 250,
        y: 0,
        width: 100,
        height: 80,
        boundElements: [{ id: "arrow-1", type: "arrow" }],
      },
      {
        id: "arrow-1",
        type: "arrow",
        x: 50,
        y: 40,
        width: 250,
        height: 0,
        startBinding: { elementId: "start" },
        endBinding: { elementId: "end" },
        boundElements: [{ id: "arrow-label", type: "text" }],
      },
      {
        id: "arrow-label",
        type: "text",
        x: 150,
        y: 30,
        width: 60,
        height: 24,
        containerId: "arrow-1",
        text: "then",
      },
    ];

    const result = deleteCanvasElements(scene, ["start"], 100);

    expect(result.deletedIds).toEqual(["start"]);
    expect(result.cascadeDeletedIds).toEqual([
      "arrow-1",
      "arrow-label",
      "start-label",
    ]);
    for (const id of ["start", "start-label", "arrow-1", "arrow-label"]) {
      expect(result.elements.find((item) => item.id === id)?.isDeleted).toBe(
        true,
      );
    }
    const end = result.elements.find((item) => item.id === "end");
    expect(end?.isDeleted).not.toBe(true);
    expect(end?.boundElements).toEqual([]);
  });

  it("returns a compact live snapshot with stable revisions and bound text", () => {
    const scene: SceneElementLike[] = [
      {
        id: "box",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        version: 2,
        boundElements: [{ id: "label", type: "text" }],
      },
      {
        id: "label",
        type: "text",
        x: 25,
        y: 45,
        width: 70,
        height: 20,
        containerId: "box",
        text: "Live label",
      },
      {
        id: "gone",
        type: "ellipse",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        isDeleted: true,
      },
    ];

    const snapshot = readCanvasSnapshot(scene);

    expect(snapshot.elementCount).toBe(1);
    expect(snapshot.elements).toEqual([
      expect.objectContaining({
        id: "box",
        type: "rectangle",
        text: "Live label",
      }),
    ]);
    expect(sceneRevision(scene)).toBe(sceneRevision([...scene].reverse()));
    expect(sceneRevision(scene)).not.toBe(
      sceneRevision(scene.map((item) => (item.id === "box" ? { ...item, x: 11 } : item))),
    );
  });
});
