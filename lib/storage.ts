import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Signed-URL helper for the private `enquiry-uploads` bucket (Task 13).
 * Founders are `authenticated`, which has full CRUD on the bucket per
 * supabase/migrations/20260713000002_rls.sql, so a signed URL generated
 * from a founder's own session works without a service-role client.
 * Best-effort: a failed signing (e.g. object since deleted, or Storage not
 * configured) yields `url: null` for that path rather than failing the
 * whole page render.
 */
export async function signEnquiryFileUrls(
  supabase: SupabaseClient,
  paths: string[] | null | undefined,
  expiresInSeconds = 60 * 60
): Promise<{ path: string; url: string | null }[]> {
  if (!paths || paths.length === 0) return [];

  return Promise.all(
    paths.map(async (path) => {
      try {
        const { data, error } = await supabase.storage
          .from("enquiry-uploads")
          .createSignedUrl(path, expiresInSeconds);
        if (error || !data) return { path, url: null };
        return { path, url: data.signedUrl };
      } catch {
        return { path, url: null };
      }
    })
  );
}

/** Trims a Storage path down to its filename for display. */
export function fileNameFromPath(path: string): string {
  const parts = path.split("/");
  const last = parts[parts.length - 1] ?? path;
  // Uploaded paths are `${pathway}/${timestamp}-${safeName}` — drop the
  // timestamp prefix for a friendlier label.
  return last.replace(/^\d+-/, "");
}

/**
 * Uploads the immutable "sent" PDF artifact to the private `quote-pdfs`
 * bucket (Task 19 send flow, §1.7 pdf_storage_path). Path convention:
 * `<quote_ref>/<revision_number>.pdf` — one immutable object per version,
 * so re-sending the SAME version overwrites its own artifact (upsert) but a
 * later revision (different quote row, different revision_number) never
 * touches an earlier version's file. Founders are `authenticated`, which has
 * full CRUD on this bucket per supabase/migrations/20260713000002_rls.sql.
 */
export async function uploadQuotePdf(
  supabase: SupabaseClient,
  quoteRef: string,
  revisionNumber: number,
  buffer: Buffer
): Promise<{ path: string | null; error: string | null }> {
  const path = `${quoteRef}/${revisionNumber}.pdf`;
  const { error } = await supabase.storage.from("quote-pdfs").upload(path, buffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) return { path: null, error: error.message };
  return { path, error: null };
}

/**
 * Signs a URL for a previously uploaded sent-quote PDF artifact, for the
 * quote detail page's "sent-artifact download link… alongside the live PDF
 * link" (Task 19). Best-effort, same pattern as signEnquiryFileUrls — a
 * failure to sign yields `null` rather than failing the page render.
 */
export async function signQuotePdfUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
  expiresInSeconds = 60 * 60
): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from("quote-pdfs").createSignedUrl(path, expiresInSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Uploads the immutable "sent" PDF artifact to the private `invoice-pdfs`
 * bucket (Task 48c send flow, invoices.pdf_storage_path). Path convention:
 * `<invoice_number>.pdf` — invoice numbers are unique and an invoice is
 * never revised in place (a correction voids and a new invoice is raised),
 * so upserting on invoice_number is safe and idempotent for a resend.
 * Founders are `authenticated`, which has full CRUD on this bucket per
 * supabase/migrations/20260718000002_invoicing.sql.
 */
export async function uploadInvoicePdf(
  supabase: SupabaseClient,
  invoiceNumber: string,
  buffer: Buffer
): Promise<{ path: string | null; error: string | null }> {
  const path = `${invoiceNumber}.pdf`;
  const { error } = await supabase.storage.from("invoice-pdfs").upload(path, buffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) return { path: null, error: error.message };
  return { path, error: null };
}

/**
 * Signs a URL for a previously uploaded sent-invoice PDF artifact, for the
 * invoice detail page's "sent-artifact download link… alongside the live PDF
 * link" (Task 49). Best-effort, same pattern as signQuotePdfUrl — a failure
 * to sign yields `null` rather than failing the page render.
 */
export async function signInvoicePdfUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
  expiresInSeconds = 60 * 60
): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from("invoice-pdfs").createSignedUrl(path, expiresInSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Uploads a supplier price file to the private `price-files` bucket (Task
 * 36, Plan §2.2 Stage 1). Path convention: `<uuid>/<original-filename>` per
 * the Task 36 brief — `uploadId` is the `price_file_uploads.id` generated
 * client-side before the insert, so the Storage path and the DB row agree
 * without a second write. Founders are `authenticated`, which has full CRUD
 * on this bucket per supabase/migrations/20260713000002_rls.sql.
 */
export async function uploadPriceFile(
  supabase: SupabaseClient,
  path: string,
  file: File
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from("price-files").upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) return { error: error.message };
  return { error: null };
}

/**
 * Signs a URL for a price file's stored object, for the detail page's file
 * download link (Task 36). Best-effort, same pattern as
 * signEnquiryFileUrls/signQuotePdfUrl — a failure to sign yields `null`
 * rather than failing the page render.
 */
export async function signPriceFileUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
  expiresInSeconds = 60 * 60
): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from("price-files").createSignedUrl(path, expiresInSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
