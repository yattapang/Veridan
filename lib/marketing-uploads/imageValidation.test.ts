import { describe, expect, it } from "vitest";
import {
  MAX_MARKETING_IMAGE_BYTES,
  isAllowedMarketingImageType,
  validateMarketingImage,
  buildMarketingImageStoragePath,
} from "./imageValidation";

function file(overrides: Partial<{ name: string; type: string; size: number }> = {}) {
  return { name: "logo.png", type: "image/png", size: 1024, ...overrides };
}

describe("isAllowedMarketingImageType", () => {
  it("accepts PNG/JPEG/WEBP by MIME type", () => {
    expect(isAllowedMarketingImageType(file({ type: "image/png" }))).toBe(true);
    expect(isAllowedMarketingImageType(file({ type: "image/jpeg" }))).toBe(true);
    expect(isAllowedMarketingImageType(file({ type: "image/webp" }))).toBe(true);
  });

  it("accepts by extension when the browser reports an empty/odd MIME type", () => {
    expect(isAllowedMarketingImageType(file({ name: "logo.PNG", type: "" }))).toBe(true);
    expect(isAllowedMarketingImageType(file({ name: "photo.jpg", type: "application/octet-stream" }))).toBe(
      true
    );
  });

  it("rejects an unrelated type", () => {
    expect(isAllowedMarketingImageType(file({ name: "doc.pdf", type: "application/pdf" }))).toBe(false);
  });
});

describe("validateMarketingImage", () => {
  it("accepts a well-formed small image", () => {
    expect(validateMarketingImage(file())).toEqual({ ok: true });
  });

  it("rejects a missing/empty file", () => {
    expect(validateMarketingImage(file({ name: "", size: 0 }))).toEqual({
      ok: false,
      error: "Choose an image file.",
    });
    expect(validateMarketingImage(file({ size: 0 }))).toEqual({
      ok: false,
      error: "Choose an image file.",
    });
  });

  it("rejects a file over the 5MB cap", () => {
    const result = validateMarketingImage(file({ size: MAX_MARKETING_IMAGE_BYTES + 1 }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too large/);
  });

  it("accepts a file exactly at the 5MB cap", () => {
    expect(validateMarketingImage(file({ size: MAX_MARKETING_IMAGE_BYTES }))).toEqual({ ok: true });
  });

  it("rejects an unsupported file type", () => {
    const result = validateMarketingImage(file({ name: "spec.pdf", type: "application/pdf" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unsupported image type/);
  });
});

describe("buildMarketingImageStoragePath", () => {
  it("builds a <prefix>/<timestamp>-<filename> path", () => {
    const path = buildMarketingImageStoragePath("brand-logos", "My Logo.PNG");
    expect(path).toMatch(/^brand-logos\/\d+-My_Logo\.PNG$/);
  });

  it("sanitizes an unsafe prefix so it can't escape the bucket root", () => {
    const path = buildMarketingImageStoragePath("../../etc", "photo.jpg");
    const parts = path.split("/");
    expect(parts).toHaveLength(2);
    expect(parts[0]).not.toContain("..");
    expect(parts[0]).not.toContain("/");
    expect(parts[0].endsWith("etc")).toBe(true);
  });

  it("falls back to 'upload' for an empty prefix", () => {
    const path = buildMarketingImageStoragePath("", "photo.jpg");
    expect(path.startsWith("upload/")).toBe(true);
  });

  it("strips path separators out of the filename component, leaving only the one prefix/ separator", () => {
    const path = buildMarketingImageStoragePath("install-photos", "../../etc/passwd.png");
    const parts = path.split("/");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("install-photos");
    expect(parts[1]).not.toContain("/");
  });
});
