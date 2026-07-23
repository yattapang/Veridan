import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { getPublishedArticles, publicHeroImageUrl, type PublicArticle } from "@/lib/articles/publicLoader";
import { markdownToPlainText } from "@/lib/articles/markdown";
import { ArticleGrid, type ArticleListItem } from "./ArticleGrid";
import { ArticleListClient } from "./ArticleListClient";

export const metadata: Metadata = {
  title: "Articles",
  description:
    "Specification guidance, product spotlights, and project stories from Veridan Limited — Jamaica's premium commercial hardware specialist.",
  alternates: { canonical: "/articles" },
};

function excerptFor(article: PublicArticle): string {
  if (article.excerpt) return article.excerpt;
  if (article.body) return markdownToPlainText(article.body).slice(0, 200);
  return "";
}

// No `searchParams` prop here on purpose — reading it would force this
// route to render per-request (a Next.js dynamic API). The category filter
// instead lives in ArticleListClient via useSearchParams() inside the
// Suspense boundary below, so this page stays statically prerenderable
// (Plan §2.5 / the cookie-free-read discipline from the Phase 3A review).
// The Suspense fallback is the unfiltered grid (ArticleGrid, no hooks) —
// what a static prerender bakes in and what most visitors (no ?category=)
// see immediately; a category-filtered view hydrates in client-side.
export default async function ArticlesListPage() {
  const articles = await getPublishedArticles();
  const items: ArticleListItem[] = articles.map((article) => ({
    article,
    heroUrl: publicHeroImageUrl(article.hero_image_path),
    excerpt: excerptFor(article),
  }));
  const allCategories = Array.from(
    new Set(articles.map((a) => a.category).filter((c): c is string => Boolean(c)))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <>
      <PageHero
        kicker="Veridan Articles"
        title="Specification guidance, product spotlights, and project stories."
        lead="Practical reading for architects, contractors, and building owners specifying commercial hardware in Jamaica."
      />

      <section className="py-16 sm:py-24">
        <Container>
          <Suspense fallback={<ArticleGrid items={items} allCategories={allCategories} activeCategory={null} />}>
            <ArticleListClient items={items} />
          </Suspense>
        </Container>
      </section>
    </>
  );
}
