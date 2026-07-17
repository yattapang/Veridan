/**
 * Phase 2B Tasks 39-41 — PURE row-resolution state machine + seed-quote row
 * mapping for the extraction review screen (Plan §2.2 Stage 3, §2.2 Stage 4a/4b).
 *
 * No Supabase client, no Anthropic client, no I/O — mirrors the
 * lib/price-extraction/matching.ts convention so the review/accept/reject
 * rules and the accepted-rows-to-quote-lines mapping are unit-testable
 * without a DB.
 *
 * GUARDRAIL (Plan §2.3): this module only decides WHICH rows are resolved,
 * WHAT kind of match they are, and HOW an accepted row maps to a
 * quote_line_items insert shape (product_id/qty/unit_cost/currency, verbatim
 * from the extraction). It never computes a client price, margin, or FX
 * conversion — that stays the landed-cost engine's job, invoked elsewhere.
 */

import type { CurrencyCode, ExtractedPriceReviewStatus, ProductCategory } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Match classification
// ---------------------------------------------------------------------------

export type ReviewMatchKind = "existing_product" | "item_group" | "new_item";

export interface ReviewRowForClassify {
  matched_product_id: string | null;
  item_group_match_id: string | null;
}

/**
 * Classifies an extracted_prices row by what the matcher (Task 38) found:
 *   - matched_product_id set        → "existing_product" (update in place)
 *   - item_group_match_id set only  → "item_group" (cross-supplier — new
 *     offering row for THIS supplier, pre-filled from the sibling)
 *   - neither set                   → "new_item" (nothing in the library yet)
 */
export function classifyMatchKind(row: ReviewRowForClassify): ReviewMatchKind {
  if (row.matched_product_id) return "existing_product";
  if (row.item_group_match_id) return "item_group";
  return "new_item";
}

// ---------------------------------------------------------------------------
// Row-resolution state machine
// ---------------------------------------------------------------------------

/** review_status values that mean "this row's fate is decided" (Plan §2.2 Stage 3). */
export const RESOLVED_REVIEW_STATUSES: ReadonlySet<ExtractedPriceReviewStatus> = new Set([
  "accepted",
  "edited",
  "rejected",
]);

export function isResolvedStatus(status: ExtractedPriceReviewStatus): boolean {
  return RESOLVED_REVIEW_STATUSES.has(status);
}

export interface UploadProgress {
  total: number;
  resolved: number;
  accepted: number;
  edited: number;
  rejected: number;
  remaining: number;
  isComplete: boolean;
}

/**
 * Summarizes an upload's review progress from its rows' current statuses.
 * `isComplete` (total > 0 && remaining === 0) is what Task 41 uses to flip
 * `price_file_uploads.extraction_status` to 'completed'.
 */
export function computeUploadProgress(statuses: ExtractedPriceReviewStatus[]): UploadProgress {
  let accepted = 0;
  let edited = 0;
  let rejected = 0;
  for (const s of statuses) {
    if (s === "accepted") accepted++;
    else if (s === "edited") edited++;
    else if (s === "rejected") rejected++;
  }
  const resolved = accepted + edited + rejected;
  const total = statuses.length;
  return {
    total,
    resolved,
    accepted,
    edited,
    rejected,
    remaining: total - resolved,
    isComplete: total > 0 && resolved === total,
  };
}

/**
 * Gate a row's accept action (Plan §2.2 Stage 3): the upload's supplier must
 * be resolved before ANY row can be accepted (accepted rows need a supplier
 * for origin grouping later), and a row with no existing-product match needs
 * a chosen category before it can create a new products row.
 */
export interface AcceptGateInput {
  uploadSupplierId: string | null;
  matchKind: ReviewMatchKind;
  newItemCategory?: ProductCategory | null;
}

export type AcceptGateResult = { ok: true; error?: undefined } | { ok: false; error: string };

export function checkAcceptAllowed(input: AcceptGateInput): AcceptGateResult {
  if (!input.uploadSupplierId) {
    return { ok: false, error: "Set a supplier for this upload before accepting any row." };
  }
  if (input.matchKind !== "existing_product" && !input.newItemCategory) {
    return {
      ok: false,
      error: "Choose a category for this new product before accepting.",
    };
  }
  return { ok: true };
}

/** Rows eligible for the "Accept all confident" bulk action: confident and not yet resolved. */
export interface BulkAcceptableRow {
  id: string;
  review_status: ExtractedPriceReviewStatus;
  matched_product_id: string | null;
}

/**
 * "Accept all confident" only auto-accepts rows the matcher already scored
 * confident AND that resolve to an existing product — a bulk accept must
 * never silently create new products or item-group offerings without the
 * founder looking at the minimal-details step, so item_group/new_item rows
 * are excluded even when confident and must be accepted one at a time.
 */
