import { ipAddress } from "@vercel/functions";
import { z } from "zod";
import type { AnalyticsEvent } from "./schema.js";

const ipSchema = z.union([z.ipv4(), z.ipv6()]);

/** Requires PostHog's Discard client IP data setting before deployment. */
export function posthogCaptureInput(event: AnalyticsEvent, request: Request) {
  // Vercel supplies x-real-ip. Do not trust an IP in the event body.
  const candidate = ipAddress(request);
  const ip = ipSchema.safeParse(candidate).success ? candidate : undefined;
  return {
    distinctId: event.distinct_id,
    event: event.event,
    disableGeoip: !ip,
    properties: {
      ...event.properties,
      // Missing/invalid IP must never fall back to the Vercel server location.
      $ip: ip ?? "",
      $process_person_profile: false,
    },
  };
}
