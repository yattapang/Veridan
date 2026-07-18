"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  CURRENCY_CODES,
  PRODUCT_CATEGORIES,
  type CurrencyCode,
  type ExtractedPriceRow,
  type ExtractionStatus,
  type ProductCategory,
} from "@/lib/supabase/types";
import {
  buildSeedQuoteLineDrafts,
  checkAcceptAllowed,
  classifyMatchKind,
  computeUploadProgress,
  isCrossSupplierProductMatch,
  isResolvedStatus,
  isValidAcceptQty,
  resolveAcceptedStatus,
  selectBulkAcceptableRowIds,
  type ProposedValues,
  type ReviewMatchKind,
} from "@/lib/price-extraction/review";
import { createLineItemQuoteRecord } from "@/app/admin/projects/[id]/actions";
import { ensureOriginForSupplier, recomputeQuote, regroupLineItemOrigins } from "@/lib/quotes/persist";
import { fxSnapshotToEngine } from "@/lib/quotes/snapshot";
import { toUsd } from "@/lib/landed-cost/engine";

/**
 * Phase 2B Tasks 39-41 — review-screen server actions (Plan §2.2 Stage 3-4b).
 * Every mutation here is followed by a supplier-scoped reload of the row/
 * upload state (never trusts stale client state) and revalidates the review
 * page. Output path 1 (library price update, Task 40) and output path 2
 * (seed-quote, Task 41) both live here, next to the review actions that
 * gate them, rather than in lib/, because they're inherently I/O (Supabase
 * writes) — the pure decision logic they call lives in
 * lib/price-extraction/review.ts.
 *
 * GUARDRAIL (Plan §2.3): nothing below computes a client price, margin, or
 * FX-adjusted number. Output path 1 writes unit_cost/cost_currency only.
 * Output path 2 hands off to the EXISTING createLineItemQuoteRecord +
 * ensureOriginForSupplier + regroupLineItemOrigins + recomputeQuote
 * pipeline — the same functions a hand-built quote uses.
 */

export type ReviewActionResult = { ok: true; error?: undefined } | { ok: false; error: string };

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (CURRENCY_CODES as string[]).includes(value);
}

function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === "string" && (PRODUCT_CATEGORIES as string[]).includes(value);
}

interface UploadForReview {
  id: string;
  supplier_id: string | null;
  extraction_status: ExtractionStatus;
}

async function loadUpload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  uploadId: string
): Promise<{ upload: UploadForReview } | { error: string }> {
  const { data, error } = await supabase
    .from("price_file_uploads")
    .select("id, supplier_id, extraction_status")
    .eq("id", uploadId)
    .maybeSingle<UploadForReview>();
  if (error) return { error: `Could not load the upload: ${error.message}` };
  if (!data) return { error: "Upload not found." };
  return { upload: data };
}

/**
 * After any row-resolution change, re-checks whether every row on the
 * upload is now resolved and, if so, flips extraction_status to
 * 'completed' (Task 41: "Upload gets extraction_status='completed' once
 * all rows are resolved"). Safe to call repeatedly.
 */
async function refreshUploadCompletion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  uploadId: string
): Promise<void> {
  const { data: rows } = await supabase
    .from("extracted_prices")
    .select("review_status")
    .eq("price_file_upload_id", uploadId);
  const statuses = ((rows as { review_status: ExtractedPriceRow["review_status"] }[] | null) ?? []).map(
    (r) => r.review_status
  );
  const progress = computeUploadProgress(statuses);
  if (progress.isComplete) {
    await supabase
      .from("price_file_uploads")
      .update({ extraction_status: "completed" })
      .eq("id", uploadId)
      .neq("extraction_status", "completed");
  }
}

function revalidateReview(uploadId: string): void {
  revalidatePath(`/admin/price-files/${uploadId}`);
  revalidatePath(`/admin/price-files/${uploadId}/review`);
  revalidatePath("/admin/products");
}

