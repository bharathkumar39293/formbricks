/**
 * date-picker-adapter.test.ts
 *
 * Vitest unit tests for the datePickerAdapter.
 * Covers: validation, strict parsing, UTC construction,
 *         range ordering, and all 3 serialization modes.
 */
import { describe, expect, test } from "vitest";
import {
  enforceRangeOrder,
  fromUTCDate,
  isValidCalendarDate,
  parseFromMode,
  parseYMDString,
  serializeToMode,
  toCalendarDate,
  toUTCEnd,
  toUTCStart,
} from "./date-picker-adapter";
import type { CalendarDate } from "./date-picker-adapter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Shorthand to build a CalendarDate literal */
const cd = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });

// ─── isValidCalendarDate ──────────────────────────────────────────────────────

describe("isValidCalendarDate", () => {
  test("accepts ordinary dates", () => {
    expect(isValidCalendarDate(2024, 1, 1)).toBe(true);
    expect(isValidCalendarDate(2024, 12, 31)).toBe(true);
    expect(isValidCalendarDate(2024, 3, 15)).toBe(true);
  });

  test("accepts Feb 29 on a leap year", () => {
    expect(isValidCalendarDate(2024, 2, 29)).toBe(true); // 2024 is a leap year
  });

  test("rejects Feb 29 on a non-leap year", () => {
    expect(isValidCalendarDate(2023, 2, 29)).toBe(false);
    expect(isValidCalendarDate(1900, 2, 29)).toBe(false); // 1900 is not a leap year
  });

  test("rejects logical overflows — Feb 30/31", () => {
    expect(isValidCalendarDate(2024, 2, 30)).toBe(false);
    expect(isValidCalendarDate(2024, 2, 31)).toBe(false);
  });

  test("rejects Apr/Jun/Sep/Nov with day 31", () => {
    expect(isValidCalendarDate(2024, 4, 31)).toBe(false);
    expect(isValidCalendarDate(2024, 6, 31)).toBe(false);
    expect(isValidCalendarDate(2024, 9, 31)).toBe(false);
    expect(isValidCalendarDate(2024, 11, 31)).toBe(false);
  });

  test("rejects month 0 and month 13", () => {
    expect(isValidCalendarDate(2024, 0, 15)).toBe(false);
    expect(isValidCalendarDate(2024, 13, 15)).toBe(false);
  });

  test("rejects day 0", () => {
    expect(isValidCalendarDate(2024, 3, 0)).toBe(false);
  });

  test("rejects non-integer inputs", () => {
    expect(isValidCalendarDate(2024, 3.5, 15)).toBe(false);
    expect(isValidCalendarDate(2024, 3, 15.9)).toBe(false);
  });
});

// ─── parseYMDString ───────────────────────────────────────────────────────────

describe("parseYMDString", () => {
  test("parses a plain YYYY-MM-DD string", () => {
    expect(parseYMDString("2024-03-15")).toEqual(cd(2024, 3, 15));
  });

  test("parses a full ISO string (only consumes the date prefix)", () => {
    expect(parseYMDString("2024-03-15T00:00:00.000Z")).toEqual(cd(2024, 3, 15));
    expect(parseYMDString("2024-03-15T23:59:59.999Z")).toEqual(cd(2024, 3, 15));
  });

  test("returns null for a malformed string", () => {
    expect(parseYMDString("not-a-date")).toBeNull();
    expect(parseYMDString("2024/03/15")).toBeNull(); // wrong separator
    expect(parseYMDString("")).toBeNull();
    expect(parseYMDString("20240315")).toBeNull(); // missing separators
  });

  test("returns null for a logically invalid date (overflow)", () => {
    expect(parseYMDString("2024-02-31")).toBeNull();
    expect(parseYMDString("2023-02-29")).toBeNull();
    expect(parseYMDString("2024-13-01")).toBeNull();
    expect(parseYMDString("2024-04-31")).toBeNull();
  });

  test("does NOT silently normalize invalid dates the way new Date() would", () => {
    // new Date("2024-02-31") normalizes to March 2nd — we must reject it
    const result = parseYMDString("2024-02-31");
    expect(result).toBeNull();
  });
});

// ─── fromUTCDate ──────────────────────────────────────────────────────────────

