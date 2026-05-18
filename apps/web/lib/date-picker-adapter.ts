/**
 * date-picker-adapter.ts
 *
 * Centralized date parsing and serialization for UnifiedDatePicker.
 * All persisted values are normalized to UTC day boundaries.
 *
 * Invariants:
 *   - No raw new Date(string) calls — timezone-unsafe, strictly forbidden
 *   - Logical overflow validation (e.g. Feb 31 is rejected, not silently normalized)
 *   - Range ordering enforced: from <= to, auto-swap, never throws
 *   - Start of day : 00:00:00.000Z
 *   - End of day   : 23:59:59.999Z  (or HH:MM:59.999Z when time override is active)
 *
 * Supported modes:
 *   contact-iso    → single ISO string          "2024-03-15T00:00:00.000Z"
 *   segment-range  → [ISO, ISO] tuple            ["2024-03-01T...", "2024-03-31T..."]
 *   analysis       → runtime DateRange object    { from: Date, to: Date }
 *                    (supports optional HH:MM time overrides)
 */
import type { DateRange } from "react-day-picker";

// ─── Public Re-export ─────────────────────────────────────────────────────────
// Consumers can import DateRange from here instead of react-day-picker directly,
// keeping the import surface stable if we ever swap the underlying library.
export type { DateRange };

// ─── Internal Types ───────────────────────────────────────────────────────────

/**
 * Explicit calendar components — the safe intermediate representation.
 * All parsing produces a CalendarDate; all serialization consumes one.
 * month is 1-indexed (1 = January, 12 = December).
 */
export interface CalendarDate {
  readonly year: number;
  readonly month: number; // 1–12
  readonly day: number;
}

/**
 * Optional time overrides for analysis mode.
 * When provided, the start/end times are set to the given HH:MM
 * rather than the default 00:00 / 23:59 day boundaries.
 */
export interface TimeOverride {
  readonly fromHour?: number; // 0–23
  readonly fromMinute?: number; // 0–59
  readonly toHour?: number; // 0–23
  readonly toMinute?: number; // 0–59
}

/** The three supported serialization modes for this PR. */
export type AdapterMode = "contact-iso" | "segment-range" | "analysis";

/**
 * Maps each AdapterMode to its serialized value type.
 * Use this instead of loose string/array types in consuming components.
 */
export type ModeValue<M extends AdapterMode> = M extends "contact-iso"
  ? string
  : M extends "segment-range"
    ? [string, string]
    : M extends "analysis"
      ? DateRange
      : never;

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Returns the number of days in the given month/year.
 * Uses Date.UTC with day=0 (last day of previous month) trick.
 * Safe: constructed from integers, not a string.
 */
function daysInMonth(year: number, month: number): number {
  // Date.UTC(year, month, 0) → last day of (month - 1), i.e. last day of `month`
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Returns true only if (year, month, day) is a real existing calendar date.
 * Rejects logical overflows like Feb 30, Apr 31, etc.
 *
 * @example
 * isValidCalendarDate(2024, 2, 29) → true  (2024 is a leap year)
 * isValidCalendarDate(2023, 2, 29) → false (2023 is not a leap year)
 * isValidCalendarDate(2024, 4, 31) → false (April has 30 days)
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Strictly parses a YYYY-MM-DD prefix from an ISO string.
 * Returns null for malformed input or logically invalid dates.
 *
 * NEVER uses new Date(string) — that path applies local timezone offsets
 * and silently normalizes overflows (e.g. "2024-02-31" → March 2nd).
 *
 * @example
 * parseYMDString("2024-03-15")              → { year: 2024, month: 3, day: 15 }
 * parseYMDString("2024-03-15T00:00:00.000Z") → { year: 2024, month: 3, day: 15 }
 * parseYMDString("2024-02-31")              → null  (overflow rejected)
 * parseYMDString("not-a-date")             → null
 */
export function parseYMDString(s: string): CalendarDate | null {
  // Accepts full ISO strings — only the YYYY-MM-DD prefix is consumed
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (!isValidCalendarDate(year, month, day)) return null;

  return { year, month, day };
}

/**
 * Extracts calendar components from a Date object using UTC getters.
 * Safe to call on any Date that was constructed via Date.UTC().
 */
export function fromUTCDate(date: Date): CalendarDate {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1, // UTC month is 0-indexed; normalize to 1-indexed
    day: date.getUTCDate(),
  };
}

/**
 * Extracts calendar components from a browser-generated Date using LOCAL getters.
 * Use this ONLY for dates coming from UI interactions (react-day-picker onSelect).
 * The browser constructs these at local midnight — UTC getters would shift the day
 * for users in positive timezone offsets (IST, JST, etc.).
 *
 * DO NOT use for stored/persisted dates — use fromUTCDate() for those.
 */
export function toCalendarDate(date: Date): CalendarDate {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

// ─── UTC Construction ─────────────────────────────────────────────────────────

/**
 * Constructs a Date at the start boundary of the given UTC day.
 * Default: 00:00:00.000Z
 * With time override: HH:MM:00.000Z
 */
export function toUTCStart(cd: CalendarDate, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(cd.year, cd.month - 1, cd.day, hour, minute, 0, 0));
}

/**
 * Constructs a Date at the end boundary of the given UTC day.
 * Default: 23:59:59.999Z
 * With time override: HH:MM:59.999Z  (seconds/ms stay at max for inclusive range queries)
 */
export function toUTCEnd(cd: CalendarDate, hour = 23, minute = 59): Date {
  return new Date(Date.UTC(cd.year, cd.month - 1, cd.day, hour, minute, 59, 999));
}

