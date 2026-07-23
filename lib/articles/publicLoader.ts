import "server-only";

import { unstable_cache } from "next/cache";
// Cookie-FREE anon client on purpose — same reasoning as
// lib/site-content-db/loader.ts (Phase 3A review MAJOR-1): a cookie-bound
// client forces the whole route to render dynamically. Published articles
// are public and identical for every visitor, so this keeps /articles and
// /articles/[slug] statically prerenderable while unstable_cache +
// revalidateTag (called from the publish/edit actions) handle freshness.
import { createPublicContentClient } from "@/lib/supabase/publicClient";
import type { ArticleRow } from "@/lib/supabase/types";

/**
 * The subset of columns the public pages ever need. Deliberately excludes
 * `ai_assisted` from being rendered anywhere downstream (it IS selected,
 * since RLS already restricts the row to `status = 'published'` and the
 * column itself carries no sensitive data — but no component may ever print
 * it; see Plan founder decision 2026-07-23 and the Phase 3B non-goals).
 */
export type PublicArticle = Pick<
  ArticleRow,
  | "id"
  | "title"
  | "slug"
  | "body"
  | "excerpt"
  | "category"
  | "hero_image_path"
  | "seo_title"
  | "seo_description"
  | "published_at"
  | "created_at"
>;

const PUBLIC_ARTICLE_COLUMNS =
  "id, title, slug, body, excerpt, category, hero_image_path, seo_title, seo_description, published_at, created_at";

/**
 * Published articles, newest first. Tagged `articles:list` — the publish
 * action (and any edit to an already-published article) calls
 * `revalidateTag('articles:list')` on success.
 */
export async function getPublishedArticles(): Promise<PublicArticle[]> {
  let supabase;
  try {
    supabase = createPublicContentClient();
  } catch {
    return [];
  }

  const cached = unstable_cache(
    async () => {
      const { data, error } = await supabase
        .from("articles")
        .select(PUBLIC_ARTICLE_COLUMNS)
        .eq("status", "published")
        .order("published_at", { ascending: false });
      if (error || !data) return [];
      return data as PublicArticle[];
    },
    ["articles", "list"],
    { tags: ["articles:list"], revalidate: 3600 }
  );

  return cached();
}

/**
 * A single published article by slug, or null if it doesn't exist / isn't
 * published. Relies on `articles_anon_select_published` (RLS) as the actual
 * enforcement — a draft/review article's slug simply returns no row here,
 * the same guarantee UAT §6.2 item 7 exercises directly against the
 * database. Tagged `articles:<slug>`.
 */
export async function getPublishedArticleBySlug(slug: string): Promise<PublicArticle | null> {
  let supabase;
  try {
    supabase = createPublicContentClient();
  } catch {
    return null;
  }

  const cached = unstable_cache(
    async () => {
      const { data, error } = await supabase
        .from("articles")
        .select(PUBLIC_ARTICLE_COLUMNS)
        .eq("status", "published")
        .eq("slug", slug)
        .maybeSingle();
      if (error || !data) return null;
      return data as PublicArticle;
    },
    ["articles", "slug", slug],
    { tags: [`articles:${slug}`], revalidate: 3600 }
  );

  return cached();
}

/** Public URL for a hero image in the public `article-hero-images` bucket, or null if there isn't one. */
export function publicHeroImageUrl(heroImagePath: string | null): string | null {
  if (!heroImagePath) return null;
  let supabase;
  try {
    supabase = createPublicContentClient();
  } catch {
    return null;
  }
  const { data } = supabase.storage.from("article-hero-images").getPublicUrl(heroImagePath);
  return data.publicUrl;
}