/**
 * Sets (or confirms) the upload's supplier — server-enforced gate before any
 * row can be accepted (Task 39: "Unmatched-supplier resolution").
 */
export async function setUploadSupplier(
  uploadId: string,
  _prevState: ReviewActionResult,
  formData: FormData
): Promise<ReviewActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!supplierId) return { ok: false, error: "Choose a supplier." };

  // Review finding MINOR-2: once a supplier is set — and especially once any
  // row has been resolved against it (library writes carry that supplier) —
  // silently swapping the supplier from a stale form would corrupt
  // provenance. Refuse server-side rather than trusting the client gate.
  const loadedUpload = await loadUpload(supabase, uploadId);
  if ("error" in loadedUpload) return { ok: false, error: loadedUpload.error };
  if (loadedUpload.upload.supplier_id) {
    return { ok: false, error: "This upload already has a supplier set — reload the page to see it." };
  }
  const { data: statusRows, error: statusError } = await supabase
    .from("extracted_prices")
    .select("review_status")
    .eq("price_file_upload_id", uploadId);
  if (statusError) return { ok: false, error: `Could not check the upload's rows: ${statusError.message}` };
  const anyResolved = ((statusRows as { review_status: ExtractedPriceRow["review_status"] }[] | null) ?? []).some(
    (r) => isResolvedStatus(r.review_status)
  );
  if (anyResolved) {
    return {
      ok: false,
      error: "Rows on this upload have already been resolved — the supplier can no longer be changed.",
    };
  }

  // Conditional write: only fills a still-NULL supplier, so a concurrent
  // submit can't overwrite one that just landed.
  const { data: updated, error } = await supabase
    .from("price_file_uploads")
    .update({ supplier_id: supplierId })
    .eq("id", uploadId)
    .is("supplier_id", null)
    .select("id");
  if (error) return { ok: false, error: `Could not set the supplier: ${error.message}` };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "This upload already has a supplier set — reload the page to see it." };
  }

  revalidateReview(uploadId);
  return { ok: true };
}

/**
 * Writes Output path 1 (Task 40): updates products.unit_cost/cost_currency
 * for an existing product, or inserts a new products row (new_item /
 * item_group flows), then always records a product_price_history row with
 * this upload as provenance. Returns the resolved product id.
 */
async function applyLibraryUpdate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    matchKind: "existing_product" | "item_group" | "new_item";
    existingProductId: string | null;
    itemGroupId: string | null;
    uploadId: string;
    supplierId: string;
    description: string;
    unitCost: number;
    currency: CurrencyCode;
    productRef: string | null;
    category: ProductCategory | null;
    userId: string;
  }
): Promise<{ productId: string; error: string | null }> {
  let productId = args.existingProductId;

  if (args.matchKind === "existing_product" && productId) {
    // Review finding MAJOR-5: never overwrite ANOTHER supplier's library row.
    // The update below writes unit_cost/cost_currency in place, so the
    // matched product must belong to this upload's supplier. Cross-supplier
    // matches are handled per-row via the item_group flow (a new offering
    // row for THIS supplier) — acceptExtractedRow reroutes them before it
    // gets here; this is the defense-in-depth backstop.
    const { data: product, error: productLoadError } = await supabase
      .from("products")
      .select("id, supplier_id")
      .eq("id", productId)
      .maybeSingle<{ id: string; supplier_id: string | null }>();
    if (productLoadError) {
      return { productId: "", error: `Could not load the matched product: ${productLoadError.message}` };
    }
    if (!product) return { productId: "", error: "The matched product no longer exists." };
    if (product.supplier_id !== args.supplierId) {
      return {
        productId: "",
        error:
          "This line matched a product that belongs to a different supplier — accepting it in place would overwrite that supplier's price. Accept the row individually to create this supplier's own offering instead.",
      };
    }
    const { error } = await supabase
      .from("products")
      .update({
        unit_cost: args.unitCost,
        cost_currency: args.currency,
        source: "price_file_extraction",
      })
      .eq("id", productId);
    if (error) return { productId: "", error: `Could not update the product: ${error.message}` };
  } else {
    // new_item or item_group: create this supplier's offering row. This is
    // the ONLY path that creates a products row from a scan (Plan §2.2 Stage 3).
    if (!args.category) return { productId: "", error: "Choose a category for this new product." };
    const { data: inserted, error } = await supabase
      .from("products")
      .insert({
        generic_category: args.category,
        description: args.description || "Untitled item",
        product_ref: args.productRef,
        supplier_id: args.supplierId,
        item_group_id: args.itemGroupId,
        unit: "each",
        unit_cost: args.unitCost,
        cost_currency: args.currency,
        source: "price_file_extraction",
      })
      .select("id")
      .single();
    if (error || !inserted) {
      return { productId: "", error: `Could not create the product: ${error?.message ?? "unknown error"}` };
    }
    productId = inserted.id as string;
  }

  const { error: historyError } = await supabase.from("product_price_history").insert({
    product_id: productId,
    price_file_upload_id: args.uploadId,
    unit_cost: args.unitCost,
    cost_currency: args.currency,
    recorded_by: args.userId,
  });
  if (historyError) {
    return { productId, error: `Product saved but price history could not be recorded: ${historyError.message}` };
  }

  return { productId, error: null };
}

