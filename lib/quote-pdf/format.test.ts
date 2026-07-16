import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDoorNumbers,
  formatIsoDate,
  formatJmd2dp,
  formatJmdWhole,
  formatValidUntil,
  matchLeadTime,
  summarizeComposition,
} from "./format";

describe("formatJmdWhole", () => {
  it("rounds to the nearest whole dollar and groups thousands", () => {
    expect(formatJmdWhole(1234567.4)).toBe("J$1,234,567");
    expect(formatJmdWhole(1234567.6)).toBe("J$1,234,568");
  });

  it("returns an em dash for null/undefined/non-finite", () => {
    expect(formatJmdWhole(null)).toBe("—");
    expect(formatJmdWhole(undefined)).toBe("—");
    expect(formatJmdWhole(NaN)).toBe("—");
  });

  it("formats zero", () => {
    expect(formatJmdWhole(0)).toBe("J$0");
  });
});

describe("formatJmd2dp", () => {
  it("always shows two decimal places", () => {
    expect(formatJmd2dp(1000)).toBe("J$1,000.00");
    expect(formatJmd2dp(999.5)).toBe("J$999.50");
  });

  it("returns an em dash for null", () => {
    expect(formatJmd2dp(null)).toBe("—");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(12000)).toBe("12,000");
  });

  it("returns an em dash for null", () => {
    expect(formatCount(null)).toBe("—");
  });
});

describe("formatIsoDate", () => {
  it("formats an ISO date as 'D Month YYYY'", () => {
    expect(formatIsoDate("2026-07-15")).toBe("15 July 2026");
  });

  it("handles single-digit days without zero-padding in output", () => {
    expect(formatIsoDate("2026-07-05")).toBe("5 July 2026");
  });

  it("returns an em dash for null/undefined", () => {
    expect(formatIsoDate(null)).toBe("—");
    expect(formatIsoDate(undefined)).toBe("—");
  });

  it("returns the raw string when it doesn't match the expected pattern", () => {
    expect(formatIsoDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatValidUntil", () => {
  it("adds validity days to the quote date", () => {
    expect(formatValidUntil("2026-07-15", 15)).toBe("30 July 2026");
  });

  it("crosses a month boundary correctly", () => {
    expect(formatValidUntil("2026-07-25", 15)).toBe("9 August 2026");
  });

  it("crosses a year boundary correctly", () => {
    expect(formatValidUntil("2026-12-25", 15)).toBe("9 January 2027");
  });

  it("treats a missing validity as zero days", () => {
    expect(formatValidUntil("2026-07-15", null)).toBe("15 July 2026");
  });

  it("returns an em dash when the quote date is missing", () => {
    expect(formatValidUntil(null, 15)).toBe("—");
  });
});

describe("summarizeComposition", () => {
  it("lists distinct items in first-appearance order", () => {
    expect(
      summarizeComposition([
        { description: "Lockset", qty: 1 },
        { description: "Closer", qty: 1 },
      ]),
    ).toBe("Lockset, Closer");
  });

  it("merges duplicate descriptions and sums quantities", () => {
    expect(
      summarizeComposition([
        { description: "Hinges", qty: 3 },
        { description: "Lockset", qty: 1 },
        { description: "Hinges", qty: 3 },
      ]),
    ).toBe("Hinges x6, Lockset");
  });

  it("shows a bare label for qty 1 and 'xN' for qty > 1", () => {
    expect(summarizeComposition([{ description: "Closer", qty: 1 }])).toBe("Closer");
    expect(summarizeComposition([{ description: "Hinges", qty: 3 }])).toBe("Hinges x3");
  });

  it("returns an empty string for no items", () => {
    expect(summarizeComposition([])).toBe("");
  });

  it("falls back to 'Item' for a blank description", () => {
    expect(summarizeComposition([{ description: "  ", qty: 1 }])).toBe("Item");
  });
});

describe("formatDoorNumbers", () => {
  it("joins door numbers under the threshold", () => {
    expect(formatDoorNumbers(["DA08", "DE01"], 2)).toBe("DA08, DE01");
  });

  it("truncates past maxShown with a '+N more' suffix", () => {
    expect(formatDoorNumbers(["DE01", "DA08", "DA09", "DA10"], 2)).toBe("DA08, DA09 … +2 more");
  });

  it("de-duplicates and sorts", () => {
    expect(formatDoorNumbers(["DA08", "DA08", "DA01"], 5)).toBe("DA01, DA08");
  });

  it("returns an em dash for an empty list", () => {
    expect(formatDoorNumbers([])).toBe("—");
  });

  it("filters out blank entries", () => {
    expect(formatDoorNumbers(["DA08", "", "  "], 5)).toBe("DA08");
  });
});

describe("matchLeadTime", () => {
  const leadTimes = { USA: "2-4 weeks", Canada: "2-4 weeks", UK: "4-8 weeks", Dubai: "2-3 months" };

  it("matches exactly (case-insensitively)", () => {
    expect(matchLeadTime("usa", leadTimes)).toBe("2-4 weeks");
  });

  it("matches a label that starts with a lead-time key", () => {
    expect(matchLeadTime("UK–Consort", leadTimes)).toBe("4-8 weeks");
  });

  it("returns null when nothing matches", () => {
    expect(matchLeadTime("Other", leadTimes)).toBeNull();
  });

  it("returns null when the table is missing", () => {
    expect(matchLeadTime("USA", null)).toBeNull();
  });
});
