import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeCategoryUsageCounts, usageCountFor } from "@/lib/articles/categoryAdmin";
import type { ArticleCategoryRow, ArticleCategoryWithUsageCount } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { CategoryForm } from "./CategoryForm";
import { CategoryListItem } from "./CategoryListItem";

export const metadata = {
  title: "Article Categories",
};

export default async function ArticleCategoriesPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Article Categories</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [categoriesResult, articlesResult] = await Promise.all([
    supabase.from("article_categories").select("*").order("sort_order", { ascending: true }),
    supabase.from("articles").select("category"),
  ]);

  if (categoriesResult.error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Article Categories</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The article_categories table couldn't be loaded (${categoriesResult.error.message}). Check that the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const categoryRows = (categoriesResult.data as ArticleCategoryRow[] | null) ?? [];
  // articles.category has no FK to article_categories (by design — see the
  // migration's CRITICAL DESIGN CONSTRAINT note), so usage counts are
  // computed in JS from the free-text values rather than a DB join/count.
  const usageCounts = computeCategoryUsageCounts(
    (articlesResult.data as { category: string | null }[] | null) ?? []
  );
  const categories: ArticleCategoryWithUsageCount[] = categoryRows.map((c) => ({
    ...c,
    usageCount: usageCountFor(c.name, usageCounts),
  }));

  return (
    <div className="max-w-3xl">
      <Link href="/admin/articles" className="text-xs text-veridan-warm-gray hover:text-veridan-ink">
        ← All articles
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-veridan-ink">Article Categories</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        The suggestion list the article editor&apos;s category picker offers (founder decision
        2026-08-06). <strong>This list does not constrain existing articles</strong> —
        <code className="mx-1 rounded bg-veridan-warm-gray-pale px-1 py-0.5 text-xs">articles.category</code>
        stays free text, so renaming or deleting a category here never changes what an already-saved
        article displays. Deleting only removes a category from future pickers.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Create a category
        </h2>
        <CategoryForm />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          All categories
        </h2>
        {categories.length === 0 ? (
          <InstructiveMessage
            title="No categories yet"
            body="Create your first category above, e.g. &ldquo;Product Spotlights&rdquo;."
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {categories.map((c, index) => (
              <CategoryListItem
                key={c.id}
                category={c}
                isFirst={index === 0}
                isLast={index === categories.length - 1}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