/**
 * Accept (or edit-then-accept) one extracted_prices row (Task 39/40). Reads
 * edited field values from formData (prefilled with the proposed values by
 * the row form, so a plain accept with no changes submits the same values
 * back) — resolveAcceptedStatus decides accepted vs edited from whether
 * anything actually changed.
 */
export async function acceptExtractedRow(
  uploadId: string,
  rowId: string,
  _prevState: ReviewActionResult,
  formData: FormData
): Promise<ReviewActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to accept a row." };

  const loadedUpload = await loadUpload(supabase, uploadId);
  if ("error" in loadedUpload) return { ok: false, error: loadedUpload.error };
  const { upload } = loadedUpload;

  const { data: row, error: rowError } = await supabase
    .from("extracted_prices")
    .select("*")
    .eq("id", rowId)
    .eq("price_file_upload_id", uploadId)
    .maybeSingle<ExtractedPriceRow>();
  if (rowError) return { ok: false, error: `Could not load the row: ${rowError.message}` };
  if (!row) return { ok: false, error: "Row not found." };

  // Review finding MAJOR-2: refuse to act on an already-resolved row — a
  // double-accept would duplicate product_price_history and re-overwrite
  // the library; an accept after a reject would corrupt the audit trail.
  if (isResolvedStatus(row.review_status)) {
    return { ok: false, error: "This row is already resolved — reload the page to see its current state." };
  }

  let matchKind: ReviewMatchKind = classifyMatchKind(row);
  let existingProductId = row.matched_product_id;
  let crossSupplierGroupId: string | null = null;

  // Review finding MAJOR-5: when the matched product belongs to a DIFFERENT
  // supplier, accepting must not overwrite that supplier's library row.
  // Reroute through the item_group flow instead — creating THIS supplier's
  // own offering, pre-grouped with the matched product's family when it has
  // one — per the existing cross-supplier (item_group) pattern.
  if (matchKind === "existing_product" && row.matched_product_id) {
    const { data: matchedProduct, error: productError } = await supabase
      .from("products")
      .select("id, supplier_id, item_group_id")
      .eq("id", row.matched_product_id)
      .maybeSingle<{ id: string; supplier_id: string | null; item_group_id: string | null }>();
    if (productError) {
      return { ok: false, error: `Could not load the matched product: ${productError.message}` };
    }
    if (!matchedProduct) return { ok: false, error: "The matched product no longer exists." };
    if (isCrossSupplierProductMatch(matchedProduct.supplier_id, upload.supplier_id)) {
      matchKind = "item_group";
      existingProductId = null;
      crossSupplierGroupId = matchedProduct.item_group_id;
    }
  }

  const categoryRaw = formData.get("generic_category");
  const category = isProductCategory(categoryRaw) ? categoryRaw : null;

  const gate = checkAcceptAllowed({
    uploadSupplierId: upload.supplier_id,
    matchKind,
    newItemCategory: category,
  });
  if (!gate.ok) return { ok: false, error: gate.error };

  const description = String(formData.get("description") ?? row.proposed_description ?? "").trim();
  const unitCostRaw = formData.get("unit_cost");
  const unitCost = unitCostRaw !== null && unitCostRaw !== "" ? Number(unitCostRaw) : row.proposed_unit_cost;
  if (unitCost === null || !Number.isFinite(unitCost) || unitCost < 0) {
    return { ok: false, error: "Enter a valid unit cost (zero or greater)." };
  }
  const currencyRaw = formData.get("currency");
  const currency = isCurrencyCode(currencyRaw) ? currencyRaw : row.proposed_currency;
  if (!currency) return { ok: false, error: "Choose a currency." };
  const qtyRaw = formData.get("qty");
  const qty = qtyRaw !== null && qtyRaw !== "" ? Number(qtyRaw) : row.proposed_qty;
  // Review finding MINOR-1: validate qty like unit cost — finite and > 0 —
  // rather than storing garbage for the seed-quote path to silently coerce.
  if (!isValidAcceptQty(qty)) {
    return { ok: false, error: "Enter a valid quantity (a number greater than zero)." };
  }

  const original: ProposedValues = {
    description: row.proposed_description,
    unitCost: row.proposed_unit_cost,
    currency: row.proposed_currency,
    qty: row.proposed_qty,
  };
  const submitted: ProposedValues = { description, unitCost, currency, qty };
  const status = resolveAcceptedStatus(original, submitted);

  const itemGroupId =
    String(formData.get("item_group_id") ?? "").trim() || crossSupplierGroupId || row.item_group_match_id;

  // Review finding MAJOR-2: claim the row FIRST with a conditional status
  // flip — only an unresolved row can transition, so of two concurrent
  // accepts (or an accept racing a reject) exactly one wins; the loser's
  // update matches zero rows and NO library/history write happens for it.
  const nowIso = new Date().toISOString();
  const { data: claimedRows, error: claimError } = await supabase
    .from("extracted_prices")
    .update({
      proposed_description: description,
      proposed_unit_cost: unitCost,
      proposed_currency: currency,
      proposed_qty: qty,
      review_status: status,
      reviewed_by: user.id,
      reviewed_at: nowIso,
      applied_at: nowIso,
    })
    .eq("id", rowId)
    .in("review_status", ["confident", "needs_review"])
    .select("id");
  if (claimError) return { ok: false, error: `Could not mark the row resolved: ${claimError.message}` };
  if (!claimedRows || claimedRows.length === 0) {
    return { ok: false, error: "This row was already resolved (perhaps in another tab) — nothing was applied again." };
  }

  const { productId, error: applyError } = await applyLibraryUpdate(supabase, {
    matchKind,
    existingProductId,
    itemGroupId: matchKind === "existing_product" ? null : itemGroupId,
    uploadId,
    supplierId: upload.supplier_id as string,
    description,
    unitCost,
    currency,
    productRef: row.proposed_product_ref,
    category,
    userId: user.id,
  });
  if (applyError) {
    // The library write failed after the row was claimed — release the claim
    // (best-effort) so the founder can fix the problem and accept again.
    await supabase
      .from("extracted_prices")
      .update({
        review_status: row.review_status,
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at,
        applied_at: null,
      })
      .eq("id", rowId);
    return { ok: false, error: applyError };
  }

  // Record the resolved product on the row (for the cross-supplier/item-group
  // paths this is the newly created offering, not the other supplier's row).
  const { error: updateError } = await supabase
    .from("extracted_prices")
    .update({ matched_product_id: productId })
    .eq("id", rowId);
  if (updateError) return { ok: false, error: `Row saved to the library but could not record its product: ${updateError.message}` };

  await refreshUploadCompletion(supabase, uploadId);
  revalidateReview(uploadId);
  return { ok: true };
}

