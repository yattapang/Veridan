import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";
import { SectionHeading } from "@/components/SectionHeading";
import { LocalBusinessJsonLd } from "@/components/LocalBusinessJsonLd";
import {
  siteMeta,
  serviceLines,
  trustSignals,
  brandsSupplied,
  originsSupplied,
  primaryCta,
} from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Home",
  description: siteMeta.description,
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <LocalBusinessJsonLd />

      {/* Hero */}
      <section className="bg-veridan-ink text-veridan-paper">
        <Container className="py-24 sm:py-32">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-veridan-accent-soft">
            {siteMeta.positioning}
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Architect-specified commercial hardware, sourced and landed for
            Jamaica.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-veridan-paper/75">
            Veridan Limited is the dedicated local specialist for the
            international brands architects already specify — Assa Abloy,
            Allegion, Schlage, Consort, LCN, Von Duprin — procured,
            landed-cost quoted, and delivered with full warranty
            documentation.
          </p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <ButtonLink href={primaryCta.href} variant="primary">
              {primaryCta.label}
            </ButtonLink>
            <ButtonLink href="/new-construction" variant="ghost">
              Explore Our Services
            </ButtonLink>
          </div>
          <p className="mt-12 text-sm font-medium uppercase tracking-[0.25em] text-veridan-accent-soft">
            {siteMeta.tagline}
          </p>
        </Container>
      </section>

      {/* The procurement gap */}
      <section className="py-20 sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <SectionHeading
            kicker="The Gap We Close"
            title="Architects specify world-class hardware. Until now, nobody in Jamaica was built to deliver it."
          />
          <div className="space-y-5 text-base leading-relaxed text-veridan-warm-gray">
            <p>
              Commercial projects across Jamaica routinely call for
              internationally certified hardware on the architect&rsquo;s
              schedule — fire-rated exit devices, engineered door closers,
              specification-grade locksets. But no dedicated local supplier
              existed to source it, land it, and stand behind it.
            </p>
            <p>
              That gap left architects value-engineering specifications down
              to whatever was on a local shelf, and contractors chasing
              multiple overseas suppliers on tight timelines with no single
              point of accountability.
            </p>
            <p>
              Veridan exists to close that gap — one supplier, one
              itemised landed-cost quote, one accountable delivery, built
              around the exact brands already on the drawings.
            </p>
          </div>
        </Container>
      </section>

      {/* Two service lines */}
      <section className="bg-veridan-warm-gray-pale py-20 sm:py-28">
        <Container>
          <SectionHeading
            kicker="How We Work"
            title="Two service lines. One accountable supplier."
            align="center"
          />
          <div className="mt-14 grid gap-8 md:grid-cols-2">
            {serviceLines.map((line) => (
              <div
                key={line.key}
                className="flex flex-col justify-between border border-veridan-warm-gray-light bg-veridan-paper p-8"
              >
                <div>
                  <h3 className="text-xl font-semibold text-veridan-ink">
                    {line.title}
                  </h3>
                  <p className="mt-4 text-base leading-relaxed text-veridan-warm-gray">
                    {line.summary}
                  </p>
                </div>
                <Link
                  href={line.href}
                  className="mt-8 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-veridan-accent-text hover:text-veridan-ink"
                >
                  Learn more →
                </Link>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Trust signals */}
      <section className="py-20 sm:py-28">
        <Container>
          <SectionHeading
            kicker="Why Veridan"
            title="Proven, accountable, multi-origin."
            align="center"
          />
          <div className="mt-14 grid gap-10 sm:grid-cols-3">
            {trustSignals.map((signal) => (
              <div key={signal.title} className="border-t-2 border-veridan-accent pt-5">
                <h3 className="text-lg font-semibold text-veridan-ink">
                  {signal.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-veridan-warm-gray">
                  {signal.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs uppercase tracking-widest text-veridan-warm-gray">
            {originsSupplied.map((origin, i) => (
              <span key={origin.region} className="flex items-center gap-3">
                {i > 0 && <span className="text-veridan-warm-gray-light">/</span>}
                {origin.region}
              </span>
            ))}
          </div>
        </Container>
      </section>

      {/* Brand list */}
      <section className="border-y border-veridan-warm-gray-light bg-veridan-paper py-16">
        <Container>
          <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.3em] text-veridan-warm-gray">
            Brands We Supply
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
            {brandsSupplied.map((brand) => (
              <span
                key={brand}
                className="text-lg font-medium tracking-tight text-veridan-ink/70"
              >
                {brand}
              </span>
            ))}
          </div>
        </Container>
      </section>

      {/* Closing CTA */}
      <section className="bg-veridan-ink py-20 text-veridan-paper sm:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Ready to specify with confidence?
          </h2>
          <p className="max-w-xl text-veridan-paper/75">
            Tell us about your project and get a fully itemised, landed-cost
            quote — no hidden fees, no post-delivery surprises.
          </p>
          <ButtonLink href={primaryCta.href} variant="primary">
            {primaryCta.label}
          </ButtonLink>
        </Container>
      </section>
    </>
  );
}
