import { describe, expect, it } from "vitest";
import {
  computeAverageOrderValue,
  computeAverageTurnaroundBusinessDays,
  computeConversionRate,
  computeEffectiveMarginPct,
  computeMonthlyConversion,
  findMarginBreaches,
  getCurrentQuarterRange,
  isConversionEarlyWarning,
  isWithinRange,
  lastTwoFullMonthKeys,
  monthKey,
} from "./kpis";

describe("getCurrentQuarterRange", () => {
  it("returns Q1 for a February date", () => {
    expect(getCurrentQuarterRange(new Date(Date.UTC(2026, 1, 15)))).toEqual({
      startIso: "2026-01-01",
      endIsoExclusive: "2026-04-01",
    });
  });

  it("returns Q3 for a July date", () => {
    expect(getCurrentQuarterRange(new Date(Date.UTC(2026, 6, 15)))).toEqual({
      startIso: "2026-07-01",
      endIsoExclusive: "2026-10-01",
    });
  });

  it("rolls Q4 into January of the following year", () => {
    expect(getCurrentQuarterRange(new Date(Date.UTC(2026, 11, 20)))).toEqual({
      startIso: "2026-10-01",
      endIsoExclusive: "2027-01-01",
    });
  });
});

describe("isWithinRange", () => {
  const range = { startIso: "2026-07-01", endIsoExclusive: "2026-10-01" };
  it("includes the start boundary", () => {
    expect(isWithinRange("2026-07-01T00:00:00Z", range)).toBe(true);
  });
  it("excludes the end boundary", () => {
    expect(isWithinRange("2026-10-01T00:00:00Z", range)).toBe(false);
  });
  it("returns false for null/undefined", () => {
    expect(isWithinRange(null, range)).toBe(false);
    expect(isWithinRange(undefined, range)).toBe(false);
  });
});

describe("monthKey", () => {
  it("extracts YYYY-MM", () => {
    expect(monthKey("2026-07-15T12:00:00Z")).toBe("2026-07");
  });
});

describe("lastTwoFullMonthKeys", () => {
  it("returns the two months before the current one, oldest first", () => {
    expect(lastTwoFullMonthKeys(new Date(Date.UTC(2026, 6, 15)))).toEqual(["2026-05", "2026-06"]);
  });

  it("handles a year rollover", () => {
    expect(lastTwoFullMonthKeys(new Date(Date.UTC(2026, 1, 15)))).toEqual(["2025-12", "2026-01"]);
  });
});

describe("computeConversionRate", () => {
  it("computes accepted / (sent+accepted+declined+expired)", () => {
    const result = computeConversionRate([
      { status: "accepted" },
      { status: "accepted" },
      { status: "declined" },
      { status: "sent" },
      { status: "expired" },
      { status: "draft" }, // excluded
      { status: "approved" }, // excluded
    ]);
    expect(result.acceptedCount).toBe(2);
    expect(result.resolvedCount).toBe(5);
    expect(result.conversionPct).toBeCloseTo(40, 5);
  });

  it("returns null conversionPct when there is no data", () => {
    expect(computeConversionRate([]).conversionPct).toBeNull();
  });
});

describe("computeMonthlyConversion / isConversionEarlyWarning", () => {
  const now = new Date(Date.UTC(2026, 6, 15)); // July 2026 -> full months are May, June

  it("trips when both of the last two full months are below 25%", () => {
    const monthly = computeMonthlyConversion([
      { status: "sent", outcomeDateIso: "2026-05-05" },
      { status: "declined", outcomeDateIso: "2026-05-10" },
      { status: "declined", outcomeDateIso: "2026-05-15" },
      { status: "declined", outcomeDateIso: "2026-05-20" }, // May: 0/4 = 0%
      { status: "sent", outcomeDateIso: "2026-06-05" },
      { status: "declined", outcomeDateIso: "2026-06-10" },
      { status: "declined", outcomeDateIso: "2026-06-15" },
      { status: "declined", outcomeDateIso: "2026-06-20" }, // June: 0/4 = 0%
    ]);
    expect(isConversionEarlyWarning(monthly, now)).toBe(true);
  });

  it("does not trip when only one of the two months is below threshold", () => {
    const monthly = computeMonthlyConversion([
      { status: "accepted", outcomeDateIso: "2026-05-05" },
      { status: "accepted", outcomeDateIso: "2026-05-10" }, // May: 100%
      { status: "declined", outcomeDateIso: "2026-06-10" }, // June: 0%
    ]);
    expect(isConversionEarlyWarning(monthly, now)).toBe(false);
  });

  it("does not trip when a month has no data", () => {
    const monthly = computeMonthlyConversion([
      { status: "declined", outcomeDateIso: "2026-06-10" }, // June: 0%, May missing
    ]);
    expect(isConversionEarlyWarning(monthly, now)).toBe(false);
  });
});

describe("computeAverageTurnaroundBusinessDays", () => {
  it("averages business-day turnaround across enquiry->first-sent pairs", () => {
    const result = computeAverageTurnaroundBusinessDays([
      { enquiryCreatedAtIso: "2026-07-13", firstQuoteSentAtIso: "2026-07-14" }, // 1
      { enquiryCreatedAtIso: "2026-07-13", firstQuoteSentAtIso: "2026-07-15" }, // 2
    ]);
    expect(result).toBe(1.5);
  });

  it("returns null with no pairs", () => {
    expect(computeAverageTurnaroundBusinessDays([])).toBeNull();
  });
});

describe("computeAverageOrderValue", () => {
  it("averages JMD and USD independently, ignoring nulls", () => {
    const result = computeAverageOrderValue([
      { total_client_jmd: 100000, total_client_usd: 1000 },
      { total_client_jmd: 200000, total_client_usd: null },
    ]);
    expect(result.count).toBe(2);
    expect(result.avgJmd).toBe(150000);
    expect(result.avgUsd).toBe(1000);
  });

  it("returns nulls with no rows", () => {
    const result = computeAverageOrderValue([]);
    expect(result.avgJmd).toBeNull();
    expect(result.avgUsd).toBeNull();
  });
});

describe("computeEffectiveMarginPct", () => {
  it("computes (client - landed) / client as a percent", () => {
    expect(
      computeEffectiveMarginPct({ total_client_usd: 1000, total_landed_usd: 700 }),
    ).toBeCloseTo(30, 5);
  });

  it("returns null when totals are missing or client price is non-positive", () => {
    expect(computeEffectiveMarginPct({ total_client_usd: null, total_landed_usd: 700 })).toBeNull();
    expect(computeEffectiveMarginPct({ total_client_usd: 0, total_landed_usd: 0 })).toBeNull();
  });
});

describe("findMarginBreaches", () => {
  it("flags accepted quotes below the 20% floor", () => {
    const breaches = findMarginBreaches([
      { id: "1", quote_ref: "VQ-2026-001", total_client_usd: 1000, total_landed_usd: 700 }, // 30%, ok
      { id: "2", quote_ref: "VQ-2026-002", total_client_usd: 1000, total_landed_usd: 900 }, // 10%, breach
    ]);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].quote_ref).toBe("VQ-2026-002");
    expect(breaches[0].effectiveMarginPct).toBeCloseTo(10, 5);
  });

  it("returns an empty array when nothing breaches", () => {
    expect(
      findMarginBreaches([
        { id: "1", quote_ref: "VQ-2026-001", total_client_usd: 1000, total_landed_usd: 700 },
      ]),
    ).toEqual([]);
  });
});
