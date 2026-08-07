import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeTaxonomyUsageCounts, usageCountFor } from "@/lib/taxonomies/taxonomyAdmin";
import type { ProductCategoryAdminRow, ProductCategoryAdminWithUsageCount } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { ProductCategoryForm } from "./ProductCategoryForm";
import { ProductCategoryListItem } from "./ProductCategoryListItem";

export const metadata = {
  title: "Product Categories",
};

export default async function ProductCategoriesPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Product Categories</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [categoriesResult, productsResult] = await Promise.all([
    supabase.from("product_categories_admin").select("*").order("sort_order", { ascending: true }),
    supabase.from("products").select("generic_category"),
  ]);

  if (categoriesResult.error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Product Categories</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The product_categories_admin table couldn't be loaded (${categoriesResult.error.message}). Check that the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const categoryRows = (categoriesResult.data as ProductCategoryAdminRow[] | null) ?? [];
  // products.generic_category has no FK to product_categories_admin (by
  // design — see the migration's header note), so usage counts are
  // computed in JS from the free-text values rather than a DB join/count.
  const usageCounts = computeTaxonomyUsageCounts(
    ((productsResult.data as { generic_category: string | null }[] | null) ?? []).map(
      (p) => p.generic_category
    )
  );
  const categories: ProductCategoryAdminWithUsageCount[] = categoryRows.map((c) => ({
    ...c,
    usageCount: usageCountFor(c.name, usageCounts),
  }));

  return (
    <div className="max-w-3xl">
      <Link href="/admin/products" className="text-xs text-veridan-warm-gray hover:text-veridan-ink">
        ← All products
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-veridan-ink">Product Categories</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        The options the Hardware Library product form&apos;s Category picker offers.{" "}
        <strong>This list does not constrain existing products</strong> —{" "}
        <code className="mx-1 rounded bg-veridan-warm-gray-pale px-1 py-0.5 text-xs">
          products.generic_category
        </code>
        stays free text, so renaming or deleting a category here never changes what an already-saved
        product holds. Deleting only removes a category from future pickers. This is separate from
        the marketing &ldquo;Product Categories&rdquo; site-content section.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Create a category
        </h2>
        <ProductCategoryForm />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          All categories
        </h2>
        {categories.length === 0 ? (
          <InstructiveMessage
            title="No categories yet"
            body="Create your first category above, e.g. &ldquo;Door bottoms&rdquo;."
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {categories.map((c) => (
              <ProductCategoryListItem key={c.id} category={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
