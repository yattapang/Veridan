import { describe, expect, it } from "vitest";
import { buildDepositContextLine, buildItemizationNote, formatInvoiceJmd, formatInvoiceUsd } from "./format";

describe("formatInvoiceJmd", () => {
  it("always shows two decimal places and groups thousands", () => {
    expect(formatInvoiceJmd(69000)).toBe("J$69,000.00");
    expect(formatInvoiceJmd(999.5)).toBe("J$999.50");
  });

  it("returns an em dash for null/undefined/non-finite", () => {
    expect(formatInvoiceJmd(null)).toBe("—");
    expect(formatInvoiceJmd(undefined)).toBe("—");
    expect(formatInvoiceJmd(NaN)).toBe("—");
  });

  it("formats zero", () => {
    expect(formatInvoiceJmd(0)).toBe("J$0.00");
  });
});

describe("formatInvoiceUsd", () => {
  it("formats with a US$ prefix and two decimals", () => {
    expect(formatInvoiceUsd(413.52)).toBe("US$413.52");
  });

  it("returns an em dash for null", () => {
    expect(formatInvoiceUsd(null)).toBe("—");
  });
});

describe("buildDepositContextLine", () => {
  it("renders a deposit line with the percentage and quote ref", () => {
    expect(buildDepositContextLine("deposit", "VQ-2026-001", 60)).toBe(
      "60% deposit against quote VQ-2026-001.",
    );
  });

  it("renders a balance line without any percentage", () => {
    expect(buildDepositContextLine("balance", "VQ-2026-001", 60)).toBe(
      "Balance due against quote VQ-2026-001.",
    );
  });

  it("falls back gracefully when depositPct is missing on a deposit invoice", () => {
    expect(buildDepositContextLine("deposit", "VQ-2026-001", null)).toBe(
      "Deposit against quote VQ-2026-001.",
    );
  });

  it("falls back gracefully when the quote ref is missing", () => {
    expect(buildDepositContextLine("balance", null, null)).toBe("Balance due against quote —.");
  });
});

describe("buildItemizationNote", () => {
  it("explains a deposit invoice's mismatch against the itemized total, with the percentage", () => {
    expect(buildItemizationNote("deposit", 60)).toBe(
      "60% deposit against the itemized total below — the amount due above is the deposit share, not the full itemized total.",
    );
  });

  it("falls back gracefully when depositPct is missing on a deposit invoice", () => {
    expect(buildItemizationNote("deposit", null)).toBe(
      "Deposit against the itemized total below — the amount due above is the deposit share, not the full itemized total.",
    );
  });

  it("explains a balance invoice's mismatch without any percentage", () => {
    expect(buildItemizationNote("balance", 60)).toBe(
      "Balance due against the itemized total below, after the deposit already invoiced — the amount due above is the remaining share, not the full itemized total.",
    );
  });
});
