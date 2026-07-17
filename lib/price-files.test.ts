import { describe, expect, it } from "vitest";
import {
  ALLOWED_PRICE_FILE_EXTENSIONS,
  MAX_PRICE_FILE_BYTES,
  buildPriceFileStoragePath,
  extractionStatusBadgeClass,
  extractionStatusLabel,
  isAllowedPriceFileType,
  validatePriceFile,
} from "./price-files";

describe("isAllowedPriceFileType", () => {
  it("accepts a correctly-typed PDF", () => {
    expect(isAllowedPriceFileType({ name: "quote.pdf", type: "application/pdf", size: 1000 })).toBe(true);
  });

  it("accepts a correctly-typed image", () => {
    expect(isAllowedPriceFileType({ name: "photo.jpg", type: "image/jpeg", size: 1000 })).toBe(true);
  });

  it("falls back to extension when the browser reports a generic/blank MIME type for xlsx", () => {
    expect(
      isAllowedPriceFileType({ name: "prices.xlsx", type: "application/octet-stream", size: 1000 }),
    ).toBe(true);
  });

  it("falls back to extension for csv reported as empty type", () => {
    expect(isAllowedPriceFileType({ name: "prices.csv", type: "", size: 1000 })).toBe(true);
  });

  it("rejects an unsupported type/extension", () => {
    expect(isAllowedPriceFileType({ name: "malware.exe", type: "application/octet-stream", size: 1000 })).toBe(
      false,
    );
  });

  it.each(ALLOWED_PRICE_FILE_EXTENSIONS)("accepts extension %s via fallback", (ext) => {
    expect(isAllowedPriceFileType({ name: `file${ext}`, type: "application/octet-stream", size: 1000 })).toBe(
      true,
    );
  });
});

describe("validatePriceFile", () => {
  it("rejects an empty/no-file selection", () => {
    const result = validatePriceFile({ name: "", type: "", size: 0 });
    expect(result.ok).toBe(false);
  });

  it("rejects a file over the 15MB cap", () => {
    const result = validatePriceFile({
      name: "big.pdf",
      type: "application/pdf",
      size: MAX_PRICE_FILE_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it("accepts a file exactly at the 15MB cap", () => {
    const result = validatePriceFile({
      name: "exact.pdf",
      type: "application/pdf",
      size: MAX_PRICE_FILE_BYTES,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a disallowed type/extension combination", () => {
    const result = validatePriceFile({ name: "notes.txt", type: "text/plain", size: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unsupported file type/i);
  });

  it("accepts a valid csv upload", () => {
    const result = validatePriceFile({ name: "supplier-prices.csv", type: "text/csv", size: 2048 });
    expect(result.ok).toBe(true);
  });
});

describe("buildPriceFileStoragePath", () => {
  it("builds a <uuid>/<original-filename> path", () => {
    expect(buildPriceFileStoragePath("abc-123", "Q3 Prices.xlsx")).toBe("abc-123/Q3_Prices.xlsx");
  });

  it("sanitizes unsafe characters in the filename", () => {
    expect(buildPriceFileStoragePath("uuid-1", "weird/name?.pdf")).toBe("uuid-1/weird_name_.pdf");
  });

  it("falls back to a generic name when the filename is empty", () => {
    expect(buildPriceFileStoragePath("uuid-2", "")).toBe("uuid-2/file");
  });
});

describe("extractionStatusLabel / extractionStatusBadgeClass", () => {
  it("has a label and badge class for every extraction status", () => {
    const statuses = ["pending", "extracting", "review", "completed", "failed"] as const;
    for (const status of statuses) {
      expect(extractionStatusLabel(status)).toBeTruthy();
      expect(extractionStatusBadgeClass(status)).toBeTruthy();
    }
  });

  it("labels 'review' as needs review, not a raw enum value", () => {
    expect(extractionStatusLabel("review")).toBe("Needs review");
  });
});
