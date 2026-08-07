import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeTaxonomyUsageCounts, usageCountFor } from "@/lib/taxonomies/taxonomyAdmin";
import type { CompanyTypeRow, CompanyTypeWithUsageCount } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { CompanyTypeForm } from "./CompanyTypeForm";
import { CompanyTypeListItem } from "./CompanyTypeListItem";

export const metadata = {
  title: "Company Types",
};

export default async function CompanyTypesPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Company Types</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [typesResult, companiesResult] = await Promise.all([
    supabase.from("company_types").select("*").order("sort_order", { ascending: true }),
    supabase.from("companies").select("type"),
  ]);

  if (typesResult.error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Company Types</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The company_types table couldn't be loaded (${typesResult.error.message}). Check that the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const typeRows = (typesResult.data as CompanyTypeRow[] | null) ?? [];
  // companies.type has no FK to company_types (by design — see the
  // migration's header note), so usage counts are computed in JS from the
  // free-text values rather than a DB join/count.
  const usageCounts = computeTaxonomyUsageCounts(
    ((companiesResult.data as { type: string | null }[] | null) ?? []).map((c) => c.type)
  );
  const types: CompanyTypeWithUsageCount[] = typeRows.map((t) => ({
    ...t,
    usageCount: usageCountFor(t.name, usageCounts),
  }));

  return (
    <div className="max-w-3xl">
      <Link href="/admin/companies" className="text-xs text-veridan-warm-gray hover:text-veridan-ink">
        ← All companies
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-veridan-ink">Company Types</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        The options the company form&apos;s Type picker offers.{" "}
        <strong>This list does not constrain existing companies</strong> —{" "}
        <code className="mx-1 rounded bg-veridan-warm-gray-pale px-1 py-0.5 text-xs">companies.type</code>
        stays free text, so renaming or deleting a type here never changes what an already-saved
        company holds. Deleting only removes a type from future pickers.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Create a type
        </h2>
        <CompanyTypeForm />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          All types
        </h2>
        {types.length === 0 ? (
          <InstructiveMessage
            title="No types yet"
            body="Create your first company type above, e.g. &ldquo;Consultant&rdquo;."
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {types.map((t) => (
              <CompanyTypeListItem key={t.id} companyType={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
