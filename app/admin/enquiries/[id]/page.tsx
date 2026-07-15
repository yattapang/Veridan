import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow, EnquiryRow, ProjectRow } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { signEnquiryFileUrls, fileNameFromPath } from "@/lib/storage";
import { StatusForm } from "./StatusForm";
import { ConvertForm } from "./ConvertForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Enquiry · ${id}` };
}

const PATHWAY_LABELS: Record<string, string> = {
  new_construction: "New construction",
  retrofit: "Retrofit",
};

const RETROFIT_PATHWAY_LABELS: Record<string, string> = {
  owner_direct: "Owner, direct",
  contractor_instructed: "Contractor-instructed",
};

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

/** Renders structured line-item entry (jsonb, shape not schema-enforced) as a best-effort table/dump. */
function StructuredLineItems({ data }: { data: unknown }) {
  if (Array.isArray(data) && data.length > 0 && data.every((row) => typeof row === "object" && row !== null)) {
    const rows = data as Record<string, unknown>[];
    const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    return (
      <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-veridan-warm-gray-pale text-xs uppercase tracking-wide text-veridan-warm-gray">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-3 py-2 font-medium">
                  {col.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-veridan-warm-gray-light">
                {columns.map((col) => (
                  <td key={col} className="px-3 py-2 text-veridan-ink">
                    {row[col] == null ? "—" : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale px-3 py-2 text-xs text-veridan-ink">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default async function EnquiryDetailPage({
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
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Enquiry</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let enquiry: EnquiryRow | null = null;
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase
      .from("enquiries")
      .select("*")
      .eq("id", id)
      .maybeSingle<EnquiryRow>();
    if (error) loadError = error.message;
    else enquiry = data;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Enquiry</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The enquiry record couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  if (!enquiry) {
    notFound();
  }

  const [{ data: companiesData }, filesResult, linkedProjectResult] = await Promise.all([
    supabase.from("companies").select("*").order("name"),
    signEnquiryFileUrls(supabase, enquiry.uploaded_file_paths),
    enquiry.project_id
      ? supabase.from("projects").select("*").eq("id", enquiry.project_id).maybeSingle<ProjectRow>()
      : Promise.resolve({ data: null }),
  ]);

  const companies = (companiesData as CompanyRow[]) ?? [];
  const linkedProject = linkedProjectResult?.data ?? null;

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/enquiries"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← All enquiries
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">
        {enquiry.company_name || enquiry.contact_name}
      </h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        {PATHWAY_LABELS[enquiry.pathway] ?? enquiry.pathway} · Submitted{" "}
        {formatDateTime(enquiry.created_at)}
        {enquiry.honeypot_tripped && (
          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-600">
            Honeypot tripped
          </span>
        )}
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Submitted details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name" value={enquiry.contact_name} />
          <Field label="Contact email" value={enquiry.contact_email} />
          <Field label="Contact phone" value={enquiry.contact_phone} />
          <Field label="Company (as typed)" value={enquiry.company_name} />
          <Field label="Delivery timeframe" value={enquiry.delivery_timeframe} />
          {enquiry.pathway === "retrofit" && (
            <>
              <Field label="Building type" value={enquiry.building_type} />
              <Field
                label="Retrofit pathway"
                value={
                  enquiry.retrofit_pathway
                    ? RETROFIT_PATHWAY_LABELS[enquiry.retrofit_pathway] ?? enquiry.retrofit_pathway
                    : null
                }
              />
              <Field label="Urgent" value={enquiry.urgency_flag ? "Yes" : "No"} />
            </>
          )}
        </div>
        <div className="mt-4 space-y-4">
          <Field label="Project details" value={enquiry.project_details} />
          {enquiry.pathway === "retrofit" && (
            <Field label="Failing hardware description" value={enquiry.failing_hardware_description} />
          )}
        </div>

        {enquiry.line_items_structured != null && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
              Structured line items
            </p>
            <StructuredLineItems data={enquiry.line_items_structured} />
          </div>
        )}

        {filesResult.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
              Uploaded files
            </p>
            <ul className="space-y-1">
              {filesResult.map((f) => (
                <li key={f.path}>
                  {f.url ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
                    >
                      {fileNameFromPath(f.path)}
                    </a>
                  ) : (
                    <span className="text-sm text-veridan-warm-gray">
                      {fileNameFromPath(f.path)} (link unavailable — Storage may not be configured)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Status
        </h2>
        <StatusForm enquiryId={enquiry.id} status={enquiry.status} />
      </section>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          {enquiry.status === "converted" ? "Converted" : "Convert to project"}
        </h2>
        {enquiry.status === "converted" && linkedProject ? (
          <div>
            <p className="mt-2 text-sm text-veridan-warm-gray">
              This enquiry has been converted.
            </p>
            <Link
              href={`/admin/projects/${linkedProject.id}`}
              className="mt-2 inline-block text-sm font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
            >
              View {linkedProject.name} →
            </Link>
          </div>
        ) : enquiry.status === "converted" ? (
          <InstructiveMessage
            title="Linked project not found"
            body="This enquiry is marked converted but its project record couldn't be loaded. Check /admin/projects directly."
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-veridan-warm-gray">
              Pick an existing company or create a new one, then confirm the
              project details. This creates the project, marks the enquiry
              converted, and takes you to the new project.
            </p>
            <ConvertForm enquiry={enquiry} companies={companies} />
          </>
        )}
      </section>
    </div>
  );
}
