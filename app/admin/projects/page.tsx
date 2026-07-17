import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_STATUSES, type CompanyRow, type ProjectWithCompany } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { ProjectForm } from "./ProjectForm";

export const metadata = {
  title: "Projects",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  closed: "Closed",
  archived: "Archived",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function ProjectsPage({
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
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Projects</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let companies: CompanyRow[] = [];
  let companiesError: string | null = null;
  try {
    const { data, error } = await supabase.from("companies").select("*").order("name");
    if (error) companiesError = error.message;
    else companies = (data as CompanyRow[]) ?? [];
  } catch (err) {
    companiesError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  let query = supabase
    .from("projects")
    // Disambiguated: projects has two FKs into companies (company_id and
    // architect_company_id) — PostgREST needs the explicit !constraint hint.
    .select("*, companies!projects_company_id_fkey(id, name)")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  let data: ProjectWithCompany[] | null = null;
  let loadError: string | null = null;

  try {
    const { data: rows, error } = await query;
    if (error) loadError = error.message;
    else data = rows as unknown as ProjectWithCompany[];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Projects</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The projects table couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const projects = data ?? [];
  const inputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Projects</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Each project holds its hardware sets, door register, and quotes.
        Most projects arrive via enquiry conversion — use the form below for
        the rest.
      </p>

      {companiesError && (
        <div className="mt-4">
          <InstructiveMessage
            title="Company list unavailable"
            body={`Couldn't load companies for the form (${companiesError}). You can still browse projects.`}
          />
        </div>
      )}

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Add a project
        </h2>
        <ProjectForm companies={companies} />
      </section>

      <section className="mt-10">
        <form method="get" className="grid gap-3 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status} className={`${inputClass} mt-1`}>
              <option value="">All statuses</option>
              {PROJECT_STATUSES.map((s) => (
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
                href="/admin/projects"
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
          {status ? `${STATUS_LABELS[status] ?? status} projects` : "All projects"}
        </h2>
        {projects.length === 0 ? (
          <InstructiveMessage
            title={status ? "No projects match" : "No projects yet"}
            body={
              status
                ? "Try a different status filter."
                : "Convert an enquiry, or add a project above, to get started."
            }
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {projects.map((p) => (
              <li key={p.id} className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
                <Link href={`/admin/projects/${p.id}`} className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-veridan-ink">{p.name}</p>
                    <p className="mt-1 text-xs text-veridan-warm-gray">
                      {p.companies?.name ?? "Unknown company"} · Created {formatDate(p.created_at)}
                    </p>
                  </div>
                  <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-ink">
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
