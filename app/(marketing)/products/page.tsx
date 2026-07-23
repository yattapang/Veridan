import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";
// primaryCta stays hardcoded (Plan §1.4 exclusion) — static import.
import { primaryCta } from "@/lib/site-content";
import { getProductCategories } from "@/lib/site-content-db/loader";

export const metadata: Metadata = {
  title: "Products — Commercial Door Hardware",
  description:
    "Locksets, door closers, hinges, exit devices, access control, architectural ironmongery, door frames, and amenity signage — commercial-grade hardware from Assa Abloy, Allegion, Schlage, Consort, LCN, Von Duprin, and more.",
  alternates: { canonical: "/products" },
};

export default async function ProductsPage() {
  const productCategories = await getProductCategories();

  return (
    <>
      <PageHero
        kicker="Products"
        title="The full commercial hardware schedule, one supplier."
        lead="Veridan sources across every category on a typical architect's hardware schedule. Pricing is quoted per project — request a quote for current landed-cost pricing."
      />

      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {productCategories.map((cat) => (
              <div
                key={cat.key}
                className="flex flex-col justify-between border border-veridan-warm-gray-light p-7"
              >
                <div>
                  <h3 className="text-lg font-semibold text-veridan-ink">
                    {cat.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-veridan-warm-gray">
                    {cat.description}
                  </p>
                </div>
                {cat.brands.length > 0 && (
                  <p className="mt-6 text-xs font-medium uppercase tracking-wide text-veridan-accent-text">
                    {cat.brands.join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>

          <p className="mt-12 text-sm text-veridan-warm-gray">
            Prices are project-specific and never published — every quote is
            an itemised, landed-cost figure prepared for your project.
          </p>

          <p className="mt-4 text-sm text-veridan-warm-gray">
            Looking for manufacturer specification data?{" "}
            <Link
              href="/catalogue"
              className="font-semibold text-veridan-accent-text underline underline-offset-2 hover:text-veridan-ink"
            >
              Browse downloadable catalogues &amp; spec sheets →
            </Link>
          </p>

          <div className="mt-8">
            <ButtonLink href={primaryCta.href} variant="secondary">
              Request Pricing
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
