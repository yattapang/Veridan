import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { SectionHeading } from "@/components/SectionHeading";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";
import { quoteRequestRoutes } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Retrofit & Replacement",
  description:
    "Commercial-grade replacement door hardware for building owners, facilities managers, and the contractors sourcing on their instruction — total-cost-of-ownership pricing, not residential-grade shortcuts.",
  alternates: { canonical: "/retrofit" },
};

export default function RetrofitPage() {
  return (
    <>
      <PageHero
        kicker="Retrofit & Replacement"
        title="Replace it once, with hardware built for commercial duty."
        lead="Failing door hardware is a liability and an insurance exposure, not just an inconvenience. Veridan supplies commercial-grade replacements sized for the building, not the bargain aisle."
      >
        <ButtonLink href={quoteRequestRoutes.retrofit} variant="primary">
          Request a Retrofit Quote
        </ButtonLink>
      </PageHero>

      {/* Owners / FMs pathway */}
      <section className="py-20 sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <SectionHeading
            kicker="Building Owners & Facilities Managers"
            title="The cost of a failing door isn't the door — it's the liability."
          />
          <div className="space-y-5 text-base leading-relaxed text-veridan-warm-gray">
            <p>
              A door closer that no longer closes, an exit device that
              doesn&rsquo;t latch, a lockset that&rsquo;s been forced — each
              is a life-safety and insurance exposure, not a maintenance
              footnote. Underwriters and fire codes expect commercial-duty
              hardware on commercial buildings.
            </p>
            <p>
              Residential-grade hardware is built for a 3–5 year replacement
              cycle. A genuine commercial closer, lockset, or exit device is
              engineered for 15–20 years of daily commercial traffic. Priced
              on total cost of ownership rather than sticker price, the
              commercial-grade option is almost always the cheaper decision
              over the life of the building.
            </p>
            <p>
              Veridan supplies and helps specify the correct commercial-grade
              replacement for your building — matched to door weight, traffic
              volume, and code requirement — with full manufacturer warranty
              documentation for your insurance and compliance file.
            </p>
          </div>
        </Container>
      </section>

      {/* Contractors pathway */}
      <section className="bg-veridan-warm-gray-pale py-20 sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <SectionHeading
            kicker="Contractors — Owner-Instructed Sourcing"
            title="Sourcing on your client's instruction, priced and delivered on your timeline."
          />
          <div className="space-y-5 text-base leading-relaxed text-veridan-warm-gray">
            <p>
              When a building owner or facilities manager instructs you to
              source specific replacement hardware, Veridan quotes and
              supplies it directly against that instruction — simple
              line-item pricing, no door register required, matched to the
              existing specification or upgraded to current code where
              needed.
            </p>
            <p>
              You get a fast, itemised quote and a single accountable
              supplier for the hardware line of the job, so you can focus on
              the installation and the rest of the scope.
            </p>
          </div>
        </Container>
      </section>

      <section className="py-20 sm:py-28">
        <Container>
          <SectionHeading
            kicker="Total Cost of Ownership"
            title="15–20 years vs. 3–5 years, side by side."
            align="center"
          />
          <div className="mt-14 grid gap-8 sm:grid-cols-2">
            <div className="border border-veridan-warm-gray-light p-8">
              <p className="text-xs font-semibold uppercase tracking-widest text-veridan-warm-gray">
                Residential-Grade Hardware
              </p>
              <p className="mt-4 text-3xl font-semibold text-veridan-ink">
                3–5 years
              </p>
              <p className="mt-3 text-sm leading-relaxed text-veridan-warm-gray">
                Typical service life under commercial traffic before
                replacement is needed again — repeated purchase and labor
                cost, repeated disruption.
              </p>
            </div>
            <div className="border-2 border-veridan-accent p-8">
              <p className="text-xs font-semibold uppercase tracking-widest text-veridan-accent">
                Commercial-Grade Hardware
              </p>
              <p className="mt-4 text-3xl font-semibold text-veridan-ink">
                15–20 years
              </p>
              <p className="mt-3 text-sm leading-relaxed text-veridan-warm-gray">
                Engineered service life for a commercial closer, lockset, or
                exit device — one purchase, one installation, a fraction of
                the long-run cost.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <section className="bg-veridan-ink py-20 text-veridan-paper sm:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Tell us what&rsquo;s failing.
          </h2>
          <p className="max-w-xl text-veridan-paper/75">
            Building type, what needs replacing, and how urgent it is — we&rsquo;ll
            take it from there.
          </p>
          <ButtonLink href={quoteRequestRoutes.retrofit} variant="primary">
            Request a Retrofit Quote
          </ButtonLink>
        </Container>
      </section>
    </>
  );
}
