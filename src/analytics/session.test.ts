import { describe, expect, it } from "vitest";
import { AnalyticsSession } from "./session";

describe("PostHog sessions", () => {
  const start = Date.UTC(2026, 8, 3, 12);
  function storage() {
    const values = new Map<string, string>();
    return {
      get length() { return values.size; },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => { values.delete(key); },
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    } satisfies Storage;
  }

  it("uses timestamped UUIDv7 IDs and shares active sessions between tabs", () => {
    const shared = storage();
    const one = new AnalyticsSession(shared).touch(start);
    const two = new AnalyticsSession(shared).touch(start + 1_000);
    expect(two).toBe(one);
    expect(parseInt(one.replaceAll("-", "").slice(0, 12), 16)).toBe(start);
    expect(one[14]).toBe("7");
    expect("89ab").toContain(one[19]);
  });

  it("rotates after thirty minutes of inactivity", () => {
    const session = new AnalyticsSession(storage());
    const first = session.touch(start);
    expect(session.touch(start + 29 * 60_000)).toBe(first);
    expect(session.touch(start + 59 * 60_000)).not.toBe(first);
  });

  it("rotates after 24 hours even with continued activity", () => {
    const session = new AnalyticsSession(storage());
    const first = session.touch(start);
    for (let minute = 1; minute < 24 * 60; minute += 1) {
      expect(session.touch(start + minute * 60_000)).toBe(first);
    }
    expect(session.touch(start + 24 * 60 * 60_000)).not.toBe(first);
  });

  it("recovers from malformed storage, blocked storage, and clock reversal", () => {
    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    } as unknown as Storage;
    const session = new AnalyticsSession(blocked);
    const first = session.touch(start);
    expect(session.touch(start + 1)).toBe(first);
    expect(session.touch(start - 1)).not.toBe(first);
    const malformed = { ...storage(), getItem: () => "invalid JSON" };
    expect(new AnalyticsSession(malformed).touch(start)[14]).toBe("7");
  });
});
