import { describe, expect, it } from "vitest";
import {
  addElementsSchema,
  connectElementsSchema,
  deleteElementsSchema,
  moveAgentCursorSchema,
  updateElementsSchema,
} from "./schemas";

describe("direct WebMCP input validation", () => {
  it("accepts precise direct edits", () => {
    expect(
      addElementsSchema.safeParse({
        elements: [
          {
            id: "step-1",
            type: "rectangle",
            x: 100,
            y: 120,
            width: 180,
            height: 90,
            text: "First step",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      updateElementsSchema.safeParse({
        updates: [{ id: "step-1", x: 140, text: "Updated step" }],
      }).success,
    ).toBe(true);
    expect(deleteElementsSchema.safeParse({ ids: ["step-1"] }).success).toBe(
      true,
    );
    expect(
      connectElementsSchema.safeParse({
        connections: [
          { id: "flow-1", fromId: "step-1", toId: "step-2", label: "then" },
        ],
      }).success,
    ).toBe(true);
    expect(
      moveAgentCursorSchema.safeParse({
        x: 420,
        y: 260,
        activity: "thinking",
      }).success,
    ).toBe(true);
  });

  it("rejects ambiguous, duplicate, or unsafe edits", () => {
    expect(
      addElementsSchema.safeParse({
        elements: [
          { id: "same", type: "rectangle", x: 0, y: 0 },
          { id: "same", type: "ellipse", x: 200, y: 0 },
        ],
      }).success,
    ).toBe(false);
    expect(
      updateElementsSchema.safeParse({ updates: [{ id: "step-1" }] }).success,
    ).toBe(false);
    expect(
      updateElementsSchema.safeParse({
        updates: [{ id: "step-1", x: Number.POSITIVE_INFINITY }],
      }).success,
    ).toBe(false);
    expect(
      connectElementsSchema.safeParse({
        connections: [{ id: "loop", fromId: "step-1", toId: "step-1" }],
      }).success,
    ).toBe(false);
    expect(
      moveAgentCursorSchema.safeParse({
        x: 0,
        y: 0,
        activity: "teleporting",
      }).success,
    ).toBe(false);
  });
});