// ─── Range Ordering ───────────────────────────────────────────────────────────

/**
 * Ensures the range is chronologically ordered (from <= to).
 * Silently swaps if the caller passed them in reverse — never throws.
 *
 * @example
 * enforceRangeOrder(march15, march1) → [march1, march15]
 */
export function enforceRangeOrder(from: Date, to: Date): [Date, Date] {
  return from.getTime() <= to.getTime() ? [from, to] : [to, from];
}

// ─── Mode Parsing (Deserialization) ───────────────────────────────────────────

function parseContactIso(value: string): { from: CalendarDate | null; to: null } {
  return { from: parseYMDString(value), to: null };
}

function parseSegmentRange(value: [string, string]): {
  from: CalendarDate | null;
  to: CalendarDate | null;
} {
  return {
    from: parseYMDString(value[0]),
    to: parseYMDString(value[1]),
  };
}

function parseAnalysis(value: DateRange): { from: CalendarDate | null; to: CalendarDate | null } {
  return {
    from: value.from ? fromUTCDate(value.from) : null,
    to: value.to ? fromUTCDate(value.to) : null,
  };
}

// ─── Mode Serialization ───────────────────────────────────────────────────────

function serializeContactIso(from: CalendarDate): string {
  return toUTCStart(from).toISOString();
}

function isCalendarDateAfter(a: CalendarDate, b: CalendarDate): boolean {
  if (a.year !== b.year) return a.year > b.year;
  if (a.month !== b.month) return a.month > b.month;
  return a.day > b.day;
}

function serializeSegmentRange(from: CalendarDate, to: CalendarDate): [string, string] {
  const [orderedFrom, orderedTo] = isCalendarDateAfter(from, to) ? [to, from] : [from, to];
  return [toUTCStart(orderedFrom).toISOString(), toUTCEnd(orderedTo).toISOString()];
}

function serializeAnalysis(from: CalendarDate, to: CalendarDate, time?: TimeOverride): DateRange {
  const [orderedFrom, orderedTo] = isCalendarDateAfter(from, to) ? [to, from] : [from, to];
  return {
    from: toUTCStart(orderedFrom, time?.fromHour, time?.fromMinute),
    to: toUTCEnd(orderedTo, time?.toHour, time?.toMinute),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses a serialized mode value back into CalendarDate components.
 *
 * Returns { from, to } where either component may be null if the
 * input is missing, malformed, or represents a logically invalid date.
 *
 * @example — contact-iso
 * parseFromMode("contact-iso", "2024-03-15T00:00:00.000Z")
 * → { from: { year: 2024, month: 3, day: 15 }, to: null }
 *
 * @example — segment-range
 * parseFromMode("segment-range", ["2024-03-01T00:00:00.000Z", "2024-03-31T23:59:59.999Z"])
 * → { from: { year: 2024, month: 3, day: 1 }, to: { year: 2024, month: 3, day: 31 } }
 *
 * @example — analysis
 * parseFromMode("analysis", { from: new Date("2024-03-01T00:00:00.000Z"), to: ... })
 * → { from: { year: 2024, month: 3, day: 1 }, to: { ... } }
 */
export function parseFromMode<M extends AdapterMode>(
  mode: M,
  value: ModeValue<M>
): { from: CalendarDate | null; to: CalendarDate | null } {
  switch (mode) {
    case "contact-iso":
      return parseContactIso(value as string);
    case "segment-range":
      return parseSegmentRange(value as [string, string]);
    case "analysis":
      return parseAnalysis(value as DateRange);
    default: {
      // Exhaustiveness check — TypeScript will catch unhandled modes at compile time
      const _exhaustive: never = mode;
      throw new Error(`Unknown adapter mode: ${_exhaustive}`);
    }
  }
}

/**
 * Serializes CalendarDate components into the target mode format.
 *
 * - Range ordering is always enforced (from <= to, auto-swap).
 * - timeOverride is silently ignored for non-analysis modes.
 * - Throws if a range mode is called without a `to` date.
 *
 * @example — contact-iso (single date)
 * serializeToMode("contact-iso", { year: 2024, month: 3, day: 15 })
 * → "2024-03-15T00:00:00.000Z"
 *
 * @example — segment-range
 * serializeToMode("segment-range", { year: 2024, month: 3, day: 1 }, { year: 2024, month: 3, day: 31 })
 * → ["2024-03-01T00:00:00.000Z", "2024-03-31T23:59:59.999Z"]
 *
 * @example — analysis with time override
 * serializeToMode("analysis", fromDate, toDate, { fromHour: 9, fromMinute: 0, toHour: 17, toMinute: 30 })
 * → { from: Date(09:00:00.000Z), to: Date(17:30:59.999Z) }
 */
export function serializeToMode<M extends AdapterMode>(
  mode: M,
  from: CalendarDate,
  to?: CalendarDate,
  timeOverride?: TimeOverride
): ModeValue<M> {
  switch (mode) {
    case "contact-iso":
      return serializeContactIso(from) as ModeValue<M>;

    case "segment-range": {
      if (!to) throw new Error("[datePickerAdapter] segment-range requires both `from` and `to`.");
      return serializeSegmentRange(from, to) as ModeValue<M>;
    }

    case "analysis": {
      if (!to) throw new Error("[datePickerAdapter] analysis mode requires both `from` and `to`.");
      return serializeAnalysis(from, to, timeOverride) as ModeValue<M>;
    }

    default: {
      const _exhaustive: never = mode;
      throw new Error(`[datePickerAdapter] Unknown mode: ${_exhaustive}`);
    }
  }
}
