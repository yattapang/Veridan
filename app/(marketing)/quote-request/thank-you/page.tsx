import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { ButtonLink } from "@/components/Button";
import { contactInfo } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Request Received",
  description: "Your quote request has been received.",
  robots: { index: false, follow: false },
};

const PATHWAY_COPY: Record<string, { title: string; expectation: string }> = {
  "new-construction": {
    title: "Thanks — we've got your project details.",
    expectation:
      "We'll review your hardware schedule and typically return a fully itemised, landed-cost quote within 2–8 business days.",
  },
  retrofit: {
    title: "Thanks — we've got the details.",
    expectation:
      "We'll review what you've told us and follow up shortly with next steps and pricing options. If you flagged this as urgent, we'll prioritise it.",
  },
};

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: Promise<{ pathway?: string }>;
}) {
  const { pathway } = await searchParams;
  const copy =
    (pathway && PATHWAY_COPY[pathway]) ||
    {
      title: "Thanks — your request has been received.",
      expectation: "We'll be in touch shortly with next steps.",
    };

  return (
    <PageHero kicker="Request Received" title={copy.title} lead={copy.expectation}>
      <div className="flex flex-wrap gap-4">
        <ButtonLink href="/" variant="ghost">
          Back to Home
        </ButtonLink>
        <ButtonLink href={`mailto:${contactInfo.email}`} variant="ghost">
          Email Us Directly
        </ButtonLink>
      </div>
    </PageHero>
  );
}