describe("fromUTCDate", () => {
  test("extracts calendar components using UTC getters", () => {
    const date = new Date(Date.UTC(2024, 2, 15)); // March 15 2024
    expect(fromUTCDate(date)).toEqual(cd(2024, 3, 15));
  });

  test("does not shift the day due to local timezone offsets", () => {
    // 2024-03-15T00:00:00.000Z must stay as March 15, regardless of local tz
    const date = new Date("2024-03-15T00:00:00.000Z");
    expect(fromUTCDate(date).day).toBe(15);
    expect(fromUTCDate(date).month).toBe(3);
  });
});

// ─── toCalendarDate ───────────────────────────────────────────────────────────

describe("toCalendarDate", () => {
  test("uses local getters — correctly reads a local-midnight Date", () => {
    // Simulate what react-day-picker gives us when a user clicks May 20
    const localMidnight = new Date(2026, 4, 20); // May 20 2026 at local midnight
    const result = toCalendarDate(localMidnight);
    expect(result).toEqual({ year: 2026, month: 5, day: 20 });
  });
});

// ─── toUTCStart / toUTCEnd ───────────────────────────────────────────────────

describe("toUTCStart", () => {
  test("produces 00:00:00.000Z by default", () => {
    const result = toUTCStart(cd(2024, 3, 15));
    expect(result.toISOString()).toBe("2024-03-15T00:00:00.000Z");
  });

  test("applies hour/minute overrides", () => {
    const result = toUTCStart(cd(2024, 3, 15), 9, 30);
    expect(result.toISOString()).toBe("2024-03-15T09:30:00.000Z");
  });
});

describe("toUTCEnd", () => {
  test("produces 23:59:59.999Z by default", () => {
    const result = toUTCEnd(cd(2024, 3, 15));
    expect(result.toISOString()).toBe("2024-03-15T23:59:59.999Z");
  });

  test("applies hour/minute overrides, keeping seconds/ms at max (inclusive)", () => {
    const result = toUTCEnd(cd(2024, 3, 15), 17, 30);
    expect(result.toISOString()).toBe("2024-03-15T17:30:59.999Z");
  });
});

// ─── enforceRangeOrder ────────────────────────────────────────────────────────

describe("enforceRangeOrder", () => {
  const march1 = new Date(Date.UTC(2024, 2, 1));
  const march31 = new Date(Date.UTC(2024, 2, 31));

  test("returns [from, to] unchanged when already ordered", () => {
    const [a, b] = enforceRangeOrder(march1, march31);
    expect(a).toEqual(march1);
    expect(b).toEqual(march31);
  });

  test("swaps when from > to", () => {
    const [a, b] = enforceRangeOrder(march31, march1);
    expect(a).toEqual(march1);
    expect(b).toEqual(march31);
  });

  test("handles equal dates without throwing", () => {
    const [a, b] = enforceRangeOrder(march1, march1);
    expect(a).toEqual(march1);
    expect(b).toEqual(march1);
  });
});

// ─── parseFromMode ────────────────────────────────────────────────────────────

describe("parseFromMode — contact-iso", () => {
  test("parses a valid ISO string into a single CalendarDate", () => {
    const result = parseFromMode("contact-iso", "2024-03-15T00:00:00.000Z");
    expect(result.from).toEqual(cd(2024, 3, 15));
    expect(result.to).toBeNull();
  });

  test("returns null from for a malformed value", () => {
    const result = parseFromMode("contact-iso", "not-a-date");
    expect(result.from).toBeNull();
  });
});

describe("parseFromMode — segment-range", () => {
  test("parses both ISO strings into CalendarDate pair", () => {
    const result = parseFromMode("segment-range", ["2024-03-01T00:00:00.000Z", "2024-03-31T23:59:59.999Z"]);
    expect(result.from).toEqual(cd(2024, 3, 1));
    expect(result.to).toEqual(cd(2024, 3, 31));
  });

  test("returns null components for invalid strings", () => {
    const result = parseFromMode("segment-range", ["bad", "2024-03-31"]);
    expect(result.from).toBeNull();
    expect(result.to).toEqual(cd(2024, 3, 31));
  });
});

