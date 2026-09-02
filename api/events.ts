import { waitUntil } from "@vercel/functions";
import { PostHog } from "posthog-node";
import { handleAnalyticsRequest } from "../src/analytics/server-handler.js";
import type { AnalyticsEvent } from "../src/analytics/schema.js";

const POSTHOG_HOSTS = new Set([
  "https://us.i.posthog.com",
  "https://eu.i.posthog.com",
]);

export default {
  fetch(request: Request): Promise<Response> {
    const token = process.env.POSTHOG_PROJECT_TOKEN;
    const host = normalizeHost(process.env.POSTHOG_HOST);
    if (!token || !host) {
      return Promise.resolve(
        Response.json(
          { error: "analytics_not_configured" },
          { status: 503, headers: { "cache-control": "no-store" } },
        ),
      );
    }

    return handleAnalyticsRequest(request, {
      capture(event) {
        waitUntil(deliverEvent(token, host, event));
      },
    });
  },
};

async function deliverEvent(
  token: string,
  host: string,
  event: AnalyticsEvent,
): Promise<void> {
  const posthog = new PostHog(token, {
    host,
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
  });
  posthog.capture({
    distinctId: event.distinct_id,
    event: event.event,
    properties: {
      ...event.properties,
      $process_person_profile: false,
    },
  });
  await posthog.shutdown();
}

function normalizeHost(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\/$/, "");
  return POSTHOG_HOSTS.has(normalized) ? normalized : null;
}
