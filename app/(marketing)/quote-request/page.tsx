import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";
import { quoteRequestRoutes } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Request a Quote",
  description:
    "Request a landed-cost quote from Veridan Limited — for a new construction hardware specification, or a retrofit and replacement project.",
  alternates: { canonical: "/quote-request" },
};

export default function QuoteRequestPage() {
  return (
    <>
      <PageHero
        kicker="Request a Quote"
        title="Which best describes your project?"
        lead="Pick the path that matches what you need — each form is tailored to the information we need to get you an accurate, itemised, landed-cost quote."
      />

      <section className="py-20 sm:py-28">
        <Container className="grid gap-8 sm:grid-cols-2">
          <article className="flex flex-col justify-between border border-veridan-warm-gray-light p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-veridan-accent">
                Architects &amp; Contractors
              </p>
              <h2 className="mt-3 text-xl font-semibold text-veridan-ink">
                New Construction
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-veridan-warm-gray">
                Have an architect&rsquo;s hardware schedule for a new build?
                Upload the schedule or enter line items directly, and
                we&rsquo;ll return a fully itemised, landed-cost quote in
                2&ndash;8 business days.
              </p>
            </div>
            <ButtonLink
              href={quoteRequestRoutes.newConstruction}
              variant="primary"
              className="mt-8"
            >
              Start New Construction Request
            </ButtonLink>
          </article>

          <article className="flex flex-col justify-between border border-veridan-warm-gray-light p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-veridan-accent">
                Owners, FMs &amp; Contractors
              </p>
              <h2 className="mt-3 text-xl font-semibold text-veridan-ink">
                Retrofit &amp; Replacement
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-veridan-warm-gray">
                Dealing with failing or outdated hardware on an existing
                building? Tell us what&rsquo;s wrong and how urgent it is,
                and we&rsquo;ll come back with commercial-grade replacement
                options.
              </p>
            </div>
            <ButtonLink
              href={quoteRequestRoutes.retrofit}
              variant="primary"
              className="mt-8"
            >
              Start Retrofit Request
            </ButtonLink>
          </article>
        </Container>
      </section>
    </>
  );
}
