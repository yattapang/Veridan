import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Container } from "@/components/Container";
import { UnavailableNotice } from "@/components/portal/UnavailableNotice";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { NewConstructionForm } from "./NewConstructionForm";

export const metadata: Metadata = {
  title: "New Construction Quote Request",
  description:
    "Request a landed-cost quote for a new construction hardware specification — upload your architect's hardware schedule or enter line items directly.",
  alternates: { canonical: "/quote-request/new-construction" },
};

export default function NewConstructionQuoteRequestPage() {
  const configured = isSupabaseConfigured();

  return (
    <>
      <PageHero
        kicker="New Construction"
        title="Tell us about your project."
        lead="We'll turn your architect's hardware schedule into a fully itemised, landed-cost quote — typically in 2–8 business days."
      />

      <section className="py-16 sm:py-24">
        <Container className="max-w-2xl">
          {configured ? (
            <NewConstructionForm />
          ) : (
            <UnavailableNotice />
          )}
        </Container>
      </section>
    </>
  );
}
