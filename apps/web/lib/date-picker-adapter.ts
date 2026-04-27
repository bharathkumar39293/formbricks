import { DateRange } from "react-day-picker";

export type DatePickerMode = "default" | "analysis" | "contact-iso" | "segment-range" | "survey-legacy";

/**
 * UTC RECONSTRUCTION:
 * To handle persistence consistently across timezones, we extract local components
 * and rebuild them into normalized UTC instants.
 *
 * INVARIANTS:
 * - Start dates / Single dates: Standardized to UTC midnight (00:00:00.000Z).
 * - Range upper bounds: Standardized to UTC end-of-day (23:59:59.999Z).
 */
const toUTC = (d: Date, isEnd = false): Date =>
  new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      isEnd ? 23 : 0,
      isEnd ? 59 : 0,
      isEnd ? 59 : 0,
      isEnd ? 999 : 0
    )
  );

/**
 * datePickerAdapter:
 * Normalization utility for divergent date persistence contracts.
 */
export const datePickerAdapter = {
  /**
   * PARSE: Ingests Strings, Arrays, Dates, or DateRanges and returns the Domain Truth (DateRange).
   */
  parse: (val: any): DateRange | null => {
    if (!val) return null;

    if (typeof val === "object" && !Array.isArray(val) && !(val instanceof Date) && "from" in val) {
      return {
        from: val.from instanceof Date ? val.from : undefined,
        to: val.to instanceof Date ? val.to : undefined,
      };
    }

    const s = (v: string) => {
      if (!v) return null;
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
      if (m) {
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    };

    if (Array.isArray(val)) {
      if (val.length !== 2) return null;
      const f = s(val[0]);
      const t = s(val[1]);
      return f && t ? { from: f, to: t } : null;
    }

    if (typeof val === "string" && val.includes(",")) {
      const parts = val.split(",");
      if (parts.length !== 2) return null;
      const f = s(parts[0]);
      const t = s(parts[1]);
      return f && t ? { from: f, to: t } : null;
    }

    const res = val instanceof Date ? val : typeof val === "string" ? s(val) : null;
    return res ? { from: res, to: undefined } : null;
  },

  /**
   * FORMAT: Maps Domain Truth to Persistence Representations.
   * - Internal state (DateRange) = source of truth.
   * - Serialized string = persistence format.
   */
  format: (mode: DatePickerMode, range: DateRange | null): any => {
    if (!range?.from) {
      if (mode === "segment-range") return [null, null];
      if (mode === "analysis") return undefined;
      return null;
    }

    let f = range.from;
    let t = range.to;
    if (f && t && f.getTime() > t.getTime()) [f, t] = [t, f];

    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    switch (mode) {
      case "default":
        return t ? { from: f, to: t } : f;
      case "contact-iso":
        return toUTC(f).toISOString();
      case "segment-range":
        return t ? [toUTC(f).toISOString(), toUTC(t, true).toISOString()] : [null, null];
      case "survey-legacy":
        return t ? `${ymd(f)},${ymd(t)}` : ymd(f);
      case "analysis":
        return { from: f, to: t };
      default:
        return null;
    }
  },
};
