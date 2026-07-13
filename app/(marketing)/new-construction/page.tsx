import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { SectionHeading } from "@/components/SectionHeading";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";
import { primaryCta } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "New Construction — Specification Procurement",
  description:
    "From an architect's hardware schedule to a fully itemised, landed-cost quote in 2–8 business days — managed import and site delivery with warranty documentation for new construction projects in Jamaica.",
  alternates: { canonical: "/new-construction" },
};

const processSteps = [
  {
    step: "01",
    title: "Architect schedule submitted",
    body: "Send the hardware schedule as drawn — PDF, Excel, or scanned pages. We work from the specification as issued, matching manufacturer, finish, and function exactly.",
  },
  {
    step: "02",
    title: "Fully itemised, landed-cost quote",
    body: "Within 2–8 business days you receive a per-door, per-item quote with freight, duty, insurance, and brokerage already rolled in — the number you see is the number you pay. No hidden fees, no post-delivery adjustments.",
  },
  {
    step: "03",
    title: "Managed import",
    body: "Once approved, Veridan manages the multi-origin import process end-to-end — sourcing from US, UK, and Canadian suppliers and consolidating shipments so the project timeline holds.",
  },
  {
    step: "04",
    title: "Site delivery with warranty pack",
    body: "Hardware arrives at site with a complete manufacturer warranty documentation pack, ready for installation sign-off and the project close-out file.",
  },
];

export default function NewConstructionPage() {
  return (
    <>
      <PageHero
        kicker="New Construction"
        title="Specification procurement, done right the first time."
        lead="Veridan turns an architect's hardware schedule into a fully itemised, landed-cost quote — then manages the import and delivers to site with a complete warranty documentation pack."
      >
        <ButtonLink href={primaryCta.href} variant="primary">
          Request a New Construction Quote
        </ButtonLink>
      </PageHero>

      <section className="py-20 sm:py-28">
        <Container>
          <SectionHeading
            kicker="The Process"
            title="Schedule to site delivery in four steps."
            lead="No hidden fees, no post-delivery price adjustments — every landed cost is itemised before you approve the quote."
          />
          <div className="mt-14 grid gap-10 sm:grid-cols-2">
            {processSteps.map((s) => (
              <div key={s.step} className="flex gap-5">
                <span className="text-3xl font-semibold text-veridan-accent">
                  {s.step}
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-veridan-ink">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-veridan-warm-gray">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-veridan-warm-gray-pale py-20 sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              kicker="For Architects"
              title="Your specification, honored — not value-engineered away."
            />
            <p className="mt-6 text-base leading-relaxed text-veridan-warm-gray">
              When the exact brand and model you specified isn&rsquo;t locally
              available, projects default to whatever a contractor can find
              on short notice — and specifications quietly erode. Veridan
              sources the actual brands on your drawings — Assa Abloy,
              Allegion, Schlage, Consort, LCN, Von Duprin — so what gets
              built matches what you designed.
            </p>
          </div>
          <div>
            <SectionHeading
              kicker="For Contractors"
              title="One accountable supplier, one landed-cost number."
            />
            <p className="mt-6 text-base leading-relaxed text-veridan-warm-gray">
              Instead of chasing multiple overseas suppliers and absorbing
              landed-cost risk yourself, work with a single point of
              accountability for the full hardware package — priced,
              scheduled, and delivered against the project timeline.
            </p>
          </div>
        </Container>
      </section>

      <section className="bg-veridan-ink py-20 text-veridan-paper sm:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Send us your hardware schedule.
          </h2>
          <p className="max-w-xl text-veridan-paper/75">
            We&rsquo;ll return a fully itemised, landed-cost quote in 2–8
            business days.
          </p>
          <ButtonLink href={primaryCta.href} variant="primary">
            Request a Quote
          </ButtonLink>
        </Container>
      </section>
    </>
  );
}
