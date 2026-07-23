import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { getPublicCatalogueDocuments } from "@/lib/catalogue/publicLoader";
import { distinctBrands, distinctCategories } from "@/lib/catalogue/grouping";
import { CatalogueGrid } from "./CatalogueGrid";
import { CatalogueListClient } from "./CatalogueListClient";

export const metadata: Metadata = {
  title: "Catalogue",
  description:
    "Downloadable supplier catalogues and spec sheets from Assa Abloy, Allegion, Schlage, Consort, LCN, Von Duprin, and more — Veridan Limited, Jamaica's premium commercial hardware specialist.",
  alternates: { canonical: "/catalogue" },
};

// No `searchParams` prop here on purpose — reading it would force this
// route to render per-request (a Next.js dynamic API). Brand/category
// filters instead live in CatalogueListClient via useSearchParams() inside
// the Suspense boundary below, so this page stays statically prerenderable
// (same discipline as app/(marketing)/articles/page.tsx). Every document
// returned by getPublicCatalogueDocuments() is already scoped to
// visibility = 'public' by RLS + the query's own .eq filter (defense in
// depth, Plan §3.3) — this page never re-derives or trusts a client-claimed
// visibility.
export default async function CataloguePage() {
  const documents = await getPublicCatalogueDocuments();
  const allBrands = distinctBrands(documents);
  const allCategories = distinctCategories(documents);

  return (
    <>
      <PageHero
        kicker="Catalogue"
        title="Supplier catalogues and spec sheets, ready to download."
        lead="Manufacturer specification data for the brands Veridan sources — browse by brand or category, download the PDF you need."
      />

      <section className="py-16 sm:py-24">
        <Container>
          <Suspense
            fallback={
              <CatalogueGrid
                items={documents}
                allBrands={allBrands}
                allCategories={allCategories}
                activeBrand={null}
                activeCategory={null}
              />
            }
          >
            <CatalogueListClient items={documents} />
          </Suspense>
        </Container>
      </section>
    </>
  );
}
