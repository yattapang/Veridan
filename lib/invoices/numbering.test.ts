import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, parseInvoiceNumber } from "./numbering";

describe("formatInvoiceNumber", () => {
  it("zero-pads the sequence to 3 digits", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("VI-2026-001");
    expect(formatInvoiceNumber(2026, 42)).toBe("VI-2026-042");
    expect(formatInvoiceNumber(2026, 999)).toBe("VI-2026-999");
  });

  it("widens rather than wraps past 999", () => {
    expect(formatInvoiceNumber(2026, 1000)).toBe("VI-2026-1000");
  });

  it("guards against non-finite/zero input rather than producing NaN/empty strings", () => {
    expect(formatInvoiceNumber(2026, 0)).toBe("VI-2026-001");
    expect(formatInvoiceNumber(2026, Number.NaN)).toBe("VI-2026-001");
  });
});

describe("parseInvoiceNumber", () => {
  it("round-trips a formatted number", () => {
    expect(parseInvoiceNumber("VI-2026-007")).toEqual({ year: 2026, sequence: 7 });
    expect(parseInvoiceNumber("VI-2026-1000")).toEqual({ year: 2026, sequence: 1000 });
  });

  it("returns null for anything not matching VI-YYYY-NNN", () => {
    expect(parseInvoiceNumber("VQ-2026-007")).toBeNull();
    expect(parseInvoiceNumber("VI-26-007")).toBeNull();
    expect(parseInvoiceNumber("garbage")).toBeNull();
  });
});
