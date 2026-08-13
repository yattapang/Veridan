import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow, QuoteWithProject } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import {
  QUOTE_STATUS_BADGE,
  QUOTE_STATUS_LABELS,
  formatJmd,
  formatUsd,
} from "@/lib/quotes/format";
import { isComputedExpired } from "@/lib/quotes/workflow";
import { requireAdminArea } from "@/lib/roles/guards";
import { NewQuoteForm, type QuoteProjectOption } from "./NewQuoteForm";

export const metadata = {
  title: "Quotes",
};

const MODE_LABELS: Record<string, string> = {
  door_register: "Door Register",
  line_item: "Line item",
};

export default async function QuotesPage() {
  // Staff may see quotes, but never the landed-cost column.
  const { showCosts } = await requireAdminArea("quotes");

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Quotes</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let quotes: QuoteWithProject[] = [];
  let loadError: string | null = null;
  try {
    const { data, error } = await supabase
      .from("quotes")
      // Disambiguated: projects has two FKs into companies (company_id and
      // architect_company_id) — PostgREST needs the explicit !constraint hint.
      .select("*, projects(id, name, companies!projects_company_id_fkey(id, name))")
      .order("created_at", { ascending: false });
    if (error) loadError = error.message;
    else quotes = (data as unknown as QuoteWithProject[]) ?? [];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Quotes</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The quotes table couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  // For the "New quote" form's company picker and its optional (never
  // required) existing-project attachment — see NewQuoteForm.tsx. Best-effort:
  // a failure here degrades the form (empty pickers) rather than the page.
  let companies: CompanyRow[] = [];
  let projectOptions: QuoteProjectOption[] = [];
  try {
    const [{ data: companyRows }, { data: projectRows }] = await Promise.all([
      supabase.from("companies").select("*").order("name"),
      supabase.from("projects").select("id, name, company_id").neq("status", "archived").order("name"),
    ]);
    companies = (companyRows as CompanyRow[]) ?? [];
    projectOptions = (projectRows as QuoteProjectOption[]) ?? [];
  } catch {
    // Non-fatal — see comment above.
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Quotes</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Every quote across all projects. Start one directly below for a client with no project yet,
        or create a Door Register quote from a project&apos;s page for a full new-construction job.
        Totals are the cached values from the last recompute.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          New quote
        </h2>
        <p className="mb-4 text-xs text-veridan-warm-gray">
          For a small order that isn&apos;t tied to a project: pick or create a company, optionally
          attach an existing project, and start a Line-item quote. You&apos;ll land in the builder to
          add lines.
        </p>
        <NewQuoteForm companies={companies} projects={projectOptions} />
      </section>

      <section className="mt-10">
        {quotes.length === 0 ? (
          <InstructiveMessage
            title="No quotes yet"
            body="Use “New quote” above for a client with no project (optionally attaching an existing one), or open a project with doors and hardware sets assigned and use 'Create quote (Door Register mode)' for a full new-construction job."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[780px] table-auto border-collapse text-left">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">Ref</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Client</th>
                  {showCosts && <th className="px-3 py-2 text-right">Landed USD</th>}
                  <th className="px-3 py-2 text-right">Client JMD</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id} className="border-b border-veridan-warm-gray-light last:border-b-0">
                    <td className="px-3 py-2 text-sm font-medium">
                      <Link
                        href={`/admin/quotes/${quote.id}`}
                        className="text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
                      >
                        {quote.quote_ref}
                      </Link>
                      {quote.revision_number > 1 && (
                        <span className="ml-1 text-xs text-veridan-warm-gray">rev {quote.revision_number}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${QUOTE_STATUS_BADGE[quote.status]}`}
                      >
                        {QUOTE_STATUS_LABELS[quote.status]}
                      </span>
                      {isComputedExpired(quote.status, quote.quote_date, quote.validity_days) && (
                        <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                          Past valid-until
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-veridan-warm-gray">
                      {MODE_LABELS[quote.quote_mode] ?? quote.quote_mode}
                    </td>
                    <td className="px-3 py-2 text-sm text-veridan-ink">
                      {quote.projects ? (
                        <Link
                          href={`/admin/projects/${quote.projects.id}`}
                          className="underline underline-offset-2 hover:text-veridan-accent"
                        >
                          {quote.projects.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-veridan-warm-gray">
                      {quote.projects?.companies?.name ?? "—"}
                    </td>
                    {showCosts && (
                      <td className="px-3 py-2 text-right text-sm text-veridan-ink">
                        {formatUsd(quote.total_landed_usd)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right text-sm font-medium text-veridan-ink">
                      {formatJmd(quote.total_client_jmd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
