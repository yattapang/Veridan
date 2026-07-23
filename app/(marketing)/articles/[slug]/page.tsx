import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/Container";
import { ArticleJsonLd } from "@/components/ArticleJsonLd";
import { getPublishedArticleBySlug, getPublishedArticles, publicHeroImageUrl } from "@/lib/articles/publicLoader";
import { renderMarkdownToSafeHtml } from "@/lib/articles/markdown";

// Prerenders every currently-published slug at build time so /articles/[slug]
// is STATIC (○), not dynamic — the same cookie-free-read discipline as the
// rest of the marketing site (Phase 3A review MAJOR-1). A slug published
// AFTER a build still works via Next's default dynamicParams=true (rendered
// on first request, then cached); the publish action's revalidateTag calls
// keep both cases fresh.
export async function generateStaticParams() {
  const articles = await getPublishedArticles();
  return articles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article) return { title: "Article not found" };

  return {
    title: article.seo_title ?? article.title,
    description: article.seo_description ?? article.excerpt ?? undefined,
    alternates: { canonical: `/articles/${article.slug}` },
  };
}

export default async function ArticleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article) notFound();

  const heroUrl = publicHeroImageUrl(article.hero_image_path);
  // No ai_assisted disclosure is rendered anywhere on this page, by design
  // (founder decision 2026-07-23) — the field isn't even fetched by
  // getPublishedArticleBySlug (see lib/articles/publicLoader.ts).

  return (
    <>
      <ArticleJsonLd article={article} heroImageUrl={heroUrl} />

      <article className="py-16 sm:py-24">
        <Container className="max-w-3xl">
          <Link href="/articles" className="text-xs uppercase tracking-wide text-veridan-warm-gray hover:text-veridan-ink">
            ← All articles
          </Link>

          {article.category && (
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-veridan-accent-text">
              {article.category}
            </p>
          )}
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-veridan-ink sm:text-4xl">
            {article.title}
          </h1>
          {article.excerpt && (
            <p className="mt-4 text-lg leading-relaxed text-veridan-warm-gray">{article.excerpt}</p>
          )}
          {article.published_at && (
            <p className="mt-4 text-xs uppercase tracking-wide text-veridan-warm-gray">
              {new Date(article.published_at).toLocaleDateString("en-JM", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          )}

          {heroUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- public Storage-hosted image, per-article path not covered by a static remote-pattern config.
            <img
              src={heroUrl}
              alt=""
              className="mt-8 h-72 w-full rounded-md border border-veridan-warm-gray-light object-cover sm:h-96"
            />
          )}

          <div
            className="prose prose-veridan mt-10 max-w-none text-base leading-relaxed text-veridan-ink"
            // Safe: renderMarkdownToSafeHtml escapes all source text and only
            // reintroduces a fixed, known-safe tag set (lib/articles/markdown.ts) —
            // this is the same renderer used by the admin editor's preview.
            dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(article.body ?? "") }}
          />
        </Container>
      </article>
    </>
  );
}
