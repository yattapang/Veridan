import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";
import { contactInfo, quoteRequestRoutes } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with Veridan Limited — request a quote for new construction specification procurement or retrofit and replacement hardware, or reach us by email or WhatsApp Business.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        kicker="Contact"
        title="Let's talk about your project."
        lead="The fastest way to get an accurate quote is through the form for your project type. Prefer to talk first? Reach us directly below."
      />

      <section className="py-20 sm:py-28">
        <Container className="grid gap-8 sm:grid-cols-2">
          <div className="flex flex-col justify-between border border-veridan-warm-gray-light p-8">
            <div>
              <h3 className="text-lg font-semibold text-veridan-ink">
                New Construction
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-veridan-warm-gray">
                Submit an architect&rsquo;s hardware schedule for a fully
                itemised, landed-cost quote.
              </p>
            </div>
            <ButtonLink
              href={quoteRequestRoutes.newConstruction}
              variant="secondary"
              className="mt-6"
            >
              Request a New Construction Quote
            </ButtonLink>
          </div>

          <div className="flex flex-col justify-between border border-veridan-warm-gray-light p-8">
            <div>
              <h3 className="text-lg font-semibold text-veridan-ink">
                Retrofit & Replacement
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-veridan-warm-gray">
                Tell us what&rsquo;s failing and how urgent it is — for
                building owners, facilities managers, and contractors.
              </p>
            </div>
            <ButtonLink
              href={quoteRequestRoutes.retrofit}
              variant="secondary"
              className="mt-6"
            >
              Request a Retrofit Quote
            </ButtonLink>
          </div>
        </Container>
      </section>

      <section className="bg-veridan-warm-gray-pale py-16 sm:py-20">
        <Container className="grid gap-10 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-veridan-warm-gray">
              Email
            </p>
            <a
              href={`mailto:${contactInfo.email}`}
              className="mt-2 block text-lg font-medium text-veridan-ink hover:text-veridan-accent-text"
            >
              {contactInfo.email}
            </a>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-veridan-warm-gray">
              WhatsApp Business
            </p>
            <p className="mt-2 text-lg font-medium text-veridan-ink">
              {contactInfo.whatsappBusinessLabel}
            </p>
            <p className="mt-1 text-sm text-veridan-warm-gray">
              {contactInfo.whatsappBusinessNote}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-veridan-warm-gray">
              Location
            </p>
            <p className="mt-2 text-lg font-medium text-veridan-ink">
              {contactInfo.location}
            </p>
          </div>
        </Container>
      </section>
    </>
  );
}
