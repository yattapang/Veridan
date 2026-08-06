import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHero } from "@/components/PageHero";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";
// primaryCta stays hardcoded (Plan §1.4 exclusion) — static import, same as
// app/(marketing)/products/page.tsx.
import { primaryCta } from "@/lib/site-content";
import { getProductCategories, getBrandsSupplied, publicBrandLogoUrl } from "@/lib/site-content-db/loader";
import { getPublicCatalogueDocuments } from "@/lib/catalogue/publicLoader";
import { formatFileSize } from "@/lib/catalogue/validation";
import { findProductCategoryByKey, filterCatalogueDocumentsForCategory, resolveCategoryBrands } from "@/lib/products/matching";

// Prerenders every current product-category key at build time so
// /products/[category] is STATIC (○), not dynamic — same discipline as
// app/(marketing)/articles/[slug]/page.tsx (cookie-free reads throughout;
// getProductCategories/getBrandsSupplied/getPublicCatalogueDocuments all use
// the cookie-free createPublicContentClient, per Phase 3A review MAJOR-1). A
// category key published AFTER a build still works via Next's default
// dynamicParams=true.
export async function generateStaticParams() {
  const categories = await getProductCategories();
  return categories.map((category) => ({ category: category.key }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category: categoryKey } = await params;
  const categories = await getProductCategories();
  const category = findProductCategoryByKey(categories, categoryKey);
  if (!category) return { title: "Category not found" };

  return {
    title: category.title,
    description: category.description,
    alternates: { canonical: `/products/${category.key}` },
  };
}

export default async function ProductCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: categoryKey } = await params;

  const [categories, allBrands, catalogueDocuments] = await Promise.all([
    getProductCategories(),
    getBrandsSupplied(),
    getPublicCatalogueDocuments(),
  ]);

  const category = findProductCategoryByKey(categories, categoryKey);
  if (!category) notFound();

  const brands = resolveCategoryBrands(category.brands, allBrands);
  // Forgiving match (case/whitespace-insensitive, title-or-key) — the
  // founder types catalogue-document categories as free text, so an exact
  // match against product_categories would silently show nothing. See
  // lib/products/matching.ts.
  const matchedDocuments = filterCatalogueDocumentsForCategory(catalogueDocuments, category);

  return (
    <>
      <PageHero kicker="Products" title={category.title} lead={category.description} />

      <section className="py-16 sm:py-24">
        <Container>
          <Link
            href="/products"
            className="text-xs uppercase tracking-wide text-veridan-warm-gray hover:text-veridan-ink"
          >
            ← All product categories
          </Link>

          {brands.length > 0 && (
            <div className="mt-10">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-veridan-warm-gray">
                Brands we supply in this category
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-6">
                {brands.map((brand) => {
                  const logoUrl = publicBrandLogoUrl(brand.logoPath);
                  if (!logoUrl) {
                    return (
                      <span
                        key={brand.name}
                        className="text-lg font-medium tracking-tight text-veridan-ink/70"
                      >
                        {brand.name}
                      </span>
                    );
                  }
                  return (
                    // eslint-disable-next-line @next/next/no-img-element -- public Storage-hosted image, same reviewed choice as the home page brand strip (app/(marketing)/page.tsx).
                    <img
                      key={brand.name}
                      src={logoUrl}
                      alt={brand.name}
                      className="h-10 w-auto max-w-[10rem] object-contain grayscale transition-[filter] duration-200 hover:grayscale-0"
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-14">
            <h2 className="text-lg font-semibold text-veridan-ink">
              Published catalogues &amp; spec sheets
            </h2>

            {matchedDocuments.length === 0 ? (
              <p className="mt-3 text-sm leading-relaxed text-veridan-warm-gray">
                Detailed specification sheets for this category are available
                on request.
              </p>
            ) : (
              <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {matchedDocuments.map((doc) => {
                  const size = formatFileSize(doc.file_size_bytes);
                  return (
                    <article
                      key={doc.id}
                      className="flex flex-col border border-veridan-warm-gray-light p-6"
                    >
                      {doc.thumbnail_storage_path ? (
                        // eslint-disable-next-line @next/next/no-img-element -- served through the gated /api/catalogue/[id]/thumbnail route, not a static/known-domain image.
                        <img
                          src={`/api/catalogue/${doc.id}/thumbnail`}
                          alt=""
                          className="mb-4 h-36 w-full rounded-md border border-veridan-warm-gray-light object-cover"
                        />
                      ) : (
                        <div className="mb-4 flex h-36 w-full items-center justify-center rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale text-xs uppercase tracking-wide text-veridan-warm-gray">
                          PDF
                        </div>
                      )}
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-veridan-accent-text">
                        {doc.brand}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-veridan-ink">{doc.title}</h3>
                      {doc.description && (
                        <p className="mt-2 flex-1 text-sm leading-relaxed text-veridan-warm-gray">
                          {doc.description}
                        </p>
                      )}
                      <a
                        href={`/api/catalogue/${doc.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-veridan-accent-text hover:text-veridan-ink"
                      >
                        View / Download PDF{size ? ` (${size})` : ""} →
                      </a>
                    </article>
                  );
                })}
              </div>
            )}

            <p className="mt-6 text-sm text-veridan-warm-gray">
              <Link
                href="/catalogue"
                className="font-semibold text-veridan-accent-text underline underline-offset-2 hover:text-veridan-ink"
              >
                Browse the full catalogue &amp; spec sheet library →
              </Link>
            </p>
          </div>

          <p className="mt-14 text-sm text-veridan-warm-gray">
            Prices are project-specific and never published — request a quote
            for an itemised, landed-cost figure prepared for your project.
          </p>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row">
            <ButtonLink href={primaryCta.href} variant="primary">
              {primaryCta.label}
            </ButtonLink>
            <ButtonLink href="/catalogue" variant="secondary">
              Browse Full Catalogue
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
