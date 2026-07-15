import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ENQUIRY_STATUSES, type EnquiryRow } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { signEnquiryFileUrls, fileNameFromPath } from "@/lib/storage";

export const metadata = {
  title: "Enquiries",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  reviewing: "Reviewing",
  converted: "Converted",
  discarded: "Discarded",
};

const PATHWAY_LABELS: Record<string, string> = {
  new_construction: "New construction",
  retrofit: "Retrofit",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const status = firstParam(params.status).trim();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Enquiries</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let query = supabase.from("enquiries").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  let data: EnquiryRow[] | null = null;
  let loadError: string | null = null;

  try {
    const { data: rows, error } = await query;
    if (error) loadError = error.message;
    else data = rows as EnquiryRow[];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Enquiries</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The enquiries table couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const enquiries = data ?? [];

  // Best-effort: sign the first uploaded file per enquiry for a quick
  // download link directly from the list. Detail page shows all files.
  const firstFileEntries = await Promise.all(
    enquiries.map(async (e) => {
      const first = e.uploaded_file_paths?.[0];
      if (!first) return [e.id, null] as const;
      const [signed] = await signEnquiryFileUrls(supabase, [first]);
      return [e.id, signed] as const;
    })
  );
  const firstFileByEnquiry = new Map(firstFileEntries);

  const inputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Enquiries</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Portal submissions (PRD §5.4). Review a submission, then convert it
        into a company + project to start quoting.
      </p>

      <section className="mt-8">
        <form method="get" className="grid gap-3 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status} className={`${inputClass} mt-1`}>
              <option value="">All statuses</option>
              {ENQUIRY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3 sm:col-span-4">
            <button
              type="submit"
              className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
            >
              Apply filter
            </button>
            {status && (
              <Link
                href="/admin/enquiries"
                className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
              >
                Clear
              </Link>
            )}
          </div>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          {status ? `${STATUS_LABELS[status] ?? status} enquiries` : "All enquiries"}
        </h2>
        {enquiries.length === 0 ? (
          <InstructiveMessage
            title={status ? "No enquiries match" : "No enquiries yet"}
            body={
              status
                ? "Try a different status filter."
                : "Submissions from the public quote-request portal will appear here."
            }
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {enquiries.map((e) => {
              const file = firstFileByEnquiry.get(e.id);
              return (
                <li key={e.id} className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Link href={`/admin/enquiries/${e.id}`} className="min-w-0">
                      <p className="text-sm font-medium text-veridan-ink">
                        {e.company_name || e.contact_name}
                        {e.honeypot_tripped && (
                          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-600">
                            Honeypot tripped
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-veridan-warm-gray">
                        {PATHWAY_LABELS[e.pathway] ?? e.pathway} · {e.contact_name} ·{" "}
                        {e.contact_email}
                        {e.contact_phone ? ` · ${e.contact_phone}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-veridan-ink/70">
                        Submitted {formatDate(e.created_at)}
                      </p>
                    </Link>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                      <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-ink">
                        {STATUS_LABELS[e.status] ?? e.status}
                      </span>
                      {file &&
                        (file.url ? (
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
                          >
                            {fileNameFromPath(file.path)}
                          </a>
                        ) : (
                          <span className="text-xs text-veridan-warm-gray">File link unavailable</span>
                        ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
