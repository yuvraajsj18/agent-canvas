import { analyticsEventSchema, type AnalyticsEvent } from "./schema.js";

const MAX_BODY_LENGTH = 8_192;

export interface AnalyticsRequestOptions {
  capture(event: AnalyticsEvent): void;
  allowedOrigins?: ReadonlySet<string>;
}

export async function handleAnalyticsRequest(
  request: Request,
  options: AnalyticsRequestOptions,
): Promise<Response> {
  if (request.method !== "POST") {
    return response(405, "method_not_allowed", { allow: "POST" });
  }

  const requestOrigin = new URL(request.url).origin;
  const allowedOrigins = options.allowedOrigins ?? new Set([requestOrigin]);
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) {
    return response(403, "origin_not_allowed");
  }

  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response(415, "json_required");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_LENGTH) {
    return response(413, "payload_too_large");
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_LENGTH) {
      return response(413, "payload_too_large");
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return response(400, "invalid_json");
  }

  const parsed = analyticsEventSchema.safeParse(body);
  if (!parsed.success) return response(400, "invalid_event");

  try {
    options.capture(parsed.data);
  } catch {
    return response(503, "analytics_unavailable");
  }

  return new Response(null, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}

function response(
  status: number,
  error: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error },
    {
      status,
      headers: { "cache-control": "no-store", ...headers },
    },
  );
}
