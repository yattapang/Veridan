import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_TYPES, type CompanyRow } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { CompanyForm } from "./CompanyForm";

export const metadata = {
  title: "Companies",
};

const TYPE_LABELS: Record<string, string> = {
  architect: "Architect",
  contractor: "Contractor",
  owner: "Owner",
  fm: "Facilities Management",
  supplier_contact: "Supplier contact",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const q = firstParam(params.q).trim();
  const type = firstParam(params.type).trim();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Companies</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let query = supabase.from("companies").select("*").order("name");
  if (q) {
    const safe = q.replace(/[,]/g, " ").trim();
    if (safe) query = query.ilike("name", `%${safe}%`);
  }
  if (type) query = query.eq("type", type);

  let data: CompanyRow[] | null = null;
  let loadError: string | null = null;

  try {
    const { data: rows, error } = await query;
    if (error) loadError = error.message;
    else data = rows as CompanyRow[];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Companies</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The companies table couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const companies = data ?? [];
  const hasFilters = Boolean(q || type);
  const inputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Companies</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Architects, contractors, owners, and FM companies. Open a company to
        manage its contacts and see order history.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Add a company
        </h2>
        <CompanyForm />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Search &amp; filter
        </h2>
        <form method="get" className="grid gap-3 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="q">
              Search by name
            </label>
            <input id="q" type="text" name="q" defaultValue={q} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="type">
              Type
            </label>
            <select id="type" name="type" defaultValue={type} className={`${inputClass} mt-1`}>
              <option value="">All types</option>
              {COMPANY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3 sm:col-span-3">
            <button
              type="submit"
              className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
            >
              Apply filters
            </button>
            {hasFilters && (
              <Link
                href="/admin/companies"
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
          {hasFilters ? "Matching companies" : "All companies"}
        </h2>
        {companies.length === 0 ? (
          <InstructiveMessage
            title={hasFilters ? "No companies match" : "No companies yet"}
            body={
              hasFilters
                ? "Try clearing a filter or a different search term."
                : "Add your first company above — enquiries and projects both link back to a company record."
            }
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {companies.map((c) => (
              <li key={c.id} className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
                <Link
                  href={`/admin/companies/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <p className="text-sm font-medium text-veridan-ink">{c.name}</p>
                    <p className="mt-1 text-xs text-veridan-warm-gray">
                      {TYPE_LABELS[c.type] ?? c.type}
                      {" · "}
                      {c.status === "established" ? "Established" : "New"}
                      {" · "}
                      {c.completed_order_count} completed order{c.completed_order_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-veridan-accent underline underline-offset-2">
                    View
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
