import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, jamaicaYear, parseInvoiceNumber } from "./numbering";

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

describe("jamaicaYear", () => {
  it("matches UTC for an instant well inside Jamaica's business day", () => {
    // 2026-07-18 15:00 UTC = 2026-07-18 10:00 Jamaica (UTC-5) — same year either way.
    expect(jamaicaYear(new Date("2026-07-18T15:00:00.000Z"))).toBe(2026);
  });

  it("MINOR-4: a Dec 31 evening in Jamaica that is already Jan 1 UTC still numbers under the OLD year", () => {
    // 2026-12-31 23:00 Jamaica (UTC-5) = 2027-01-01 04:00 UTC. A naive
    // `new Date().getFullYear()` on a UTC-clocked server would read 2027;
    // Jamaica local time is still 2026-12-31.
    expect(jamaicaYear(new Date("2027-01-01T04:00:00.000Z"))).toBe(2026);
  });

  it("rolls over to the new year once it's actually Jamaica midnight", () => {
    // 2027-01-01 00:00 Jamaica (UTC-5) = 2027-01-01 05:00 UTC.
    expect(jamaicaYear(new Date("2027-01-01T05:00:00.000Z"))).toBe(2027);
  });

  it("defaults to the current instant when called with no argument", () => {
    expect(jamaicaYear()).toBe(new Date(Date.now() - 5 * 60 * 60 * 1000).getUTCFullYear());
  });
});
