import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXTRACTION_MODEL,
  buildExtractionSystemPrompt,
  buildExtractionUserText,
  classifyExtractionFile,
  parseExtraction,
  type ExtractedLineItem,
} from "./extraction-core";
import {
  fuzzySupplierMatch,
  matchExtractedLine,
  normalizeCurrency,
  type ProductCandidate,
} from "./matching";

/**
 * Phase 2B Task 37 — extraction orchestration (Plan §2.2 Stage 2). Server-only:
 * imports the Anthropic client and drives Supabase I/O. The prompt/parse/match
 * logic it composes lives in the pure, tested modules alongside it.
 *
 * GUARDRAIL (Plan §2.3): only cost-side columns are written
 * (proposed_unit_cost + proposed_currency). No client price, margin, or FX; no
 * import of lib/landed-cost/ or lib/quotes/.
 */

/** Founder-readable message when the API key isn't configured. */
export const MISSING_API_KEY_MESSAGE =
  "Add ANTHROPIC_API_KEY to .env.local and Vercel env vars, then re-run extraction.";

/** Confidence threshold used when the parameter row is missing/unreadable (Plan §8 Q5). */
export const DEFAULT_EXTRACTION_THRESHOLD = 0.85;

/** Auto-assign a detected supplier only above this confidence (Plan §2.2 Stage 2). */
export const SUPPLIER_AUTO_ASSIGN_THRESHOLD = 0.8;

export type RunExtractionResult =
  | { ok: true; lineCount: number; confidentCount: number; needsReviewCount: number }
  | { ok: false; error: string };

interface PriceFileUploadRow {
  id: string;
  supplier_id: string | null;
  file_storage_path: string;
  original_filename: string | null;
}

/** Reads extraction_confidence_threshold from business_parameters (Task 35 seed). */
async function readConfidenceThreshold(supabase: SupabaseClient): Promise<number> {
  try {
    const { data } = await supabase
      .from("business_parameters")
      .select("value")
      .eq("key", "extraction_confidence_threshold")
      .maybeSingle<{ value: { value: unknown } }>();
    const v = data?.value?.value;
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1) return v;
  } catch {
    // fall through to default
  }
  return DEFAULT_EXTRACTION_THRESHOLD;
}

async function setFailed(
  supabase: SupabaseClient,
  uploadId: string,
  message: string
): Promise<{ ok: false; error: string }> {
  await supabase
    .from("price_file_uploads")
    .update({ extraction_status: "failed", error_message: message })
    .eq("id", uploadId);
  return { ok: false, error: message };
}

/**
 * Runs the full extraction pipeline for one upload:
 *   pending/failed → extracting → (Claude extract + supplier detect + match) → review
 * or → failed on any error, with a founder-readable error_message.
 *
 * `supabase` is the request-scoped founder client (RLS-enforced); founders have
 * full CRUD on these tables + the price-files bucket, matching the Task 36 flow.
 */
