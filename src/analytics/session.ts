import { z } from "zod";

const SESSION_KEY = "agent-canvas.analytics.session.v2";
const IDLE_MS = 30 * 60 * 1_000;
const MAX_SESSION_MS = 24 * 60 * 60 * 1_000;
const sessionSchema = z.object({
  id: z.uuidv7(),
  startedAt: z.number().int().nonnegative(),
  lastActiveAt: z.number().int().nonnegative(),
});
type Session = z.infer<typeof sessionSchema>;

/** Shared across tabs; no timers, heartbeat events, or additional requests. */
export class AnalyticsSession {
  private fallback: Session | null = null;

  constructor(private readonly storage: Storage) {}

  touch(now: number): string {
    let session = this.fallback;
    try {
      const parsed = sessionSchema.safeParse(
        JSON.parse(this.storage.getItem(SESSION_KEY) ?? "null"),
      );
      if (parsed.success) session = parsed.data;
    } catch {
      // Use memory if storage is blocked or malformed.
    }
    if (
      !session ||
      session.startedAt > now ||
      session.lastActiveAt > now ||
      now - session.lastActiveAt >= IDLE_MS ||
      now - session.startedAt >= MAX_SESSION_MS
    ) {
      session = { id: uuidV7(now), startedAt: now, lastActiveAt: now };
    }
    session.lastActiveAt = now;
    this.fallback = session;
    try {
      this.storage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Analytics must remain optional when storage is unavailable.
    }
    return session.id;
  }
}

function uuidV7(now: number): string {
  const timestamp = Math.floor(now).toString(16).padStart(12, "0");
  const random = crypto.randomUUID();
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${random.slice(15)}`;
}