/** Rejects one extracted row — resolved, no library or quote effect (Task 39). */
export async function rejectExtractedRow(uploadId: string, rowId: string): Promise<ReviewActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to reject a row." };

  // Review finding MAJOR-2: refuse when already resolved — rejecting a row
  // AFTER it was accepted would flip the audit trail to "rejected" while the
  // library/history writes it triggered remain in place.
  const { data: row, error: rowError } = await supabase
    .from("extracted_prices")
    .select("id, review_status")
    .eq("id", rowId)
    .eq("price_file_upload_id", uploadId)
    .maybeSingle<{ id: string; review_status: ExtractedPriceRow["review_status"] }>();
  if (rowError) return { ok: false, error: `Could not load the row: ${rowError.message}` };
  if (!row) return { ok: false, error: "Row not found." };
  if (isResolvedStatus(row.review_status)) {
    return { ok: false, error: "This row is already resolved — reload the page to see its current state." };
  }

  // Conditional flip: only an unresolved row can transition to rejected, so
  // a reject racing an accept in another tab can't clobber the accepted state.
  const { data: rejected, error } = await supabase
    .from("extracted_prices")
    .update({ review_status: "rejected", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", rowId)
    .eq("price_file_upload_id", uploadId)
    .in("review_status", ["confident", "needs_review"])
    .select("id");
  if (error) return { ok: false, error: `Could not reject the row: ${error.message}` };
  if (!rejected || rejected.length === 0) {
    return { ok: false, error: "This row was already resolved (perhaps in another tab) — nothing was changed." };
  }

  await refreshUploadCompletion(supabase, uploadId);
  revalidateReview(uploadId);
  return { ok: true };
}

/**
 * Bulk-accepts every confident row that already matches an existing product
 * (Task 39 "Bulk accept all confident"). item_group/new_item rows are never
 * bulk-accepted (lib/price-extraction/review.ts selectBulkAcceptableRowIds)
 * since they need a founder-chosen category first.
 */
export async function acceptAllConfident(uploadId: string): Promise<ReviewActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const loadedUpload = await loadUpload(supabase, uploadId);
  if ("error" in loadedUpload) return { ok: false, error: loadedUpload.error };
  const { upload } = loadedUpload;
  if (!upload.supplier_id) return { ok: false, error: "Set a supplier for this upload before accepting rows." };

  const { data: rows, error: rowsError } = await supabase
    .from("extracted_prices")
    .select("*")
    .eq("price_file_upload_id", uploadId);
  if (rowsError) return { ok: false, error: `Could not load rows: ${rowsError.message}` };

  const candidates = (rows as ExtractedPriceRow[]) ?? [];

  // Review finding MAJOR-5: the bulk selection excludes rows whose matched
  // product belongs to a different supplier than the upload — they stay in
  // the table for per-row review (with the supplier visibly shown) instead
  // of being silently repriced across suppliers.
  const candidateProductIds = [
    ...new Set(candidates.map((r) => r.matched_product_id).filter((v): v is string => Boolean(v))),
  ];
  const productSupplierById = new Map<string, string | null>();
  if (candidateProductIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, supplier_id")
      .in("id", candidateProductIds);
    if (productsError) {
      return { ok: false, error: `Could not load the matched products: ${productsError.message}` };
    }
    for (const p of (products as { id: string; supplier_id: string | null }[]) ?? []) {
      productSupplierById.set(p.id, p.supplier_id);
    }
  }

  const acceptableIds = new Set(selectBulkAcceptableRowIds(candidates, upload.supplier_id, productSupplierById));
  const targets = candidates.filter((r) => acceptableIds.has(r.id));

  const errors: string[] = [];
  for (const row of targets) {
    if (!row.matched_product_id || row.proposed_unit_cost === null || !row.proposed_currency) continue;
    // Same conditional claim as the per-row accept (MAJOR-2): only an
    // unresolved row transitions, so a concurrent bulk accept (or a per-row
    // action racing this loop) can't double-write history for the same row.
    const nowIso = new Date().toISOString();
    const { data: claimedRows, error: claimError } = await supabase
      .from("extracted_prices")
      .update({
        review_status: "accepted",
        reviewed_by: user.id,
        reviewed_at: nowIso,
        applied_at: nowIso,
      })
      .eq("id", row.id)
      .in("review_status", ["confident", "needs_review"])
      .select("id");
    if (claimError) {
      errors.push(claimError.message);
      continue;
    }
    if (!claimedRows || claimedRows.length === 0) continue; // already resolved elsewhere — skip silently

    const { error: applyError } = await applyLibraryUpdate(supabase, {
      matchKind: "existing_product",
      existingProductId: row.matched_product_id,
      itemGroupId: null,
      uploadId,
      supplierId: upload.supplier_id,
      description: row.proposed_description ?? "",
      unitCost: row.proposed_unit_cost,
      currency: row.proposed_currency,
      productRef: row.proposed_product_ref,
      category: null,
      userId: user.id,
    });
    if (applyError) {
      // Release the claim (best-effort) so the row stays reviewable.
      await supabase
        .from("extracted_prices")
        .update({ review_status: row.review_status, reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at, applied_at: null })
        .eq("id", row.id);
      errors.push(applyError);
    }
  }

  await refreshUploadCompletion(supabase, uploadId);
  revalidateReview(uploadId);
  if (errors.length > 0) {
    return { ok: false, error: `${targets.length - errors.length} of ${targets.length} rows accepted; some failed: ${errors[0]}` };
  }
  return { ok: true };
}

