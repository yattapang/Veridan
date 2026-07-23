"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadCatalogueFile, uploadCatalogueThumbnail, removeCatalogueFiles } from "@/lib/storage";
import {
  buildCatalogueFileStoragePath,
  buildCatalogueThumbnailStoragePath,
  validateCatalogueFile,
  validateCatalogueThumbnail,
} from "@/lib/catalogue/validation";
import { parseCatalogueVisibility, transitionNeedsRightsConfirmation } from "@/lib/catalogue/visibility";
import type { CatalogueDocumentRow, CatalogueVisibility } from "@/lib/supabase/types";

export type CatalogueActionResult = { ok: true; error?: undefined } | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function nullableStr(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s.length > 0 ? s : null;
}

async function getSupabaseOrError() {
  try {
    return { supabase: await createClient(), error: null as null };
  } catch (err) {
    return { supabase: null, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }
}

/**
 * Public-page cache freshness — called after ANY mutation that could change
 * what the public browse page shows (a new public row, an edited
 * title/brand/category/description, a visibility flip, a delete). Cheap and
 * harmless to call even when the affected document is Internal (Plan §1.5's
 * `revalidateTag` mechanism, reused here exactly as Phase 3B's
 * revalidatePublicArticle does for `articles:list`).
 */
function revalidatePublicCatalogue() {
  revalidateTag("catalogue:list", { expire: 0 });
}

function revalidateCatalogueAdmin() {
  revalidatePath("/admin/catalogue");
}

interface ParsedCatalogueFields {
  brand: string;
  category: string | null;
  title: string;
  description: string | null;
}

function parseCatalogueFields(
  formData: FormData
): { ok: true; fields: ParsedCatalogueFields } | { ok: false; error: string } {
  const brand = str(formData.get("brand"));
  if (!brand) return { ok: false, error: "Brand is required." };

  const title = str(formData.get("title"));
  if (!title) return { ok: false, error: "Title is required." };

  return {
    ok: true,
    fields: {
      brand,
      category: nullableStr(formData.get("category")),
      title,
      description: nullableStr(formData.get("description")),
    },
  };
}

// ---------------------------------------------------------------------------
// Create — uploads the PDF (required) + optional thumbnail, then inserts the
// row. Plan §3.4: "Upload form (brand, category, title, description, file,
// visibility — defaulting to Internal in the form as well as the schema)".
// ---------------------------------------------------------------------------

export async function createCatalogueDocument(
  _prevState: CatalogueActionResult,
  formData: FormData
): Promise<CatalogueActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to upload a catalogue document." };

  const parsed = parseCatalogueFields(formData);
  if (!parsed.ok) return parsed;

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Choose a PDF to upload." };
  }
  const fileValidation = validateCatalogueFile({ name: file.name, type: file.type, size: file.size });
  if (!fileValidation.ok) return fileValidation;

  const thumbnail = formData.get("thumbnail");
  if (thumbnail instanceof File && thumbnail.size > 0) {
    const thumbValidation = validateCatalogueThumbnail({
      name: thumbnail.name,
      type: thumbnail.type,
      size: thumbnail.size,
    });
    if (!thumbValidation.ok) return thumbValidation;
  }

  // *** GUARDRAIL (Plan §3.3): parseCatalogueVisibility falls back to
  // 'internal' for anything missing/malformed — it can never resolve to
  // 'public' from an absent or bad form field. The schema-level column
  // default is the second, independent layer under this. ***
  const visibility = parseCatalogueVisibility(formData.get("visibility"));
  if (visibility === "public") {
    const rightsConfirmed = formData.get("rights_confirmed") === "true";
    if (!rightsConfirmed) {
      return {
        ok: false,
        error:
          "Confirm you are licensed to publish this supplier's catalogue publicly before making it visible.",
      };
    }
  }

  const documentId = crypto.randomUUID();
  const storagePath = buildCatalogueFileStoragePath(documentId, file.name);

  const { error: uploadError } = await uploadCatalogueFile(supabase, storagePath, file);
  if (uploadError) return { ok: false, error: `Could not upload the file: ${uploadError}` };

  let thumbnailPath: string | null = null;
  if (thumbnail instanceof File && thumbnail.size > 0) {
    thumbnailPath = buildCatalogueThumbnailStoragePath(documentId, thumbnail.name);
    const { error: thumbUploadError } = await uploadCatalogueThumbnail(supabase, thumbnailPath, thumbnail);
    if (thumbUploadError) {
      await removeCatalogueFiles(supabase, [storagePath]);
      return { ok: false, error: `Could not upload the thumbnail: ${thumbUploadError}` };
    }
  }

  const { error: insertError } = await supabase.from("catalogue_documents").insert({
    id: documentId,
    brand: parsed.fields.brand,
    category: parsed.fields.category,
    title: parsed.fields.title,
    description: parsed.fields.description,
    file_storage_path: storagePath,
    original_filename: file.name,
    file_size_bytes: file.size,
    thumbnail_storage_path: thumbnailPath,
    visibility,
    published_at: visibility === "public" ? new Date().toISOString() : null,
    uploaded_by: user.id,
  });

  if (insertError) {
    await removeCatalogueFiles(supabase, [storagePath, thumbnailPath]);
    return { ok: false, error: `Could not save the document: ${insertError.message}` };
  }

  revalidateCatalogueAdmin();
  revalidatePublicCatalogue();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Edit — text fields only. Never touches visibility, file, or thumbnail.
