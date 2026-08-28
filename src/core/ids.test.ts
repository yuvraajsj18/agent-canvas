import { describe, expect, it } from "vitest";
import { stableId } from "./ids";

describe("stableId", () => {
  it("returns the same compact ID for the same semantic parts", () => {
    expect(stableId("change", "launch", "record-demo")).toBe(
      stableId("change", "launch", "record-demo"),
    );
    expect(stableId("change", "launch", "record-demo")).not.toBe(
      stableId("change", "launch", "edit-demo"),
    );
    expect(stableId("change", "launch", "record-demo")).toMatch(
      /^change_[a-z0-9]+$/,
    );
  });
});