describe("parseFromMode — analysis", () => {
  test("extracts CalendarDate from DateRange using UTC getters", () => {
    const result = parseFromMode("analysis", {
      from: new Date("2024-03-01T00:00:00.000Z"),
      to: new Date("2024-03-31T23:59:59.999Z"),
    });
    expect(result.from).toEqual(cd(2024, 3, 1));
    expect(result.to).toEqual(cd(2024, 3, 31));
  });

  test("returns null for undefined from/to", () => {
    const result = parseFromMode("analysis", { from: undefined, to: undefined });
    expect(result.from).toBeNull();
    expect(result.to).toBeNull();
  });
});

// ─── serializeToMode ─────────────────────────────────────────────────────────

describe("serializeToMode — contact-iso", () => {
  test("serializes a single date to a UTC ISO string at 00:00:00.000Z", () => {
    const result = serializeToMode("contact-iso", cd(2024, 3, 15));
    expect(result).toBe("2024-03-15T00:00:00.000Z");
  });
});

describe("serializeToMode — segment-range", () => {
  test("serializes a range to [start ISO, end ISO] with correct UTC boundaries", () => {
    const [from, to] = serializeToMode("segment-range", cd(2024, 3, 1), cd(2024, 3, 31));
    expect(from).toBe("2024-03-01T00:00:00.000Z");
    expect(to).toBe("2024-03-31T23:59:59.999Z");
  });

  test("auto-swaps a reversed range", () => {
    const [from, to] = serializeToMode("segment-range", cd(2024, 3, 31), cd(2024, 3, 1));
    expect(from).toBe("2024-03-01T00:00:00.000Z");
    expect(to).toBe("2024-03-31T23:59:59.999Z");
  });

  test("throws when `to` is missing", () => {
    expect(() => serializeToMode("segment-range", cd(2024, 3, 1))).toThrow();
  });
});

describe("serializeToMode — analysis", () => {
  test("produces a DateRange with UTC day boundaries by default", () => {
    const result = serializeToMode("analysis", cd(2024, 3, 1), cd(2024, 3, 31));
    expect(result.from?.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    expect(result.to?.toISOString()).toBe("2024-03-31T23:59:59.999Z");
  });

  test("applies time overrides when provided", () => {
    const result = serializeToMode("analysis", cd(2024, 3, 1), cd(2024, 3, 31), {
      fromHour: 9,
      fromMinute: 0,
      toHour: 17,
      toMinute: 30,
    });
    expect(result.from?.toISOString()).toBe("2024-03-01T09:00:00.000Z");
    expect(result.to?.toISOString()).toBe("2024-03-31T17:30:59.999Z");
  });

  test("auto-swaps a reversed range even with time overrides", () => {
    // User picks "from" as March 31 and "to" as March 1 — must be corrected
    const result = serializeToMode("analysis", cd(2024, 3, 31), cd(2024, 3, 1));
    expect(result.from!.getTime()).toBeLessThan(result.to!.getTime());
  });

  test("throws when `to` is missing", () => {
    expect(() => serializeToMode("analysis", cd(2024, 3, 1))).toThrow();
  });
});

// ─── Round-trip integrity ─────────────────────────────────────────────────────

describe("round-trip: serialize → parse → serialize produces identical output", () => {
  test("contact-iso round-trip", () => {
    const original = serializeToMode("contact-iso", cd(2024, 3, 15));
    const { from } = parseFromMode("contact-iso", original);
    const restored = serializeToMode("contact-iso", from!);
    expect(restored).toBe(original);
  });

  test("segment-range round-trip", () => {
    const original = serializeToMode("segment-range", cd(2024, 3, 1), cd(2024, 3, 31));
    const { from, to } = parseFromMode("segment-range", original);
    const restored = serializeToMode("segment-range", from!, to!);
    expect(restored).toEqual(original);
  });

  test("analysis round-trip (no time override)", () => {
    const original = serializeToMode("analysis", cd(2024, 3, 1), cd(2024, 3, 31));
    const { from, to } = parseFromMode("analysis", original);
    const restored = serializeToMode("analysis", from!, to!);
    expect(restored.from?.toISOString()).toBe(original.from?.toISOString());
    expect(restored.to?.toISOString()).toBe(original.to?.toISOString());
  });
});
