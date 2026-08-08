"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { requireFounderAction } from "@/lib/roles/guards";
import { uploadPriceFile } from "@/lib/storage";
import { buildPriceFileStoragePath, validatePriceFile } from "@/lib/price-files";

export type PriceFileUploadFormResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

/**
 * Uploads a supplier price file (PDF/Excel/CSV/photo) to Storage and
 * creates the corresponding `price_file_uploads` row (Task 36, Plan §2.2
 * Stage 1). Supplier is optional — "Let extraction detect the supplier" is
 * the default, matching `supplier_id`'s nullable, set-null-on-delete shape
 * from the Task 35 delta migration. `extraction_status` starts 'pending';
 * Task 37 (the extraction API) is the only thing that ever advances it.
 */
export async function createPriceFileUpload(
  _prevState: PriceFileUploadFormResult,
  formData: FormData
): Promise<PriceFileUploadFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to upload a price file." };

  // Founder-only (security review 2026-08-08). A supplier price file IS a list of
  // supplier costs — it is the source every `extracted_prices` and
  // `product_price_history` row is scanned out of — and the `price-files` bucket
  // is founder-only in Storage from 20260807000004 §6c. Without this gate a staff
  // upload would fail deep inside Storage with an opaque policy error instead of
  // a sentence explaining why. Staff keep the uploads LIST (file name, status),
  // which is the split lib/roles/matrix.ts already documents.
  const founderGate = await requireFounderAction("upload a supplier price file");
  if (!founderGate.ok) return { ok: false, error: founderGate.error };

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Choose a file to upload." };
  }

  const validation = validatePriceFile({ name: file.name, type: file.type, size: file.size });
  if (!validation.ok) return { ok: false, error: validation.error };

  const supplierIdRaw = String(formData.get("supplier_id") ?? "").trim();
  const supplierId = supplierIdRaw ? supplierIdRaw : null;

  const uploadId = crypto.randomUUID();
  const storagePath = buildPriceFileStoragePath(uploadId, file.name);

  const { error: uploadError } = await uploadPriceFile(supabase, storagePath, file);
  if (uploadError) {
    return { ok: false, error: `Could not upload the file: ${uploadError}` };
  }

  const { error: insertError } = await supabase.from("price_file_uploads").insert({
    id: uploadId,
    supplier_id: supplierId,
    file_storage_path: storagePath,
    original_filename: file.name,
    uploaded_by: user.id,
    extraction_status: "pending",
  });

  if (insertError) {
    // Best-effort cleanup of the orphaned Storage object; failure here isn't
    // worth surfacing over the original insert error.
    await supabase.storage.from("price-files").remove([storagePath]);
    return { ok: false, error: `Could not record the upload: ${insertError.message}` };
  }

  revalidatePath("/admin/price-files");
  return { ok: true };
}
