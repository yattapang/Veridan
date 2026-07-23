/**
 * Pure helpers for the Phase 3C catalogue upload UI (Plan §3.2/§3.4). No
 * Supabase client, no I/O — mirrors lib/price-files.ts's convention of
 * keeping testable validation logic out of server actions and components.
 */

// Relative import (not the "@/..." alias) — vitest here has no path-alias
// resolution configured for runtime imports (only TS/type-only imports are
// alias-safe), so a runtime value import through "@/lib/..." fails under
// `npm test`. See lib/item-groups.ts for the same note.
import type { CatalogueVisibility } from "../supabase/types";

/** Catalogue/spec-sheet documents are PDFs — the framing throughout Plan §3 is "supplier catalogue/spec-sheet PDFs". */
export const MAX_CATALOGUE_FILE_BYTES = 25 * 1024 * 1024; // 25MB — catalogues run larger than a single price list
export const ALLOWED_CATALOGUE_FILE_TYPES = new Set(["application/pdf"]);
export const ALLOWED_CATALOGUE_FILE_EXTENSIONS = [".pdf"];

export const MAX_CATALOGUE_THUMBNAIL_BYTES = 5 * 1024 * 1024; // 5MB — a cover image, not the document itself
export const ALLOWED_CATALOGUE_THUMBNAIL_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const ALLOWED_CATALOGUE_THUMBNAIL_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

export interface FileValidationInput {
  name: string;
  type: string;
  size: number;
}

export type FileValidationResult = { ok: true; error?: undefined } | { ok: false; error: string };

/** True if either the declared MIME type or the filename extension is on the allow-list (browsers are inconsistent about MIME type for PDFs from some OSes). */
export function isAllowedCatalogueFileType(file: FileValidationInput): boolean {
  if (ALLOWED_CATALOGUE_FILE_TYPES.has(file.type)) return true;
  const lowerName = file.name.toLowerCase();
  return ALLOWED_CATALOGUE_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/**
 * Validates a candidate catalogue document upload: PDF only, max 25MB.
 * Checked by MIME type AND extension (either match is accepted) — same
 * fallback discipline as lib/price-files.ts's validatePriceFile.
 */
export function validateCatalogueFile(file: FileValidationInput): FileValidationResult {
  if (!file.name || file.size <= 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_CATALOGUE_FILE_BYTES) {
    return { ok: false, error: "The uploaded file is too large (max 25MB)." };
  }
  if (!isAllowedCatalogueFileType(file)) {
    return { ok: false, error: "Unsupported file type. Please upload a PDF." };
  }
  return { ok: true };
}

export function isAllowedCatalogueThumbnailType(file: FileValidationInput): boolean {
  if (ALLOWED_CATALOGUE_THUMBNAIL_TYPES.has(file.type)) return true;
  const lowerName = file.name.toLowerCase();
  return ALLOWED_CATALOGUE_THUMBNAIL_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/** Validates an optional thumbnail/cover-image upload: PNG/JPG/JPEG/WEBP, max 5MB. */
export function validateCatalogueThumbnail(file: FileValidationInput): FileValidationResult {
  if (!file.name || file.size <= 0) {
    return { ok: false, error: "Choose an image file." };
  }
  if (file.size > MAX_CATALOGUE_THUMBNAIL_BYTES) {
    return { ok: false, error: "The thumbnail image is too large (max 5MB)." };
  }
  if (!isAllowedCatalogueThumbnailType(file)) {
    return { ok: false, error: "Unsupported image type. Please upload a PNG, JPG, or WEBP." };
  }
  return { ok: true };
}

function sanitizeFilename(originalFilename: string): string {
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  return safeName || "file";
}

/** Builds the `<uuid>/<original-filename>` Storage path convention for the document itself, mirroring lib/price-files.ts's buildPriceFileStoragePath. */
export function buildCatalogueFileStoragePath(documentId: string, originalFilename: string): string {
  return `${documentId}/${sanitizeFilename(originalFilename)}`;
}

/** Builds the `<uuid>/thumbnail-<original-filename>` Storage path for the optional cover image — same private bucket, distinguishable prefix. */
export function buildCatalogueThumbnailStoragePath(documentId: string, originalFilename: string): string {
  return `${documentId}/thumbnail-${sanitizeFilename(originalFilename)}`;
}

/** Human-readable file size, e.g. "4.2 MB" — for the admin list and public browse card. */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

const VISIBILITY_LABELS: Record<CatalogueVisibility, string> = {
  internal: "Internal",
  public: "Public",
};

export function catalogueVisibilityLabel(visibility: CatalogueVisibility): string {
  return VISIBILITY_LABELS[visibility] ?? visibility;
}

const VISIBILITY_BADGE_CLASSES: Record<CatalogueVisibility, string> = {
  internal: "bg-veridan-warm-gray-pale text-veridan-warm-gray",
  public: "bg-emerald-50 text-emerald-700",
};

export function catalogueVisibilityBadgeClass(visibility: CatalogueVisibility): string {
  return VISIBILITY_BADGE_CLASSES[visibility] ?? VISIBILITY_BADGE_CLASSES.internal;
}
