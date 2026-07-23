import { describe, expect, it } from "vitest";
import {
  ALLOWED_CATALOGUE_FILE_EXTENSIONS,
  ALLOWED_CATALOGUE_THUMBNAIL_EXTENSIONS,
  MAX_CATALOGUE_FILE_BYTES,
  MAX_CATALOGUE_THUMBNAIL_BYTES,
  buildCatalogueFileStoragePath,
  buildCatalogueThumbnailStoragePath,
  catalogueVisibilityBadgeClass,
  catalogueVisibilityLabel,
  formatFileSize,
  isAllowedCatalogueFileType,
  isAllowedCatalogueThumbnailType,
  validateCatalogueFile,
  validateCatalogueThumbnail,
} from "./validation";

describe("isAllowedCatalogueFileType", () => {
  it("accepts a correctly-typed PDF", () => {
    expect(isAllowedCatalogueFileType({ name: "catalogue.pdf", type: "application/pdf", size: 1000 })).toBe(true);
  });

  it("falls back to extension when the browser reports a generic MIME type", () => {
    expect(
      isAllowedCatalogueFileType({ name: "specs.pdf", type: "application/octet-stream", size: 1000 })
    ).toBe(true);
  });

  it("rejects a non-PDF type/extension", () => {
    expect(isAllowedCatalogueFileType({ name: "specs.docx", type: "application/msword", size: 1000 })).toBe(
      false
    );
  });

  it.each(ALLOWED_CATALOGUE_FILE_EXTENSIONS)("accepts extension %s via fallback", (ext) => {
    expect(isAllowedCatalogueFileType({ name: `file${ext}`, type: "application/octet-stream", size: 1000 })).toBe(
      true
    );
  });
});

describe("validateCatalogueFile", () => {
  it("rejects an empty/no-file selection", () => {
    const result = validateCatalogueFile({ name: "", type: "", size: 0 });
    expect(result.ok).toBe(false);
  });

  it("rejects a file over the 25MB cap", () => {
    const result = validateCatalogueFile({
      name: "big.pdf",
      type: "application/pdf",
      size: MAX_CATALOGUE_FILE_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it("accepts a file exactly at the 25MB cap", () => {
    const result = validateCatalogueFile({
      name: "exact.pdf",
      type: "application/pdf",
      size: MAX_CATALOGUE_FILE_BYTES,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a disallowed type", () => {
    const result = validateCatalogueFile({ name: "notes.xlsx", type: "application/vnd.ms-excel", size: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pdf/i);
  });

  it("accepts a valid PDF upload", () => {
    const result = validateCatalogueFile({ name: "supplier-catalogue.pdf", type: "application/pdf", size: 2048 });
    expect(result.ok).toBe(true);
  });
});

describe("isAllowedCatalogueThumbnailType / validateCatalogueThumbnail", () => {
  it("accepts a correctly-typed image", () => {
    expect(isAllowedCatalogueThumbnailType({ name: "cover.jpg", type: "image/jpeg", size: 1000 })).toBe(true);
  });

  it.each(ALLOWED_CATALOGUE_THUMBNAIL_EXTENSIONS)("accepts extension %s via fallback", (ext) => {
    expect(
      isAllowedCatalogueThumbnailType({ name: `cover${ext}`, type: "application/octet-stream", size: 1000 })
    ).toBe(true);
  });

  it("rejects a PDF as a thumbnail", () => {
    expect(isAllowedCatalogueThumbnailType({ name: "cover.pdf", type: "application/pdf", size: 1000 })).toBe(
      false
    );
  });

  it("rejects a thumbnail over the 5MB cap", () => {
    const result = validateCatalogueThumbnail({
      name: "big.png",
      type: "image/png",
      size: MAX_CATALOGUE_THUMBNAIL_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it("rejects an empty/no-file selection", () => {
    const result = validateCatalogueThumbnail({ name: "", type: "", size: 0 });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid thumbnail", () => {
    const result = validateCatalogueThumbnail({ name: "cover.webp", type: "image/webp", size: 2048 });
    expect(result.ok).toBe(true);
  });
});

describe("buildCatalogueFileStoragePath / buildCatalogueThumbnailStoragePath", () => {
  it("builds a <uuid>/<original-filename> path for the document", () => {
    expect(buildCatalogueFileStoragePath("doc-1", "Assa Abloy Catalogue.pdf")).toBe(
      "doc-1/Assa_Abloy_Catalogue.pdf"
    );
  });

  it("builds a <uuid>/thumbnail-<original-filename> path for the thumbnail, distinguishable from the document path", () => {
    expect(buildCatalogueThumbnailStoragePath("doc-1", "cover.jpg")).toBe("doc-1/thumbnail-cover.jpg");
  });

  it("sanitizes unsafe characters in the filename", () => {
    expect(buildCatalogueFileStoragePath("doc-2", "weird/name?.pdf")).toBe("doc-2/weird_name_.pdf");
  });

  it("falls back to a generic name when the filename is empty", () => {
    expect(buildCatalogueFileStoragePath("doc-3", "")).toBe("doc-3/file");
  });
});

describe("formatFileSize", () => {
  it("formats bytes under 1KB as B", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("formats KB range", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  it("formats MB range", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("returns null for missing values", () => {
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize(undefined)).toBeNull();
  });
});

describe("catalogueVisibilityLabel / catalogueVisibilityBadgeClass", () => {
  it("has a label and badge class for both visibility states", () => {
    for (const v of ["internal", "public"] as const) {
      expect(catalogueVisibilityLabel(v)).toBeTruthy();
      expect(catalogueVisibilityBadgeClass(v)).toBeTruthy();
    }
  });

  it("labels 'internal' and 'public' in title case, not raw enum values", () => {
    expect(catalogueVisibilityLabel("internal")).toBe("Internal");
    expect(catalogueVisibilityLabel("public")).toBe("Public");
  });
});
