import { siteMeta } from "@/lib/site-content";
import type { PublicArticle } from "@/lib/articles/publicLoader";

/**
 * Article/BlogPosting structured data (Plan §2.5), mirroring
 * LocalBusinessJsonLd.tsx's dangerouslySetInnerHTML pattern. Fed by
 * seo_title/seo_description/hero_image_path with the same fallback rule the
 * page's own <head> metadata uses (seo_title -> title, seo_description ->
 * excerpt). Deliberately does NOT include any AI-assisted disclosure field —
 * founder decision 2026-07-23: ai_assisted is never surfaced publicly, in
 * JSON-LD or anywhere else on this page.
 */
export function ArticleJsonLd({
  article,
  heroImageUrl,
}: {
  article: PublicArticle;
  heroImageUrl: string | null;
}) {
  const url = `${siteMeta.siteUrl}/articles/${article.slug}`;
  const headline = article.seo_title ?? article.title;
  const description = article.seo_description ?? article.excerpt ?? undefined;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: article.published_at ?? article.created_at,
    dateModified: article.published_at ?? article.created_at,
    author: { "@type": "Organization", name: siteMeta.legalName },
    publisher: { "@type": "Organization", name: siteMeta.legalName },
  };
  if (description) jsonLd.description = description;
  if (heroImageUrl) jsonLd.image = [heroImageUrl];
  if (article.category) jsonLd.articleSection = article.category;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