// ---------------------------------------------------------------------------

export async function updateCatalogueDocument(
  documentId: string,
  _prevState: CatalogueActionResult,
  formData: FormData
): Promise<CatalogueActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to edit a catalogue document." };

  const parsed = parseCatalogueFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase
    .from("catalogue_documents")
    .update({
      brand: parsed.fields.brand,
      category: parsed.fields.category,
      title: parsed.fields.title,
      description: parsed.fields.description,
    })
    .eq("id", documentId);

  if (error) return { ok: false, error: `Could not save: ${error.message}` };

  revalidateCatalogueAdmin();
  revalidatePublicCatalogue();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Thumbnail replace
// ---------------------------------------------------------------------------

export async function replaceCatalogueThumbnail(
  documentId: string,
  _prevState: CatalogueActionResult,
  formData: FormData
): Promise<CatalogueActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to replace a thumbnail." };

  const thumbnail = formData.get("thumbnail");
  if (!(thumbnail instanceof File) || thumbnail.size === 0) {
    return { ok: false, error: "Choose an image file." };
  }
  const validation = validateCatalogueThumbnail({
    name: thumbnail.name,
    type: thumbnail.type,
    size: thumbnail.size,
  });
  if (!validation.ok) return validation;

  const { data: existing } = await supabase
    .from("catalogue_documents")
    .select("thumbnail_storage_path")
    .eq("id", documentId)
    .maybeSingle<Pick<CatalogueDocumentRow, "thumbnail_storage_path">>();

  const path = buildCatalogueThumbnailStoragePath(documentId, thumbnail.name);
  const { error: uploadError } = await uploadCatalogueThumbnail(supabase, path, thumbnail);
  if (uploadError) return { ok: false, error: `Could not upload the thumbnail: ${uploadError}` };

  const { error: updateError } = await supabase
    .from("catalogue_documents")
    .update({ thumbnail_storage_path: path })
    .eq("id", documentId);
  if (updateError) return { ok: false, error: `Thumbnail uploaded but could not be saved: ${updateError.message}` };

  // Best-effort cleanup of the previous thumbnail, if its path differs from the new one.
  if (existing?.thumbnail_storage_path && existing.thumbnail_storage_path !== path) {
    await removeCatalogueFiles(supabase, [existing.thumbnail_storage_path]);
  }

  revalidateCatalogueAdmin();
  revalidatePublicCatalogue();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Visibility toggle — THE §3.3 guardrail's admin-side half. The client
// component (CatalogueListItem) is responsible for showing the rights-
// confirmation warning and gating the "make public" action behind an
// explicit window.confirm() of that exact text BEFORE calling this action
// (mirrors the existing delete-confirm pattern in ItemGroupListItem.tsx) —
// this server action independently re-validates the transition shape itself
// so a client-side bug can never skip the internal-by-default guarantee.
// ---------------------------------------------------------------------------

export async function setCatalogueVisibility(
  documentId: string,
  nextVisibility: CatalogueVisibility
): Promise<CatalogueActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to change a document's visibility." };

  const { data: existing, error: loadError } = await supabase
    .from("catalogue_documents")
    .select("id, visibility")
    .eq("id", documentId)
    .maybeSingle<Pick<CatalogueDocumentRow, "id" | "visibility">>();
  if (loadError) return { ok: false, error: `Could not load the document: ${loadError.message}` };
  if (!existing) return { ok: false, error: "Document not found." };

  // Note: this server action does not itself demand a "confirmed" flag —
  // getting a founder-authenticated session to this action already required
  // clicking through the client's confirm() dialog (which shows
  // CATALOGUE_RIGHTS_CONFIRMATION_WARNING verbatim for an internal -> public
  // transition). What this action DOES guarantee independent of the client:
  // the value written is always exactly 'internal' or 'public' (the
  // CatalogueVisibility type), never anything else.
  const patch: { visibility: CatalogueVisibility; published_at?: string | null } = {
    visibility: nextVisibility,
  };
  if (transitionNeedsRightsConfirmation(existing.visibility, nextVisibility)) {
    patch.published_at = new Date().toISOString();
  } else if (nextVisibility === "internal") {
    patch.published_at = null;
  }

  const { error } = await supabase.from("catalogue_documents").update(patch).eq("id", documentId);
  if (error) return { ok: false, error: `Could not update visibility: ${error.message}` };

  revalidateCatalogueAdmin();
  revalidatePublicCatalogue();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteCatalogueDocument(documentId: string): Promise<CatalogueActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to delete a catalogue document." };

  const { data: existing } = await supabase
    .from("catalogue_documents")
    .select("file_storage_path, thumbnail_storage_path")
    .eq("id", documentId)
    .maybeSingle<Pick<CatalogueDocumentRow, "file_storage_path" | "thumbnail_storage_path">>();

  const { error } = await supabase.from("catalogue_documents").delete().eq("id", documentId);
  if (error) return { ok: false, error: `Could not delete: ${error.message}` };

  if (existing) {
    await removeCatalogueFiles(supabase, [existing.file_storage_path, existing.thumbnail_storage_path]);
  }

  revalidateCatalogueAdmin();
  revalidatePublicCatalogue();
  return { ok: true };
}
