/**
 * Pure helpers for the Phase 2B price-file upload UI (Task 36, Plan §2.2
 * Stage 1). No Supabase client, no I/O — mirrors the lib/pipeline.ts /
 * lib/item-groups.ts convention of keeping the testable logic out of server
 * actions and components.
 */

import type { ExtractionStatus } from "@/lib/supabase/types";

/** Matches lib/enquiries/submit.ts's MIME + extension fallback approach. */
export const MAX_PRICE_FILE_BYTES = 15 * 1024 * 1024; // 15MB, per Task 36 brief

export const ALLOWED_PRICE_FILE_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/csv",
  "application/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const ALLOWED_PRICE_FILE_EXTENSIONS = [
  ".pdf",
  ".xlsx",
  ".xls",
  ".csv",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
];

export interface PriceFileValidationInput {
  name: string;
  type: string;
  size: number;
}

export type PriceFileValidationResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

/**
 * Validates a candidate upload against the Task 36 brief: .pdf/.xlsx/.xls/
 * .csv/.png/.jpg/.jpeg/.webp, max 15MB, checked by MIME type AND extension
 * (browsers/OSes are inconsistent about MIME type for .csv/.xlsx, so a file
 * passes if either check matches — same fallback approach as
 * lib/enquiries/submit.ts's isAllowedUpload).
 */
export function validatePriceFile(file: PriceFileValidationInput): PriceFileValidationResult {
  if (!file.name || file.size <= 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_PRICE_FILE_BYTES) {
    return { ok: false, error: "The uploaded file is too large (max 15MB)." };
  }
  if (!isAllowedPriceFileType(file)) {
    return {
      ok: false,
      error: "Unsupported file type. Please upload a PDF, Excel (.xls/.xlsx), CSV, or image (.png/.jpg/.jpeg/.webp).",
    };
  }
  return { ok: true };
}

/** True if either the declared MIME type or the filename extension is on the allow-list. */
export function isAllowedPriceFileType(file: PriceFileValidationInput): boolean {
  if (ALLOWED_PRICE_FILE_TYPES.has(file.type)) return true;
  const lowerName = file.name.toLowerCase();
  return ALLOWED_PRICE_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/** Builds the `<uuid>/<original-filename>` Storage path convention (Task 36 brief). */
export function buildPriceFileStoragePath(uploadId: string, originalFilename: string): string {
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150) || "file";
  return `${uploadId}/${safeName}`;
}

export const EXTRACTION_STATUS_LABELS: Record<ExtractionStatus, string> = {
  pending: "Pending",
  extracting: "Extracting",
  review: "Needs review",
  completed: "Completed",
  failed: "Failed",
};

/** Tailwind badge classes per status, following the archived-badge pattern in SupplierListItem.tsx. */
export const EXTRACTION_STATUS_BADGE_CLASSES: Record<ExtractionStatus, string> = {
  pending: "bg-veridan-warm-gray-pale text-veridan-warm-gray",
  extracting: "bg-blue-50 text-blue-600",
  review: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-600",
};

export function extractionStatusLabel(status: ExtractionStatus): string {
  return EXTRACTION_STATUS_LABELS[status] ?? status;
}

export function extractionStatusBadgeClass(status: ExtractionStatus): string {
  return EXTRACTION_STATUS_BADGE_CLASSES[status] ?? EXTRACTION_STATUS_BADGE_CLASSES.pending;
}
