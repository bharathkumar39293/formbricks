import { describe, expect, it } from "vitest";
import { datePickerAdapter } from "./date-picker-adapter";

describe("datePickerAdapter: Core Verification", () => {
  it("UTC Reconstruction: Should map local selection to UTC midnight anchor", () => {
    // Select Apr 26 (Local)
    const localSelection = new Date(2024, 3, 26);

    // Format for persistence
    const persisted = datePickerAdapter.format("contact-iso", { from: localSelection, to: undefined });

    // Invariant: Result must be UTC midnight of that calendar day
    expect(persisted).toBe("2024-04-26T00:00:00.000Z");
  });

  it("Range Integrity: Should automatically swap inverted selections", () => {
    const f = new Date(2024, 3, 28);
    const t = new Date(2024, 3, 26);

    const formatted = datePickerAdapter.format("survey-legacy", { from: f, to: t });

    // Invariant: from <= to
    expect(formatted).toBe("2024-04-26,2024-04-28");
  });

  it("Structural Invalidation: Should reject corrupt inputs", () => {
    expect(datePickerAdapter.parse("2024-04-26,")).toBe(null);
    expect(datePickerAdapter.parse(["2024-04-26", "garbage"])).toBe(null);
  });
});
