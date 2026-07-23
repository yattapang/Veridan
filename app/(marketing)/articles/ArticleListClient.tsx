"use client";

import { useSearchParams } from "next/navigation";
import { ArticleGrid, type ArticleListItem } from "./ArticleGrid";

/**
 * Category filter (Plan §2.5: "public article list may group/filter by
 * category"). Reads the category out of the URL via `useSearchParams()`
 * rather than the page's `searchParams` prop — that prop is a Next.js
 * dynamic API that would force the whole `/articles` route to render
 * per-request. The full published list is fetched once, server-side, via
 * the cookie-free loader (lib/articles/publicLoader.ts) and passed in as
 * `items`; filtering then happens entirely client-side, so the route stays
 * statically prerenderable (Plan §2.5 / the Phase 3A review's cookie-free
 * discipline). Must be rendered inside a <Suspense> boundary (see page.tsx)
 * — useSearchParams requires one to avoid opting the whole tree into
 * client-only rendering.
 */
export function ArticleListClient({ items }: { items: ArticleListItem[] }) {
  const searchParams = useSearchParams();
  const category = searchParams.get("category");

  const allCategories = Array.from(
    new Set(items.map((i) => i.article.category).filter((c): c is string => Boolean(c)))
  ).sort((a, b) => a.localeCompare(b));

  const visible = category ? items.filter((i) => i.article.category === category) : items;

  return <ArticleGrid items={visible} allCategories={allCategories} activeCategory={category} />;
}
