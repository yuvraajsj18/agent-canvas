import { describe, expect, it } from "vitest";
import { analyticsEventSchema, bucketElementCount } from "./schema";

const baseProperties = {
  $session_id: "019efdb3-b000-7000-8000-000000000001",
  $current_url: "https://agent-canvas.yuvraj.tech/",
  $host: "agent-canvas.yuvraj.tech",
  $pathname: "/",
  app_version: "0.2.0",
  deployment_environment: "test" as const,
  webmcp_mode: "native" as const,
  schema_version: 2 as const,
};

describe("analytics event schema", () => {
  it("accepts the approved traffic event", () => {
    expect(
      analyticsEventSchema.safeParse({
        event: "$pageview",
        distinct_id: "visitor-1",
        properties: {
          ...baseProperties,
          returning_visitor: false,
          has_saved_canvas: true,
          initial_element_count_bucket: "10_49",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects unapproved content and raw errors", () => {
    const parsed = analyticsEventSchema.safeParse({
      event: "webmcp_tool_executed",
      distinct_id: "visitor-1",
      properties: {
        ...baseProperties,
        tool_name: "add_elements",
        outcome: "failure",
        duration_ms: 120,
        affected_count: 2,
        element_count_after: 0,
        error_code: "operation_failed",
        canvas_text: "private board text",
        raw_error: "sensitive stack",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("uses stable, low-cardinality element buckets", () => {
    expect([0, 1, 9, 10, 49, 50].map(bucketElementCount)).toEqual([
      "0",
      "1_9",
      "1_9",
      "10_49",
      "10_49",
      "50_plus",
    ]);
  });
});