export async function runExtraction(
  supabase: SupabaseClient,
  uploadId: string
): Promise<RunExtractionResult> {
  // 1. Load the upload.
  const { data: upload, error: loadError } = await supabase
    .from("price_file_uploads")
    .select("id, supplier_id, file_storage_path, original_filename")
    .eq("id", uploadId)
    .maybeSingle<PriceFileUploadRow>();

  if (loadError) return { ok: false, error: `Could not load the upload: ${loadError.message}` };
  if (!upload) return { ok: false, error: "Upload not found." };

  // 2. Mark extracting, clear any prior error, and remove any prior rows so a
  //    re-run (after a failure) doesn't duplicate line items.
  await supabase
    .from("price_file_uploads")
    .update({ extraction_status: "extracting", error_message: null })
    .eq("id", uploadId);
  await supabase.from("extracted_prices").delete().eq("price_file_upload_id", uploadId);

  try {
    // 3. API key guard (founder-readable).
    if (!process.env.ANTHROPIC_API_KEY) {
      return await setFailed(supabase, uploadId, MISSING_API_KEY_MESSAGE);
    }

    // 4. Download the file from Storage.
    const { data: blob, error: dlError } = await supabase.storage
      .from("price-files")
      .download(upload.file_storage_path);
    if (dlError || !blob) {
      return await setFailed(
        supabase,
        uploadId,
        `Could not download the file from storage${dlError ? `: ${dlError.message}` : ""}.`
      );
    }

    // 5. Classify + build the file content block.
    const filename = upload.original_filename ?? upload.file_storage_path;
    const info = classifyExtractionFile(filename);

    if (info.kind === "spreadsheet") {
      return await setFailed(
        supabase,
        uploadId,
        "Excel (.xls/.xlsx) extraction is not yet supported in this build — export the sheet to CSV or PDF and re-upload."
      );
    }
    if (info.kind === "unknown") {
      return await setFailed(
        supabase,
        uploadId,
        "This file type can't be extracted — upload a PDF, CSV, or an image (.png/.jpg/.jpeg/.webp)."
      );
    }

    const supplierHintName = upload.supplier_id
      ? await fetchSupplierName(supabase, upload.supplier_id)
      : null;

    const userContent: Anthropic.ContentBlockParam[] = [];
    if (info.kind === "pdf") {
      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      userContent.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      });
    } else if (info.kind === "image") {
      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: info.mediaType as "image/png" | "image/jpeg" | "image/webp",
          data: base64,
        },
      });
    } else {
      // csv — pass the text directly.
      const csv = await blob.text();
      userContent.push({ type: "text", text: `Supplier quote (CSV):\n\n${csv}` });
    }
    userContent.push({ type: "text", text: buildExtractionUserText(supplierHintName) });

    // 6. Call Claude.
    const client = new Anthropic();
    let responseText: string;
    try {
      const message = await client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 8000,
        system: buildExtractionSystemPrompt(),
        messages: [{ role: "user", content: userContent }],
      });
      responseText = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error";
      return await setFailed(
        supabase,
        uploadId,
        `The extraction request to Claude failed: ${detail}. Check ANTHROPIC_API_KEY and your account's API access, then re-run.`
      );
    }

    // 7. Parse defensively.
    const parsed = parseExtraction(responseText);
    if (!parsed.ok) {
      return await setFailed(
        supabase,
        uploadId,
        `The extraction could not be read: ${parsed.error} Try re-running; if it persists, the source document may be too low-quality to extract.`
      );
    }
    const extraction = parsed.value;

    // 8. Supplier detection (only when the uploader didn't set one).
    let effectiveSupplierId = upload.supplier_id;
    if (!upload.supplier_id) {
      const suppliers = await fetchSuppliers(supabase);
      const detected = fuzzySupplierMatch(extraction.supplier_detected, suppliers);
      const uploadPatch: Record<string, unknown> = {
        detected_supplier_confidence: detected.supplierId ? detected.confidence : null,
      };
      if (detected.supplierId && detected.confidence >= SUPPLIER_AUTO_ASSIGN_THRESHOLD) {
        uploadPatch.supplier_id = detected.supplierId;
        effectiveSupplierId = detected.supplierId;
      }
      await supabase.from("price_file_uploads").update(uploadPatch).eq("id", uploadId);
    }

    // 9. Match every line against candidate products, then persist.
    const threshold = await readConfidenceThreshold(supabase);
    const candidates = await fetchProductCandidates(supabase);
    const quoteCurrency = normalizeCurrency(extraction.quote_metadata.currency);

    let confidentCount = 0;
    let needsReviewCount = 0;

    const rows = extraction.line_items.map((line) => {
      const match = matchExtractedLine(line, candidates, effectiveSupplierId, threshold);
      if (match.reviewStatus === "confident") confidentCount++;
      else needsReviewCount++;

      const proposedCurrency = normalizeCurrency(line.currency) ?? quoteCurrency;

      return {
        price_file_upload_id: uploadId,
        matched_product_id: match.matchedProductId,
        item_group_match_id: match.itemGroupMatchId,
        raw_extracted_text: rawLineJson(line, extraction.quote_metadata),
        proposed_description: line.raw_description,
        proposed_product_ref: line.product_ref_guess,
        proposed_qty: line.qty,
        proposed_unit_cost: line.unit_price,
        proposed_currency: proposedCurrency,
        confidence_score: match.confidenceScore,
        confidence_threshold_used: threshold,
        review_status: match.reviewStatus,
      };
    });

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("extracted_prices").insert(rows);
      if (insertError) {
        return await setFailed(
          supabase,
          uploadId,
          `The extracted lines could not be saved: ${insertError.message}`
        );
      }
    }

    // 10. Ready for review.
    await supabase
      .from("price_file_uploads")
      .update({ extraction_status: "review", error_message: null })
      .eq("id", uploadId);

    return {
      ok: true,
      lineCount: rows.length,
      confidentCount,
      needsReviewCount,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return await setFailed(supabase, uploadId, `Extraction failed unexpectedly: ${detail}`);
  }
}

/** The full raw line + quote metadata, stored as the audit jsonb (raw_extracted_text). */
function rawLineJson(
  line: ExtractedLineItem,
  quoteMetadata: { quote_ref: string | null; quote_date: string | null; currency: string | null; validity_text: string | null }
): Record<string, unknown> {
  return { line, quote_metadata: quoteMetadata };
}

async function fetchSupplierName(
  supabase: SupabaseClient,
  supplierId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("suppliers")
    .select("name")
    .eq("id", supplierId)
    .maybeSingle<{ name: string }>();
  return data?.name ?? null;
}

async function fetchSuppliers(supabase: SupabaseClient): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("suppliers").select("id, name").eq("active", true);
  return (data as { id: string; name: string }[] | null) ?? [];
}

async function fetchProductCandidates(supabase: SupabaseClient): Promise<ProductCandidate[]> {
  const { data } = await supabase
    .from("products")
    .select("id, product_ref, catalogue_ref, description, supplier_id, item_group_id")
    .eq("active", true);
  return (data as ProductCandidate[] | null) ?? [];
}
