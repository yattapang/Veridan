"use client";

import { useSearchParams } from "next/navigation";
import type { PublicCatalogueDocument } from "@/lib/catalogue/publicLoader";
import { distinctBrands, distinctCategories, filterCatalogueDocuments } from "@/lib/catalogue/grouping";
import { CatalogueGrid } from "./CatalogueGrid";

/**
 * Brand + category filter (Plan §3.5: "grouped/filterable by brand,
 * filterable by brand" / §3.4 filter-bar parity with the admin side). Reads
 * both facets out of the URL via `useSearchParams()` rather than the page's
 * `searchParams` prop — that prop is a Next.js dynamic API that would force
 * the whole `/catalogue` route to render per-request. The full PUBLIC list
 * (already RLS/query-scoped to visibility = 'public') is fetched once,
 * server-side, via the cookie-free loader and passed in as `items`;
 * brand/category filtering then happens entirely client-side, so the route
 * stays statically prerenderable — the same discipline as
 * app/(marketing)/articles/ArticleListClient.tsx's category filter. Must be
 * rendered inside a <Suspense> boundary (see page.tsx).
 */
export function CatalogueListClient({ items }: { items: PublicCatalogueDocument[] }) {
  const searchParams = useSearchParams();
  const brand = searchParams.get("brand");
  const category = searchParams.get("category");

  const allBrands = distinctBrands(items);
  const allCategories = distinctCategories(items);
  const visible = filterCatalogueDocuments(items, { brand: brand ?? "", category: category ?? "" });

  return (
    <CatalogueGrid
      items={visible}
      allBrands={allBrands}
      allCategories={allCategories}
      activeBrand={brand}
      activeCategory={category}
    />
  );
}