export function selectBulkAcceptableRowIds(rows: BulkAcceptableRow[]): string[] {
  return rows
    .filter((r) => r.review_status === "confident" && Boolean(r.matched_product_id))
    .map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Whether an edit actually changed anything (accepted vs edited status)
// ---------------------------------------------------------------------------

export interface ProposedValues {
  description: string | null;
  unitCost: number | null;
  currency: CurrencyCode | null;
  qty: number | null;
}

/** accepted → status stays 'accepted'; any field changed → 'edited' (Plan §2.2 Stage 3). */
export function resolveAcceptedStatus(
  original: ProposedValues,
  submitted: ProposedValues
): "accepted" | "edited" {
  const changed =
    (original.description ?? "") !== (submitted.description ?? "") ||
    (original.unitCost ?? null) !== (submitted.unitCost ?? null) ||
    (original.currency ?? null) !== (submitted.currency ?? null) ||
    (original.qty ?? null) !== (submitted.qty ?? null);
  return changed ? "edited" : "accepted";
}

// ---------------------------------------------------------------------------
// Seed-quote row mapping (Plan §2.2 Stage 4b / Task 41)
// ---------------------------------------------------------------------------

export interface AcceptedRowForSeed {
  id: string;
  matched_product_id: string | null;
  proposed_qty: number | null;
  proposed_unit_cost: number | null;
  proposed_currency: CurrencyCode | null;
}

export interface SeedQuoteLineDraft {
  extractedPriceId: string;
  productId: string;
  qty: number;
  unitCost: number;
  currency: CurrencyCode;
}

/**
 * Maps accepted/edited extracted_prices rows to quote_line_items insert
 * drafts (Task 41): product_id from the (by now resolved) match, qty from
 * proposed_qty defaulting to 1 when absent/non-positive, unit_cost/currency
 * from the accepted values verbatim — no calculation, no FX, no margin.
 * Rows without a resolved product_id are skipped (shouldn't happen for
 * accepted rows — accept always resolves a product — but defensive rather
 * than inserting a broken quote line).
 */
export function buildSeedQuoteLineDrafts(
  rows: AcceptedRowForSeed[],
  fallbackCurrency: CurrencyCode
): SeedQuoteLineDraft[] {
  return rows
    .filter((r): r is AcceptedRowForSeed & { matched_product_id: string } => Boolean(r.matched_product_id))
    .map((r) => ({
      extractedPriceId: r.id,
      productId: r.matched_product_id,
      qty: r.proposed_qty && r.proposed_qty > 0 ? r.proposed_qty : 1,
      unitCost: r.proposed_unit_cost ?? 0,
      currency: r.proposed_currency ?? fallbackCurrency,
    }));
}

// ---------------------------------------------------------------------------
// Raw source text rendering (readable, for the side-by-side review display)
// ---------------------------------------------------------------------------

interface RawExtractedLineShape {
  line?: {
    raw_description?: string | null;
    product_ref_guess?: string | null;
    qty?: number | null;
    unit_price?: number | null;
    currency?: string | null;
  };
  quote_metadata?: {
    quote_ref?: string | null;
    quote_date?: string | null;
    currency?: string | null;
    validity_text?: string | null;
  };
}

/**
 * Renders the extract.ts `rawLineJson` jsonb payload (a `{ line, quote_metadata }`
 * envelope — see lib/price-extraction/extract.ts) into a short human-readable
 * string for the review table. Defensive against any other shape (manual DB
 * edits, older rows) — falls back to a compact JSON dump rather than crashing.
 */
export function formatRawExtractedText(raw: unknown): string {
  if (raw === null || raw === undefined) return "—";
  if (typeof raw === "object") {
    const obj = raw as RawExtractedLineShape;
    if (obj.line) {
      const parts: string[] = [];
      if (obj.line.raw_description) parts.push(obj.line.raw_description);
      if (obj.line.product_ref_guess) parts.push(`Ref: ${obj.line.product_ref_guess}`);
      if (obj.line.qty != null) parts.push(`Qty: ${obj.line.qty}`);
      if (obj.line.unit_price != null) {
        parts.push(`Price: ${obj.line.unit_price}${obj.line.currency ? ` ${obj.line.currency}` : ""}`);
      }
      if (parts.length > 0) return parts.join(" · ");
    }
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

// ---------------------------------------------------------------------------
// Confidence display
// ---------------------------------------------------------------------------

export type ConfidenceTier = "high" | "medium" | "low" | "unknown";

/** Visual-cue tier for a confidence score, independent of the review threshold. */
export function confidenceTier(score: number | null): ConfidenceTier {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unknown";
  if (score >= 0.85) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

export function confidencePercentLabel(score: number | null): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return "—";
  return `${Math.round(score * 100)}%`;
}
