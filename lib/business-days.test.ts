import { describe, expect, it } from "vitest";
import { averageBusinessDays, businessDaysBetween } from "./business-days";

describe("businessDaysBetween", () => {
  it("returns 0 for the same calendar day", () => {
    expect(businessDaysBetween("2026-07-13T09:00:00Z", "2026-07-13T17:00:00Z")).toBe(0);
  });

  it("counts a straight Mon->Fri span as 4 business days", () => {
    // 2026-07-13 is a Monday.
    expect(businessDaysBetween("2026-07-13", "2026-07-17")).toBe(4);
  });

  it("excludes weekend days from a span crossing a weekend", () => {
    // Monday 2026-07-13 -> Monday 2026-07-20 spans one full weekend.
    expect(businessDaysBetween("2026-07-13", "2026-07-20")).toBe(5);
  });

  it("returns 0 when the whole span is a single weekend", () => {
    // Saturday -> Monday.
    expect(businessDaysBetween("2026-07-18", "2026-07-20")).toBe(0);
  });

  it("returns null when end is before start", () => {
    expect(businessDaysBetween("2026-07-17", "2026-07-13")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(businessDaysBetween("not-a-date", "2026-07-13")).toBeNull();
  });
});

describe("averageBusinessDays", () => {
  it("averages across multiple pairs", () => {
    const result = averageBusinessDays([
      { startIso: "2026-07-13", endIso: "2026-07-14" }, // 1
      { startIso: "2026-07-13", endIso: "2026-07-15" }, // 2
    ]);
    expect(result).toBe(1.5);
  });

  it("skips unparseable pairs rather than throwing", () => {
    const result = averageBusinessDays([
      { startIso: "2026-07-13", endIso: "2026-07-14" }, // 1
      { startIso: "bad", endIso: "2026-07-15" },
    ]);
    expect(result).toBe(1);
  });

  it("returns null when there is no usable data", () => {
    expect(averageBusinessDays([])).toBeNull();
  });
});
