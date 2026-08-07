import { describe, expect, it } from "vitest";
import {
  isWithinReportRange,
  jamaicaMonthKeyFromTimestamp,
  jamaicaToday,
  monthKeyFromDateOnly,
  monthKeysInRange,
  parseReportDateRange,
  shiftIsoDate,
  yearToDateRange,
} from "./period";

const FALLBACK = { startIso: "2026-01-01", endIso: "2026-08-07" };

describe("parseReportDateRange (MINOR m-2)", () => {
  it("accepts a well-formed range", () => {
    expect(parseReportDateRange("2026-02-01", "2026-02-28", FALLBACK)).toEqual({
      startIso: "2026-02-01",
      endIso: "2026-02-28",
    });
  });

  it("falls back per-end for a blank or missing value", () => {
    expect(parseReportDateRange("2026-03-01", "", FALLBACK)).toEqual({
      startIso: "2026-03-01",
      endIso: FALLBACK.endIso,
    });
    expect(parseReportDateRange(null, undefined, FALLBACK)).toEqual(FALLBACK);
    expect(parseReportDateRange("  ", "  ", FALLBACK)).toEqual(FALLBACK);
  });

  it("REJECTS an unpadded date rather than coercing it (these strings are compared as strings)", () => {
    expect(parseReportDateRange("2026-1-5", "2026-02-28", FALLBACK)).toBeNull();
    expect(parseReportDateRange("2026-01-01", "2026-2-8", FALLBACK)).toBeNull();
  });

  it("REJECTS a REVERSED range", () => {
    expect(parseReportDateRange("2026-03-31", "2026-01-01", FALLBACK)).toBeNull();
    // Equal ends are a legitimate one-day range, not a reversal.
    expect(parseReportDateRange("2026-03-31", "2026-03-31", FALLBACK)).toEqual({
      startIso: "2026-03-31",
      endIso: "2026-03-31",
    });
  });

  it("REJECTS a reversal that only appears once the fallback fills the other end", () => {
    expect(parseReportDateRange("2027-01-01", "", FALLBACK)).toBeNull();
    expect(parseReportDateRange("", "2025-01-01", FALLBACK)).toBeNull();
  });

  it("REJECTS anything that could restructure a PostgREST filter expression", () => {
    for (const hostile of [
      "2026-01-01,or(id.gt.0)",
      "2026-01-01)",
      "2026-01-01 or true",
      "not-a-date",
      "20260101",
      "2026-01-01T00:00:00Z",
    ]) {
      expect(parseReportDateRange(hostile, "2026-12-31", FALLBACK)).toBeNull();
      expect(parseReportDateRange("2026-01-01", hostile, FALLBACK)).toBeNull();
    }
  });

  it("defaults to year-to-date when no fallback is supplied", () => {
    const parsed = parseReportDateRange(null, null);
    expect(parsed).toEqual(yearToDateRange());
  });
});

describe("shiftIsoDate", () => {
  it("shifts forward and back, staying zero-padded", () => {
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftIsoDate("2026-03-15", 0)).toBe("2026-03-15");
  });

  it("handles a leap day", () => {
    expect(shiftIsoDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftIsoDate("2028-03-01", -1)).toBe("2028-02-29");
  });
});

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
