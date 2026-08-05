/**
 * Pure, shared image-upload validation for the two new PUBLIC marketing
 * buckets added by the marketing-frameworks build (2026-08-05):
 * `brand-logos` (Framework A) and `install-photos` (Framework B). No
 * Supabase client, no I/O — mirrors lib/catalogue/validation.ts's
 * convention of keeping testable validation logic out of server actions
 * and components.
 *
 * Same 5MB cap and PNG/JPG/JPEG/WEBP allow-list as
 * lib/catalogue/validation.ts's `validateCatalogueThumbnail` (a cover
 * image, not a document) — reused here rather than duplicated with a
 * different limit, since both are "a small marketing photo", not a
 * document upload.
 */

export const MAX_MARKETING_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
export const ALLOWED_MARKETING_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const ALLOWED_MARKETING_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

export interface FileValidationInput {
  name: string;
  type: string;
  size: number;
}

export type FileValidationResult = { ok: true; error?: undefined } | { ok: false; error: string };

/** True if either the declared MIME type or the filename extension is on the allow-list (browsers are inconsistent about MIME type for images from some OSes). */
export function isAllowedMarketingImageType(file: FileValidationInput): boolean {
  if (ALLOWED_MARKETING_IMAGE_TYPES.has(file.type)) return true;
  const lowerName = file.name.toLowerCase();
  return ALLOWED_MARKETING_IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/** Validates a candidate brand-logo / install-photo upload: PNG/JPG/JPEG/WEBP, max 5MB. */
export function validateMarketingImage(file: FileValidationInput): FileValidationResult {
  if (!file.name || file.size <= 0) {
    return { ok: false, error: "Choose an image file." };
  }
  if (file.size > MAX_MARKETING_IMAGE_BYTES) {
    return { ok: false, error: "The image is too large (max 5MB)." };
  }
  if (!isAllowedMarketingImageType(file)) {
    return { ok: false, error: "Unsupported image type. Please upload a PNG, JPG, or WEBP." };
  }
  return { ok: true };
}

function sanitizeFilename(originalFilename: string): string {
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  return safeName || "file";
}

/**
 * Builds a collision-safe Storage path for a timestamped upload with no
 * stable parent entity id — brand-logo and install-photo uploads aren't
 * rows in a table the way an article/catalogue-document upload is, so
 * there's no `<id>/...` prefix to key off. Mirrors the
 * `<prefix>/<timestamp>-<filename>` convention used throughout lib/storage.ts
 * (e.g. uploadArticleHeroImage), just with a caller-supplied prefix instead
 * of a row id.
 */
export function buildMarketingImageStoragePath(prefix: string, originalFilename: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) || "upload";
  return `${safePrefix}/${Date.now()}-${sanitizeFilename(originalFilename)}`;
}
