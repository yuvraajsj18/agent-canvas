import { describe, expect, it, vi } from "vitest";
import { handleAnalyticsRequest } from "./server-handler";

const validEvent = {
  event: "$pageview",
  distinct_id: "visitor-1",
  properties: {
    $session_id: "019efdb3-b000-7000-8000-000000000001",
    $current_url: "https://agent-canvas.yuvraj.tech/",
    $host: "agent-canvas.yuvraj.tech",
    $pathname: "/",
    app_version: "0.2.0",
    deployment_environment: "production",
    webmcp_mode: "native",
    schema_version: 2,
    returning_visitor: false,
    has_saved_canvas: false,
    initial_element_count_bucket: "0",
  },
};

function request(body: unknown, origin = "https://agent-canvas.test") {
  return new Request("https://agent-canvas.test/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("analytics server handler", () => {
  it("accepts a same-origin allowlisted event", async () => {
    const capture = vi.fn();
    const response = await handleAnalyticsRequest(request(validEvent), {
      capture,
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(capture).toHaveBeenCalledWith(validEvent);
  });

  it("rejects foreign origins and extra properties", async () => {
    const capture = vi.fn();
    const foreignResponse = await handleAnalyticsRequest(
      request(validEvent, "https://noise.test"),
      { capture },
    );
    const extraResponse = await handleAnalyticsRequest(
      request({ ...validEvent, raw_prompt: "do not collect this" }),
      { capture },
    );

    expect(foreignResponse.status).toBe(403);
    expect(extraResponse.status).toBe(400);
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    { $ip: "203.0.113.10" },
    { $geoip_country_code: "US" },
    { $current_url: "https://agent-canvas.yuvraj.tech/?secret=value" },
    { $pathname: "/private-board" },
    { $session_id: "not-a-session" },
    { $session_id: "00000000-0000-4000-8000-000000000001" },
    { raw_prompt: "private" },
  ])("rejects unsafe properties %j", async (properties) => {
    const capture = vi.fn();
    const response = await handleAnalyticsRequest(request({
      ...validEvent,
      properties: { ...validEvent.properties, ...properties },
    }), { capture });
    expect(response.status).toBe(400);
    expect(capture).not.toHaveBeenCalled();
  });
});
