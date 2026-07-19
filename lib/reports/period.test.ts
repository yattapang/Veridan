import { describe, expect, it } from "vitest";
import {
  isWithinReportRange,
  jamaicaMonthKeyFromTimestamp,
  jamaicaToday,
  monthKeyFromDateOnly,
  monthKeysInRange,
  yearToDateRange,
} from "./period";

describe("monthKeyFromDateOnly", () => {
  it("takes the YYYY-MM prefix with no timezone shift", () => {
    expect(monthKeyFromDateOnly("2026-01-01")).toBe("2026-01");
    expect(monthKeyFromDateOnly("2026-12-31")).toBe("2026-12");
  });
});

describe("jamaicaMonthKeyFromTimestamp", () => {
  it("matches UTC for an instant well inside Jamaica's business day", () => {
    expect(jamaicaMonthKeyFromTimestamp("2026-07-18T15:00:00.000Z")).toBe("2026-07");
  });

  it("Dec 31 Jamaica-vs-UTC: a Dec 31 evening in Jamaica already Jan 1 UTC still buckets under December", () => {
    // 2026-12-31 23:00 Jamaica (UTC-5) = 2027-01-01 04:00 UTC.
    expect(jamaicaMonthKeyFromTimestamp("2027-01-01T04:00:00.000Z")).toBe("2026-12");
  });

  it("rolls over to January once it's actually Jamaica midnight", () => {
    // 2027-01-01 00:00 Jamaica (UTC-5) = 2027-01-01 05:00 UTC.
    expect(jamaicaMonthKeyFromTimestamp("2027-01-01T05:00:00.000Z")).toBe("2027-01");
  });

  it("accepts a Date instance directly", () => {
    expect(jamaicaMonthKeyFromTimestamp(new Date("2026-07-18T15:00:00.000Z"))).toBe("2026-07");
  });
});

describe("jamaicaToday", () => {
  it("shifts a late-UTC instant back to the correct Jamaica calendar day", () => {
    // 2027-01-01 02:00 UTC = 2026-12-31 21:00 Jamaica.
    expect(jamaicaToday(new Date("2027-01-01T02:00:00.000Z"))).toBe("2026-12-31");
  });
});

describe("yearToDateRange", () => {
  it("spans Jan 1 through today (Jamaica local), both inclusive", () => {
    const range = yearToDateRange(new Date("2026-07-18T15:00:00.000Z"));
    expect(range).toEqual({ startIso: "2026-01-01", endIso: "2026-07-18" });
  });
});

describe("isWithinReportRange", () => {
  const range = { startIso: "2026-01-01", endIso: "2026-07-18" };

  it("includes both endpoints", () => {
    expect(isWithinReportRange("2026-01-01", range)).toBe(true);
    expect(isWithinReportRange("2026-07-18", range)).toBe(true);
  });

  it("excludes dates outside the range", () => {
    expect(isWithinReportRange("2025-12-31", range)).toBe(false);
    expect(isWithinReportRange("2026-07-19", range)).toBe(false);
  });

  it("handles a timestamp string by comparing its date prefix", () => {
    expect(isWithinReportRange("2026-03-15T10:00:00.000Z", range)).toBe(true);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isWithinReportRange(null, range)).toBe(false);
    expect(isWithinReportRange(undefined, range)).toBe(false);
    expect(isWithinReportRange("", range)).toBe(false);
  });
});

describe("monthKeysInRange", () => {
  it("returns every month within a single year", () => {
    expect(monthKeysInRange({ startIso: "2026-01-01", endIso: "2026-03-31" })).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("returns a single key when start and end are in the same month", () => {
    expect(monthKeysInRange({ startIso: "2026-07-01", endIso: "2026-07-18" })).toEqual(["2026-07"]);
  });

  it("crosses a year boundary correctly (Dec -> Jan)", () => {
    expect(monthKeysInRange({ startIso: "2026-11-01", endIso: "2027-02-28" })).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });
});
