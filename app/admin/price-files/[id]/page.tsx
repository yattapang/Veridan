import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PriceFileUploadWithDetails } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { signPriceFileUrl, fileNameFromPath } from "@/lib/storage";
import { extractionStatusBadgeClass, extractionStatusLabel } from "@/lib/price-files";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Price File · ${id}` };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-veridan-ink">{value}</p>
    </div>
  );
}

/**
 * Honest placeholder detail page (Task 36). Shows the upload's metadata and
 * a signed-URL file download; extraction (Task 37) and the review screen
 * (Task 39) land in later builds. No buttons that pretend to trigger work
 * this build doesn't do.
 */
export default async function PriceFileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Price File</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let upload: PriceFileUploadWithDetails | null = null;
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase
      .from("price_file_uploads")
      .select("*, suppliers(id, name), users(id, email, display_name)")
      .eq("id", id)
      .maybeSingle<PriceFileUploadWithDetails>();
    if (error) loadError = error.message;
    else upload = data;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Price File</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The upload record couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  if (!upload) {
    notFound();
  }

  const fileUrl = await signPriceFileUrl(supabase, upload.file_storage_path);
  const displayName = upload.original_filename ?? fileNameFromPath(upload.file_storage_path);

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/price-files"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← All price files
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-veridan-ink">{displayName}</h1>
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${extractionStatusBadgeClass(upload.extraction_status)}`}
        >
          {extractionStatusLabel(upload.extraction_status)}
        </span>
      </div>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Uploaded {formatDateTime(upload.uploaded_at)}
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Upload details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier" value={upload.suppliers?.name ?? "Undetected"} />
          <Field
            label="Detected supplier confidence"
            value={
              upload.detected_supplier_confidence != null
                ? `${Math.round(upload.detected_supplier_confidence * 100)}%`
                : null
            }
          />
          <Field label="Uploaded by" value={upload.users?.display_name ?? upload.users?.email} />
          <Field label="Uploaded at" value={formatDateTime(upload.uploaded_at)} />
        </div>
        {upload.error_message && (
          <div className="mt-4">
            <Field label="Error" value={upload.error_message} />
          </div>
        )}

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">File</p>
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
            >
              Download {displayName}
            </a>
          ) : (
            <span className="text-sm text-veridan-warm-gray">
              {displayName} (link unavailable — Storage may not be configured)
            </span>
          )}
        </div>
      </section>

      <section className="mt-8">
        <InstructiveMessage
          title="Extraction and review land in the next build"
          body="This upload is recorded and its file is stored. Automated extraction (matching line items against the Hardware Library) and the accept/edit/reject review screen are a separate, upcoming build — nothing on this page triggers them yet."
        />
      </section>
    </div>
  );
}
