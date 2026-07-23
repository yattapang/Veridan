import Link from "next/link";
import type { PublicArticle } from "@/lib/articles/publicLoader";

export interface ArticleListItem {
  article: PublicArticle;
  heroUrl: string | null;
  excerpt: string;
}

/**
 * Pure presentational grid + category-chip bar — no hooks, so it can be used
 * both as ArticleListClient's post-hydration render AND as the Suspense
 * fallback shown during static prerendering (see page.tsx / ArticleListClient.tsx).
 */
export function ArticleGrid({
  items,
  allCategories,
  activeCategory,
}: {
  items: ArticleListItem[];
  allCategories: string[];
  activeCategory: string | null;
}) {
  return (
    <>
      {allCategories.length > 0 && (
        <div className="mb-10 flex flex-wrap gap-2">
          <Link
            href="/articles"
            className={`rounded-full border px-4 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors duration-150 ${
              !activeCategory
                ? "border-veridan-ink bg-veridan-ink text-veridan-paper"
                : "border-veridan-warm-gray-light text-veridan-warm-gray hover:border-veridan-ink hover:text-veridan-ink"
            }`}
          >
            All
          </Link>
          {allCategories.map((c) => (
            <Link
              key={c}
              href={`/articles?category=${encodeURIComponent(c)}`}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors duration-150 ${
                activeCategory === c
                  ? "border-veridan-ink bg-veridan-ink text-veridan-paper"
                  : "border-veridan-warm-gray-light text-veridan-warm-gray hover:border-veridan-ink hover:text-veridan-ink"
              }`}
            >
              {c}
            </Link>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-veridan-warm-gray">
          {activeCategory ? "No articles in this category yet." : "No articles published yet — check back soon."}
        </p>
      ) : (
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ article, heroUrl, excerpt }) => (
            <article key={article.id} className="flex flex-col">
              <Link href={`/articles/${article.slug}`} className="block">
                {heroUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- public Storage-hosted image, per-article path not covered by a static remote-pattern config.
                  <img
                    src={heroUrl}
                    alt=""
                    className="mb-4 h-44 w-full rounded-md border border-veridan-warm-gray-light object-cover"
                  />
                ) : (
                  <div className="mb-4 h-44 w-full rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale" />
                )}
              </Link>
              {article.category && (
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-veridan-accent-text">
                  {article.category}
                </p>
              )}
              <h2 className="text-lg font-semibold text-veridan-ink">
                <Link href={`/articles/${article.slug}`} className="hover:text-veridan-accent-text">
                  {article.title}
                </Link>
              </h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-veridan-warm-gray">{excerpt}</p>
              <Link
                href={`/articles/${article.slug}`}
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-veridan-accent-text hover:text-veridan-ink"
              >
                Read more →
              </Link>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
