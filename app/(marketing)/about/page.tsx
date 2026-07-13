import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { SectionHeading } from "@/components/SectionHeading";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";
import { founders, aboutStory, primaryCta } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "About",
  description:
    "Veridan Limited is a Kingston, Jamaica-based commercial hardware specialist founded by Ken Yatta and Kaylia, built on a proven multi-origin supply chain across the US, UK, and Canada.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        kicker="About Veridan"
        title={aboutStory.heading}
        lead="Kingston-based. Multi-origin supply chain. Proven on the first order."
      />

      <section className="py-20 sm:py-28">
        <Container className="max-w-3xl space-y-6 text-base leading-relaxed text-veridan-warm-gray">
          {aboutStory.body.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </Container>
      </section>

      <section className="bg-veridan-warm-gray-pale py-20 sm:py-28">
        <Container>
          <SectionHeading
            kicker="Leadership"
            title="Founded by operators, not just sellers."
            align="center"
          />
          <div className="mt-14 grid gap-10 sm:grid-cols-2">
            {founders.map((f) => (
              <div key={f.name} className="border-t-2 border-veridan-accent pt-6">
                <h3 className="text-xl font-semibold text-veridan-ink">
                  {f.name}
                </h3>
                <p className="mt-1 text-sm font-medium uppercase tracking-wide text-veridan-accent">
                  {f.role}
                </p>
                <p className="mt-4 text-sm leading-relaxed text-veridan-warm-gray">
                  {f.bio}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 sm:py-28">
        <Container className="grid gap-10 sm:grid-cols-3">
          <div>
            <p className="text-3xl font-semibold text-veridan-accent">JM · CA</p>
            <p className="mt-2 text-sm text-veridan-warm-gray">
              Dual Jamaican-Canadian citizenship enabling direct, hands-on
              multi-origin logistics.
            </p>
          </div>
          <div>
            <p className="text-3xl font-semibold text-veridan-accent">US · UK · CA</p>
            <p className="mt-2 text-sm text-veridan-warm-gray">
              A proven supply chain spanning three countries of origin.
            </p>
          </div>
          <div>
            <p className="text-3xl font-semibold text-veridan-accent">1st</p>
            <p className="mt-2 text-sm text-veridan-warm-gray">
              First order completed end-to-end — the model is proven, not
              theoretical.
            </p>
          </div>
        </Container>
      </section>

      <section className="bg-veridan-ink py-20 text-veridan-paper sm:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Let&rsquo;s talk about your project.
          </h2>
          <ButtonLink href={primaryCta.href} variant="primary">
            {primaryCta.label}
          </ButtonLink>
        </Container>
      </section>
    </>
  );
}
