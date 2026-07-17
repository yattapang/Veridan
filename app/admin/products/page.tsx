import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  GRADE_VALUES,
  PRODUCT_CATEGORIES,
  type ItemGroupRow,
  type ProductWithSupplier,
  type SupplierRow,
} from "@/lib/supabase/types";
import { hasAnyFilter, parseProductFilterParams } from "@/lib/item-groups";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { ProductForm } from "./ProductForm";
import { ProductListItem } from "./ProductListItem";

export const metadata = {
  title: "Products",
};

const CATEGORY_LABELS: Record<string, string> = {
  locksets: "Locksets",
  closers: "Closers",
  hinges: "Hinges",
  exit_devices: "Exit devices",
  access_control: "Access control",
  ironmongery: "Ironmongery",
  signage: "Signage",
  frames: "Frames",
  other: "Other",
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

  let suppliers: SupplierRow[] = [];
  let suppliersError: string | null = null;
  try {
    const { data, error } = await supabase.from("suppliers").select("*").order("name");
    if (error) suppliersError = error.message;
    else suppliers = (data as SupplierRow[]) ?? [];
  } catch (err) {
    suppliersError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
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

  // Grade lives on item_groups, not products, so filtering by grade means
  // first resolving which item_groups match, then constraining products to
  // that set of ids (combinable with an explicit item_group_id filter too —
  // both just AND together below).
  let gradeGroupIds: string[] | null = null;
  if (grade) {
    const { data } = await supabase.from("item_groups").select("id").eq("grade", grade);
    gradeGroupIds = (data ?? []).map((r) => r.id as string);
  }

  let query = supabase
    .from("products")
    .select("*, suppliers(id, name), item_groups(id, family_name, grade)")
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

  let data: ProductWithSupplier[] | null = null;
  let loadError: string | null = null;

  try {
    const { data: rows, error } = await query;
    if (error) loadError = error.message;
    else data = rows as unknown as ProductWithSupplier[];
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

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Add a product
        </h2>
        <ProductForm suppliers={suppliers} itemGroups={itemGroups} />
      </section>

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
            <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="category">
              Category
            </label>
            <select id="category" name="category" defaultValue={category} className={`${inputClass} mt-1`}>
              <option value="">All categories</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c] ?? c}
                </option>
              ))}
            </select>
          </div>
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
              Finish code
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
            {products.map((product) => (
              <ProductListItem key={product.id} product={product} suppliers={suppliers} itemGroups={itemGroups} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
