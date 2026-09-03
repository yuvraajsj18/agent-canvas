import { describe, expect, it } from "vitest";
import { posthogCaptureInput } from "./posthog-event";
import type { AnalyticsEvent } from "./schema";
import { PostHog } from "posthog-node";

const event: AnalyticsEvent = {
  event: "$pageview",
  distinct_id: "test-visitor",
  properties: {
    $session_id: "019efdb3-b000-7000-8000-000000000001",
    $current_url: "https://agent-canvas.yuvraj.tech/",
    $host: "agent-canvas.yuvraj.tech",
    $pathname: "/",
    app_version: "test",
    deployment_environment: "test",
    schema_version: 2,
    webmcp_mode: "native",
    returning_visitor: false,
    has_saved_canvas: false,
    initial_element_count_bucket: "0",
  },
};

describe("PostHog server capture", () => {
  it("sends the GeoIP override and no person profile through the actual Node SDK", async () => {
    const batches: { batch: { properties: Record<string, unknown> }[] }[] = [];
    const client = new PostHog("test-token", {
      host: "https://us.i.posthog.com",
      disableGeoip: true,
      disableCompression: true,
      fetchRetryCount: 0,
      flushAt: 1,
      flushInterval: 0,
      fetch: async (_url, options) => {
        batches.push(JSON.parse(String(options.body)));
        return { status: 200, text: async () => "ok", json: async () => ({}) };
      },
    });
    client.capture(posthogCaptureInput(event, new Request("https://agent-canvas.yuvraj.tech/api/events", {
      headers: { "x-real-ip": "203.0.113.10" },
    })));
    await client.shutdown();
    expect(batches).toHaveLength(1);
    const properties = batches[0].batch[0].properties;
    expect(properties).toMatchObject({ $ip: "203.0.113.10", $process_person_profile: false });
    expect(properties.$geoip_disable).not.toBe(true);
  });

  it.each(["203.0.113.10", "2001:db8::1"])("enables lookup for a valid request IP %s", (ip) => {
    const request = new Request("https://agent-canvas.yuvraj.tech/api/events", {
      headers: { "x-real-ip": ip },
    });
    expect(posthogCaptureInput(event, request)).toMatchObject({
      event: "$pageview",
      disableGeoip: false,
      properties: { $ip: ip, $process_person_profile: false },
    });
    expect(event.properties).not.toHaveProperty("$ip");
  });

  it.each(["", "invalid", "203.0.113.10, 203.0.113.11"])("prevents server-location fallback for invalid IP %s", (ip) => {
    const request = new Request("https://agent-canvas.yuvraj.tech/api/events", {
      headers: ip ? { "x-real-ip": ip } : {},
    });
    expect(posthogCaptureInput(event, request)).toMatchObject({
      disableGeoip: true,
      properties: { $ip: "", $process_person_profile: false },
    });
  });
});
