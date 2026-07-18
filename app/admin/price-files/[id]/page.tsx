import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { PriceFileUploadWithDetails } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { signPriceFileUrl, fileNameFromPath } from "@/lib/storage";
import { extractionStatusBadgeClass, extractionStatusLabel } from "@/lib/price-files";
import { STALE_EXTRACTION_MINUTES, isExtractionStale } from "@/lib/price-extraction/extraction-core";
import { RunExtractionButton } from "./RunExtractionButton";

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

  // Extraction summary counts (Task 37 status display). Only meaningful once
  // extraction has produced rows; harmless (0s) otherwise.
  let lineCount = 0;
  let confidentCount = 0;
  let needsReviewCount = 0;
  try {
    const { data: rows } = await supabase
      .from("extracted_prices")
      .select("review_status")
      .eq("price_file_upload_id", upload.id);
    if (rows) {
      lineCount = rows.length;
      for (const r of rows as { review_status: string }[]) {
        if (r.review_status === "confident") confidentCount++;
        else if (r.review_status === "needs_review") needsReviewCount++;
      }
    }
  } catch {
    // Non-fatal — the page still renders without the counts.
  }

  // A run wedged in 'extracting' past the staleness window (e.g. the
  // serverless function was killed mid-run) gets a retry button rather than
  // being stuck forever (review finding MAJOR-4). The server side enforces
  // the same window, so a fresh run can't be stomped from a stale tab.
  const isStalledExtraction =
    upload.extraction_status === "extracting" && isExtractionStale(upload.updated_at);
  const canRunExtraction =
    upload.extraction_status === "pending" ||
    upload.extraction_status === "failed" ||
    isStalledExtraction;
  const runLabel = isStalledExtraction
    ? "Retry stalled extraction"
    : upload.extraction_status === "failed"
      ? "Retry extraction"
      : "Run extraction";

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

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Extraction
        </h2>

        {upload.extraction_status === "extracting" &&
          (isStalledExtraction ? (
            <p className="mb-4 text-sm text-amber-700">
              This extraction has been running for more than {STALE_EXTRACTION_MINUTES} minutes and
              looks stalled — the run may have been cut off. You can retry it below.
            </p>
          ) : (
            <p className="text-sm text-veridan-warm-gray">
              Extraction is running — Claude is reading the file and matching line items against the
              Hardware Library. Reload this page in a moment to see the result.
            </p>
          ))}

        {upload.extraction_status === "failed" && (
          <p className="mb-4 text-sm text-red-600">
            {upload.error_message ?? "Extraction failed. Try running it again."}
          </p>
        )}

        {(upload.extraction_status === "review" || upload.extraction_status === "completed") && (
          <div className="text-sm text-veridan-ink">
            <p>
              Extraction produced <strong>{lineCount}</strong>{" "}
              {lineCount === 1 ? "line" : "lines"} — <strong>{confidentCount}</strong> confident,{" "}
              <strong>{needsReviewCount}</strong> to review.
            </p>
            <p className="mt-2 text-veridan-warm-gray">
              Review each line (accept / edit / reject, with the raw source text beside each
              proposal), then optionally seed a draft quote from the accepted rows.
            </p>
            <div className="mt-4">
              <Link
                href={`/admin/price-files/${upload.id}/review`}
                className="inline-block rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
              >
                {upload.extraction_status === "completed" ? "Open review" : "Review extracted lines"}
              </Link>
            </div>
          </div>
        )}

        {upload.extraction_status === "pending" && (
          <p className="mb-4 text-sm text-veridan-warm-gray">
            This upload is recorded and its file is stored. Run extraction to have Claude read the
            file and propose cost-side line items matched against the Hardware Library.
          </p>
        )}

        {canRunExtraction && (
          <div className="mt-4">
            <RunExtractionButton uploadId={upload.id} label={runLabel} />
          </div>
        )}
      </section>
    </div>
  );
}
