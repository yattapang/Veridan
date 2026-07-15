import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Container } from "@/components/Container";
import { UnavailableNotice } from "@/components/portal/UnavailableNotice";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { RetrofitForm } from "./RetrofitForm";

export const metadata: Metadata = {
  title: "Retrofit & Replacement Quote Request",
  description:
    "Request a quote for retrofit and replacement commercial door hardware — for building owners, facilities managers, and contractors sourcing on an owner's instruction.",
  alternates: { canonical: "/quote-request/retrofit" },
};

export default function RetrofitQuoteRequestPage() {
  const configured = isSupabaseConfigured();

  return (
    <>
      <PageHero
        kicker="Retrofit & Replacement"
        title="Tell us what's failing."
        lead="A few details about the building and the problem is all we need to put together commercial-grade replacement options."
      />

      <section className="py-16 sm:py-24">
        <Container className="max-w-2xl">
          {configured ? <RetrofitForm /> : <UnavailableNotice />}
        </Container>
      </section>
    </>
  );
}
