import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow, ContactRow, ProjectRow } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { CompanyForm } from "../CompanyForm";
import { ContactForm } from "./ContactForm";
import { ContactRow as ContactRowItem } from "./ContactRow";
import { CompanyQuoteForm } from "./CompanyQuoteForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Company · ${id}` };
}

export default async function CompanyDetailPage({
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
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Company</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let company: CompanyRow | null = null;
  let contacts: ContactRow[] = [];
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", id)
      .maybeSingle<CompanyRow>();
    if (error) {
      loadError = error.message;
    } else {
      company = data;
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Company</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The company record couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  if (!company) {
    notFound();
  }

  try {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("company_id", id)
      .order("is_primary", { ascending: false })
      .order("first_name");
    if (!error) contacts = (data as ContactRow[]) ?? [];
  } catch {
    // Best-effort: an empty contacts list is a reasonable fallback if this
    // query fails while the company record itself loaded fine.
  }

  let projects: ProjectRow[] = [];
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("company_id", id)
      .order("created_at", { ascending: false });
    if (!error) projects = (data as ProjectRow[]) ?? [];
  } catch {
    // Best-effort, same as contacts above.
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/companies"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← All companies
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">{company.name}</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        {company.completed_order_count} completed order{company.completed_order_count === 1 ? "" : "s"} ·
        deposit/status is a manual field (§7) — it never flips automatically.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Company details
        </h2>
        <CompanyForm company={company} />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Contacts
        </h2>
        {contacts.length === 0 ? (
          <InstructiveMessage
            title="No contacts yet"
            body="Add the first contact for this company below."
          />
        ) : (
          <ul className="mb-6 rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {contacts.map((contact) => (
              <ContactRowItem key={contact.id} companyId={company.id} contact={contact} />
            ))}
          </ul>
        )}

        <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Add a contact
          </h3>
          <ContactForm companyId={company.id} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Projects
        </h2>
        {projects.length === 0 ? (
          <p className="mb-6 text-sm text-veridan-warm-gray">No projects for this company yet.</p>
        ) : (
          <ul className="mb-6 rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 border-b border-veridan-warm-gray-light py-3 last:border-b-0">
                <Link
                  href={`/admin/projects/${p.id}`}
                  className="text-sm font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
                >
                  {p.name}
                </Link>
                <span className="text-xs text-veridan-warm-gray">
                  {p.project_type === "retrofit" ? "Retrofit" : "New construction"} · {p.status}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Start a retrofit quote
          </h3>
          <p className="mb-4 text-xs text-veridan-warm-gray">
            For a retrofit/simple job that doesn&apos;t warrant a full new-construction project. Full
            Door Register quotes are created from a project&apos;s page.
          </p>
          <CompanyQuoteForm companyId={company.id} companyName={company.name} />
        </div>
      </section>
    </div>
  );
}
