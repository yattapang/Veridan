import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  GRADE_VALUES,
  type ItemGroupRow,
  type ProductWithSupplier,
  type SupplierRow,
} from "@/lib/supabase/types";
import { hasAnyFilter, parseProductFilterParams } from "@/lib/item-groups";
import { getManagedProductCategories } from "@/lib/products/categoriesLoader";
import { collectDistinctFinishValues } from "@/lib/products/finishes";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { signPriceFileUrl, fileNameFromPath } from "@/lib/storage";
import { ProductForm } from "./ProductForm";
import { ProductListItem } from "./ProductListItem";
import {
  STAFF_PRODUCT_COLUMNS,
  toProductListItemView,
  type ProductListSourceRow,
  type ProductPriceProvenance,
} from "./productView";
import { requireAdminArea } from "@/lib/roles/guards";

export const metadata = {
  title: "Products",
};

// Sensible cap so this stays a single server-rendered list without a
// pagination component — the Hardware Library isn't expected to grow into
// the many-thousands in Phase 1. Search/filter narrows results long before
// this becomes limiting.
const RESULT_LIMIT = 300;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Staff may browse the Hardware Library — descriptions, manufacturers,
  // catalogue refs, finishes — but never unit costs, and never the create/edit
  // forms, which are cost entry. The matching actions re-check the role.
  const { showCosts } = await requireAdminArea("products");

  const params = await searchParams;
  const { q, category, manufacturer, supplierId, itemGroupId, grade, finishCode } =
    parseProductFilterParams(params);

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Products</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  // `public.suppliers` is founder-only at the database (20260807000004 §6b) and
  // the supplier list is only ever needed by the founder-only add/edit form and
  // the supplier filter that goes with it. A staff session does not query it at
  // all: not to "hide" it, but so there is no supplier data on this server render
  // that could be forwarded into a client component's props by a later edit.
  let suppliers: SupplierRow[] = [];
  let suppliersError: string | null = null;
  if (showCosts) {
    try {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) suppliersError = error.message;
      else suppliers = (data as SupplierRow[]) ?? [];
    } catch (err) {
      suppliersError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
    }
  }

  let itemGroups: ItemGroupRow[] = [];
  let itemGroupsError: string | null = null;
  try {
    const { data, error } = await supabase.from("item_groups").select("*").order("family_name");
    if (error) itemGroupsError = error.message;
    else itemGroups = (data as ItemGroupRow[]) ?? [];
  } catch (err) {
    itemGroupsError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  const productCategories = await getManagedProductCategories(supabase);

  // Distinct finish values for the product form's datalist type-aheads
  // (founder feedback 2026-08-07). Deliberately a separate, unfiltered
  // query over the whole table (not RESULT_LIMIT/search-scoped) so the
  // type-ahead always reflects every finish value ever entered, not just
  // what's currently on screen — see lib/products/finishes.ts.
  // Only the founder-only ProductForm consumes this, so a staff session skips
  // the round-trip entirely.
  let distinctFinishes = collectDistinctFinishValues([]);
  if (showCosts) {
    try {
      const { data } = await supabase
        .from("products")
        .select("specified_finish, supplied_finish, finish_code");
      distinctFinishes = collectDistinctFinishValues(
        (data as { specified_finish: string | null; supplied_finish: string | null; finish_code: string | null }[] | null) ?? []
      );
    } catch {
      // Best-effort — an empty type-ahead is a reasonable fallback if this
      // query fails while the main product list load below succeeds.
    }
  }

  // Grade lives on item_groups, not products, so filtering by grade means
  // first resolving which item_groups match, then constraining products to
  // that set of ids (combinable with an explicit item_group_id filter too —
  // both just AND together below).
  let gradeGroupIds: string[] | null = null;
  if (grade) {
    const { data } = await supabase.from("item_groups").select("id").eq("grade", grade);
    gradeGroupIds = (data ?? []).map((r) => r.id as string);
  }

  // Two column lists, chosen by role. A staff session never SELECTs unit_cost /
  // cost_currency and never embeds the founder-only suppliers table, so the cost
  // columns are absent from this request's result set entirely — there is no
  // server-side copy of them on this page to leak into an RSC payload.
  let query = supabase
    .from("products")
    .select(
      showCosts
        ? "*, suppliers(id, name), item_groups(id, family_name, grade)"
        : STAFF_PRODUCT_COLUMNS
    )
    .order("description")
    .limit(RESULT_LIMIT);

  if (q) {
    // Commas are the `.or()` condition separator — strip them out of the
    // user's search text rather than trying to escape them.
    const safe = q.replace(/[,]/g, " ").trim();
    if (safe) {
      query = query.or(
        `description.ilike.%${safe}%,catalogue_ref.ilike.%${safe}%,manufacturer.ilike.%${safe}%,product_ref.ilike.%${safe}%`
      );
    }
  }
  if (category) query = query.eq("generic_category", category);
  if (manufacturer) query = query.ilike("manufacturer", `%${manufacturer.replace(/[,%]/g, " ").trim()}%`);
  if (supplierId) query = query.eq("supplier_id", supplierId);
  if (finishCode) query = query.eq("finish_code", finishCode);
  if (itemGroupId) {
    query = query.eq("item_group_id", itemGroupId);
  } else if (gradeGroupIds) {
    // No sentinel-id hack needed — an empty `.in()` list is valid and
    // simply matches nothing, which is correct when no group has that grade.
    query = query.in("item_group_id", gradeGroupIds);
  }

  // Typed as the NARROW shape for everyone: the founder query is a superset, so
  // this is sound, and it means the list-rendering code below cannot reach for a
  // cost column even when one happens to have been fetched.
  let data: ProductListSourceRow[] | null = null;
  let loadError: string | null = null;

  try {
    const { data: rows, error } = await query;
    if (error) loadError = error.message;
    else data = rows as unknown as ProductListSourceRow[];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Products</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The products table couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const products = data ?? [];

  // The full rows, kept SERVER-SIDE only and only for a founder — they are the
  // inline edit form's input. `fullRowById` is empty for a staff session, so the
  // `costs` prop below is null and nothing cost-shaped exists to serialise.
  const fullRowById = new Map<string, ProductWithSupplier>(
    showCosts
      ? (products as unknown as ProductWithSupplier[]).map((p) => [p.id, p] as const)
      : []
  );

  // Task 40 provenance surfacing: "last updated <date> from <source file>"
  // for products whose current price came from a scanned upload. Most-recent
  // product_price_history row per product, with its source file's signed
  // download link (best-effort — history still shows without a link if
  // signing fails, e.g. Storage not configured).
  //
  // Founder-only: `product_price_history` is the historical supplier cost book
  // and is founder-only at the database from 20260807000004 §6b, and the signed
  // link points into the founder-only `price-files` bucket. Skipped outright for
  // staff rather than fetched-then-not-rendered.
  const priceProvenanceById = new Map<string, ProductPriceProvenance>();
  if (showCosts && products.length > 0) {
    const { data: historyRows } = await supabase
      .from("product_price_history")
      .select("product_id, effective_date, price_file_uploads(original_filename, file_storage_path)")
      .in(
        "product_id",
        products.map((p) => p.id)
      )
      .not("price_file_upload_id", "is", null)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false });

    // First pass: keep only the most recent history row per product, then
    // sign all the file URLs in parallel (NIT-2) — sequential awaits here
    // were one Storage round-trip per product.
    const latestByProduct = new Map<
      string,
      { effectiveDate: string; fileName: string; storagePath: string }
    >();
    for (const row of (historyRows as unknown as Array<{
      product_id: string;
      effective_date: string;
      price_file_uploads: { original_filename: string | null; file_storage_path: string } | null;
    }>) ?? []) {
      if (latestByProduct.has(row.product_id) || !row.price_file_uploads) continue;
      latestByProduct.set(row.product_id, {
        effectiveDate: row.effective_date,
        fileName: row.price_file_uploads.original_filename ?? fileNameFromPath(row.price_file_uploads.file_storage_path),
        storagePath: row.price_file_uploads.file_storage_path,
      });
    }
    const entries = [...latestByProduct.entries()];
    const fileUrls = await Promise.all(
      entries.map(([, entry]) => signPriceFileUrl(supabase, entry.storagePath))
    );
    entries.forEach(([productId, entry], i) => {
      priceProvenanceById.set(productId, {
        effectiveDate: entry.effectiveDate,
        fileName: entry.fileName,
        fileUrl: fileUrls[i],
      });
    });
  }

  const hasFilters = hasAnyFilter({ q, category, manufacturer, supplierId, itemGroupId, grade, finishCode });
  const inputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Hardware Library</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        The global, reusable product library (PRD §6.1). Per-quote overrides
        never rewrite these rows — editing a product here doesn&apos;t change
        the numbers on a past quote.
      </p>

      {suppliersError && (
        <div className="mt-4">
          <InstructiveMessage
            title="Supplier list unavailable"
            body={`Couldn't load suppliers for the form/filter (${suppliersError}). You can still browse products.`}
          />
        </div>
      )}
      {itemGroupsError && (
        <div className="mt-4">
          <InstructiveMessage
            title="Item group list unavailable"
            body={`Couldn't load item groups for the form/filter (${itemGroupsError}). You can still browse products.`}
          />
        </div>
      )}

      {showCosts && (
        <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Add a product
          </h2>
          <ProductForm
            suppliers={suppliers}
            itemGroups={itemGroups}
            productCategories={productCategories}
            distinctFinishes={distinctFinishes}
          />
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Search &amp; filter
        </h2>
        <form method="get" className="grid gap-3 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="q">
              Search
            </label>
            <input
              id="q"
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Description, catalogue ref, manufacturer, SKU…"
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="category">
                Category
              </label>
              <Link
                href="/admin/products/categories"
                className="text-[11px] font-medium text-veridan-accent-text underline underline-offset-2 hover:text-veridan-ink"
              >
                Manage categories
              </Link>
            </div>
            <select id="category" name="category" defaultValue={category} className={`${inputClass} mt-1`}>
              <option value="">All categories</option>
              {productCategories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {/* Supplier is a founder-only dimension (the suppliers table is
              founder-only at the DB), so staff get no supplier filter rather
              than an empty dropdown that silently matches nothing. */}
          {showCosts && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="supplier_id">
                Supplier
              </label>
              <select id="supplier_id" name="supplier_id" defaultValue={supplierId} className={`${inputClass} mt-1`}>
                <option value="">All suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="manufacturer">
              Manufacturer
            </label>
            <input
              id="manufacturer"
              type="text"
              name="manufacturer"
              defaultValue={manufacturer}
              placeholder="Assa Abloy…"
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="item_group_id">
              Family (item group)
            </label>
            <select id="item_group_id" name="item_group_id" defaultValue={itemGroupId} className={`${inputClass} mt-1`}>
              <option value="">All families</option>
              {itemGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.family_name}
                  {g.grade ? ` (${g.grade})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="grade">
              Grade
            </label>
            <select id="grade" name="grade" defaultValue={grade} className={`${inputClass} mt-1`}>
              <option value="">All grades</option>
              {GRADE_VALUES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="finish_code">
              Supplied finish code
            </label>
            <input
              id="finish_code"
              type="text"
              name="finish_code"
              defaultValue={finishCode}
              placeholder="US32D…"
              className={`${inputClass} mt-1`}
            />
          </div>
          <div className="flex items-end gap-3 sm:col-span-4">
            <button
              type="submit"
              className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
            >
              Apply filters
            </button>
            {hasFilters && (
              <Link
                href="/admin/products"
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
            {hasFilters ? "Matching products" : "All products"}
          </h2>
          <p className="text-xs text-veridan-warm-gray">
            {products.length}
            {products.length === RESULT_LIMIT ? "+" : ""} shown
          </p>
        </div>
        {products.length === 0 ? (
          <InstructiveMessage
            title={hasFilters ? "No products match" : "No products yet"}
            body={
              hasFilters
                ? "Try clearing a filter or broadening the search text."
                : "Add your first product above to start building the Hardware Library."
            }
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {products.map((product) => {
              const fullRow = fullRowById.get(product.id);
              return (
                <ProductListItem
                  key={product.id}
                  product={toProductListItemView(product)}
                  costs={
                    fullRow
                      ? {
                          row: fullRow,
                          unitCost: fullRow.unit_cost,
                          costCurrency: fullRow.cost_currency,
                          suppliers,
                          itemGroups,
                          productCategories,
                          distinctFinishes,
                          priceProvenance: priceProvenanceById.get(product.id) ?? null,
                        }
                      : null
                  }
                />
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
