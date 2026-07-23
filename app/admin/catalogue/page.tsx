import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { CatalogueDocumentWithDetails } from "@/lib/supabase/types";
import { signCatalogueFileUrl } from "@/lib/storage";
import { distinctBrands, distinctCategories, filterCatalogueDocuments, hasAnyCatalogueFilter, parseCatalogueFilterParams } from "@/lib/catalogue/grouping";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { UploadForm } from "./UploadForm";
import { CatalogueListItem } from "./CatalogueListItem";

export const metadata = {
  title: "Catalogue",
};

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const filters = parseCatalogueFilterParams(params);

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Catalogue</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let allDocuments: CatalogueDocumentWithDetails[] | null = null;
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase
      .from("catalogue_documents")
      .select("*, suppliers(id, name), users(id, email, display_name)")
      .order("brand")
      .order("title");
    if (error) loadError = error.message;
    else allDocuments = data as unknown as CatalogueDocumentWithDetails[];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Catalogue</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The catalogue_documents table couldn't be loaded (${loadError}). Check that the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const documents = allDocuments ?? [];
  const brandOptions = distinctBrands(documents);
  const categoryOptions = distinctCategories(documents);
  const filtered = filterCatalogueDocuments(documents, filters);
  const hasFilters = hasAnyCatalogueFilter(filters);

  // Sign the file + thumbnail links for every visible row in parallel — a
  // founder's own authenticated session has full access to the private
  // catalogue-files bucket regardless of a row's visibility (this is the
  // ADMIN preview link, not the public §3.3 gated route — see
  // lib/storage.ts's signCatalogueFileUrl doc comment).
  const [downloadUrls, thumbnailUrls] = await Promise.all([
    Promise.all(filtered.map((d) => signCatalogueFileUrl(supabase, d.file_storage_path))),
    Promise.all(filtered.map((d) => signCatalogueFileUrl(supabase, d.thumbnail_storage_path))),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Catalogue</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Supplier catalogue and spec-sheet PDFs. Every upload defaults to <strong>Internal</strong> — a
        document is only reachable from the public site after a founder explicitly marks it Public,
        confirming Veridan is licensed to republish that supplier&apos;s material.
      </p>
      <p className="mt-1 text-sm text-veridan-warm-gray">
        <Link href="/catalogue" target="_blank" className="underline underline-offset-2 hover:text-veridan-ink">
          View the public catalogue page →
        </Link>
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Upload a document
        </h2>
        <UploadForm />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Filter
        </h2>
        <form method="get" className="grid gap-3 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="brand">
              Brand
            </label>
            <select id="brand" name="brand" defaultValue={filters.brand} className={`${inputClass} mt-1`}>
              <option value="">All brands</option>
              {brandOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="category">
              Category
            </label>
            <select id="category" name="category" defaultValue={filters.category} className={`${inputClass} mt-1`}>
              <option value="">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3">
            <button
              type="submit"
              className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
            >
              Apply
            </button>
            {hasFilters && (
              <Link
                href="/admin/catalogue"
                className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
              >
                Clear
              </Link>
            )}
          </div>
        </form>
      </section>

      <section className="mt-10">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
            {hasFilters ? "Matching documents" : "All documents"}
          </h2>
          <p className="text-xs text-veridan-warm-gray">{filtered.length} shown</p>
        </div>
        {filtered.length === 0 ? (
          <InstructiveMessage
            title={hasFilters ? "No documents match" : "No catalogue documents yet"}
            body={
              hasFilters
                ? "Try clearing a filter."
                : "Upload your first supplier catalogue or spec sheet above to get started."
            }
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {filtered.map((document, i) => (
              <CatalogueListItem
                key={document.id}
                document={document}
                downloadUrl={downloadUrls[i]}
                thumbnailUrl={thumbnailUrls[i]}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
