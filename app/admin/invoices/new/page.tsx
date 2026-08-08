import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import type { CompanyRow } from "@/lib/supabase/types";
import { NewInvoiceForm } from "./NewInvoiceForm";

export const metadata = {
  title: "New invoice",
};

export interface ProjectOption {
  id: string;
  name: string;
  company_id: string;
}

export default async function NewInvoicePage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">New invoice</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [companiesResult, projectsResult] = await Promise.all([
    supabase.from("companies").select("*").order("name"),
    supabase.from("projects").select("id, name, company_id").order("name"),
  ]);

  const loadError = companiesResult.error?.message ?? projectsResult.error?.message ?? null;
  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">New invoice</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`Companies/projects couldn't be loaded (${loadError}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }

  const companies = (companiesResult.data as CompanyRow[]) ?? [];
  const projects = (projectsResult.data as ProjectOption[]) ?? [];

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/invoices"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← All invoices
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">New standalone invoice</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Builds an invoice from scratch, with no source quote — pick a company, optionally link a
        project, and add free-text line items. GCT applies the same way it does on a quote-derived
        invoice, and it shares the same VI-YYYY-NNN numbering sequence.
      </p>

      <section className="mt-8">
        {companies.length === 0 ? (
          <InstructiveMessage
            title="No companies yet"
            body="Add a company under Admin → Companies before creating a standalone invoice."
          />
        ) : (
          <NewInvoiceForm companies={companies} projects={projects} />
        )}
      </section>
    </div>
  );
}
