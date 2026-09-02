import { z } from "zod";

export const ANALYTICS_SCHEMA_VERSION = 1 as const;

export const WEBMCP_TOOL_NAMES = [
  "add_elements",
  "connect_elements",
  "delete_elements",
  "move_agent_cursor",
  "read_canvas",
  "read_selection",
  "set_agent_identity",
  "update_elements",
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];
export type WebMcpMode = "native" | "adapter" | "registration_error";
export type ToolExecutionErrorCode =
  | "invalid_input"
  | "protected_element"
  | "element_not_found"
  | "id_conflict"
  | "canvas_not_ready"
  | "operation_failed";

export interface ToolExecutionAnalytics {
  toolName: WebMcpToolName;
  outcome: "success" | "failure";
  durationMs: number;
  affectedCount: number;
  errorCode?: ToolExecutionErrorCode;
}

const analyticsIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9._:-]+$/);
const countSchema = z.number().int().min(0).max(100_000);
const durationSchema = z.number().int().min(0).max(600_000);
const commonProperties = {
  session_id: analyticsIdSchema,
  app_version: z.string().min(1).max(40),
  deployment_environment: z.enum([
    "production",
    "preview",
    "development",
    "test",
  ]),
  webmcp_mode: z.enum(["native", "adapter", "registration_error"]),
  schema_version: z.literal(ANALYTICS_SCHEMA_VERSION),
};

const eventEnvelope = <
  TName extends string,
  TProperties extends z.ZodRawShape,
>(
  event: TName,
  properties: TProperties,
) =>
  z
    .object({
      event: z.literal(event),
      distinct_id: analyticsIdSchema,
      properties: z.object({ ...commonProperties, ...properties }).strict(),
    })
    .strict();

export const analyticsEventSchema = z.discriminatedUnion("event", [
  eventEnvelope("agent_canvas_opened", {
    returning_visitor: z.boolean(),
    has_saved_canvas: z.boolean(),
    initial_element_count_bucket: z.enum(["0", "1_9", "10_49", "50_plus"]),
  }),
  eventEnvelope("webmcp_capability_detected", {
    capability: z.enum(["native", "adapter", "registration_error"]),
    tool_count: z.number().int().min(0).max(20),
  }),
  eventEnvelope("webmcp_tool_executed", {
    tool_name: z.enum(WEBMCP_TOOL_NAMES),
    outcome: z.enum(["success", "failure"]),
    duration_ms: durationSchema,
    affected_count: countSchema,
    element_count_after: countSchema,
    error_code: z
      .enum([
        "invalid_input",
        "protected_element",
        "element_not_found",
        "id_conflict",
        "canvas_not_ready",
        "operation_failed",
      ])
      .optional(),
  }),
  eventEnvelope("agent_work_completed", {
    duration_ms: durationSchema,
    tool_call_count: countSchema,
    cursor_move_count: countSchema,
    added_count: countSchema,
    updated_count: countSchema,
    deleted_count: countSchema,
    connected_count: countSchema,
    element_count_after: countSchema,
  }),
  eventEnvelope("human_canvas_edited", {
    element_count_before: countSchema,
    element_count_after: countSchema,
    after_agent_work: z.boolean(),
  }),
]);

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
export type AnalyticsEventName = AnalyticsEvent["event"];

export function bucketElementCount(
  elementCount: number,
): "0" | "1_9" | "10_49" | "50_plus" {
  if (elementCount <= 0) return "0";
  if (elementCount < 10) return "1_9";
  if (elementCount < 50) return "10_49";
  return "50_plus";
}