/**
 * Output path 2 (Task 41): seeds a draft quote from every accepted/edited
 * row on this upload. Founder picks EITHER an existing project OR a company
 * to create a new retrofit project under (mirrors the Task 17 company-page
 * pattern, app/admin/companies/[id]/quoteActions.ts). Creates the quote via
 * the EXISTING createLineItemQuoteRecord (same insert as a hand-built
 * line-item quote), then inserts one quote_line_items row per accepted
 * extraction line via the EXISTING ensureOriginForSupplier, and finally
 * calls the EXISTING regroupLineItemOrigins + recomputeQuote — the same
 * functions app/admin/quotes/[id]/lineItemActions.ts uses for a hand-added
 * line. No calculation happens in this function.
 */
export async function seedQuoteFromReview(
  uploadId: string,
  _prevState: ReviewActionResult,
  formData: FormData
): Promise<ReviewActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to seed a quote." };

  const loadedUpload = await loadUpload(supabase, uploadId);
  if ("error" in loadedUpload) return { ok: false, error: loadedUpload.error };
  const { upload } = loadedUpload;

  let projectId = String(formData.get("project_id") ?? "").trim();
  const companyId = String(formData.get("company_id") ?? "").trim();
  const projectNameRaw = String(formData.get("project_name") ?? "").trim();

  if (!projectId) {
    if (!companyId) return { ok: false, error: "Choose an existing project, or a company to start a new one under." };
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) return { ok: false, error: `Could not load the company: ${companyError.message}` };
    if (!company) return { ok: false, error: "Company not found." };

    const today = new Date().toISOString().slice(0, 10);
    const projectName = projectNameRaw || `Retrofit — ${company.name} — ${today}`;
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ company_id: companyId, name: projectName, project_type: "retrofit", status: "active" })
      .select("id")
      .single();
    if (projectError || !project) {
      return { ok: false, error: `Could not create a project for this quote: ${projectError?.message ?? "unknown error"}` };
    }
    projectId = project.id as string;
  }

  const quoteResult = await createLineItemQuoteRecord(projectId);
  if (!quoteResult.ok) return { ok: false, error: quoteResult.error };
  const quoteId = quoteResult.quoteId;

  const { data: quote, error: quoteLoadError } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .maybeSingle();
  if (quoteLoadError || !quote) {
    return { ok: false, error: `Quote ${quoteId} was created but could not be reloaded to add lines.` };
  }

  const { data: rows, error: rowsError } = await supabase
    .from("extracted_prices")
    .select("*")
    .eq("price_file_upload_id", uploadId)
    .in("review_status", ["accepted", "edited"]);
  if (rowsError) {
    return { ok: false, error: `Quote ${quoteId} was created but its lines could not be loaded: ${rowsError.message}` };
  }
  const acceptedRows = (rows as ExtractedPriceRow[]) ?? [];
  const drafts = buildSeedQuoteLineDrafts(
    acceptedRows.map((r) => ({
      id: r.id,
      matched_product_id: r.matched_product_id,
      proposed_qty: r.proposed_qty,
      proposed_unit_cost: r.proposed_unit_cost,
      proposed_currency: r.proposed_currency,
    })),
    "USD"
  );

  if (drafts.length === 0) {
    return { ok: false, error: `Quote ${quoteId} was created but no accepted rows had a resolved product to seed lines from.` };
  }

  if (!upload.supplier_id) {
    return { ok: false, error: `Quote ${quoteId} was created but this upload has no supplier set for its lines.` };
  }
  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select("id, origin_region, country")
    .eq("id", upload.supplier_id)
    .maybeSingle();
  if (supplierError || !supplier) {
    return { ok: false, error: `Quote ${quoteId} was created but the supplier could not be loaded for its origin pool.` };
  }

  const { originId, error: originError } = await ensureOriginForSupplier(
    supabase,
    quoteId,
    supplier,
    quote.parameters_snapshot
  );
  if (originError || !originId) {
    return { ok: false, error: `Quote ${quoteId} was created but its shipment origin could not be resolved: ${originError}` };
  }

  const fxEngine = fxSnapshotToEngine(quote.fx_snapshot);
  const { count } = await supabase
    .from("quote_line_items")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);
  let sortOrder = count ?? 0;

  const lineInserts = drafts.map((d) => {
    const unitCostUsd = toUsd(d.unitCost, d.currency, fxEngine) ?? 0;
    const lineValueUsd = d.qty * unitCostUsd;
    return {
      quote_id: quoteId,
      product_id: d.productId,
      supplier_id: upload.supplier_id,
      quote_origin_id: originId,
      qty: d.qty,
      unit_cost: d.unitCost,
      cost_currency: d.currency,
      unit_cost_usd: unitCostUsd,
      line_value_usd: lineValueUsd,
      landed_cost_usd: lineValueUsd, // placeholder; recomputeQuote overwrites with the allocated landed cost
      sort_order: sortOrder++,
    };
  });

  const { error: lineInsertError } = await supabase.from("quote_line_items").insert(lineInserts);
  if (lineInsertError) {
    return { ok: false, error: `Quote ${quoteId} was created but its lines failed to save: ${lineInsertError.message}` };
  }

  const { error: regroupError } = await regroupLineItemOrigins(supabase, quoteId);
  if (regroupError) {
    return { ok: false, error: `Quote ${quoteId} was created but origin pools could not be regrouped: ${regroupError}` };
  }
  const { error: computeError } = await recomputeQuote(supabase, quoteId);
  if (computeError) {
    return { ok: false, error: `Quote ${quoteId} was created but the initial calculation failed: ${computeError}. Open it and re-save to recompute.` };
  }

  revalidatePath("/admin/quotes");
  revalidateReview(uploadId);
  redirect(`/admin/quotes/${quoteId}`);
}
