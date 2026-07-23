import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import type { SiteContentKey, SiteContentRow } from "@/lib/site-content-db/types";
import { SITE_CONTENT_KEYS } from "@/lib/site-content-db/types";
import { ScalarForm } from "./ScalarForm";
import { ListEditor } from "./ListEditor";
import {
  saveSiteMeta,
  saveContactInfo,
  saveAboutStory,
  saveBrandsSupplied,
  saveTrustSignals,
  saveTestimonials,
  saveServiceLines,
  saveProductCategories,
  saveFounders,
} from "./actions";

export const metadata = {
  title: "Site Content",
};

/** Where each section actually renders on the public site — Plan §1.6's "View live page →" link. */
const LIVE_PAGE_HREF: Record<SiteContentKey, string> = {
  site_meta: "/",
  contact_info: "/contact",
  brands_supplied: "/",
  trust_signals: "/",
  testimonials: "/",
  service_lines: "/",
  product_categories: "/products",
  founders: "/about",
  about_story: "/about",
};

function SectionShell({
  label,
  description,
  liveHref,
  children,
}: {
  label: string;
  description: string | null;
  liveHref: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">
            {label}
          </h2>
          {description && <p className="mt-1 text-sm text-veridan-warm-gray">{description}</p>}
        </div>
        <Link
          href={liveHref}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-veridan-accent-text hover:text-veridan-ink"
        >
          View live page →
        </Link>
      </div>
      {children}
    </section>
  );
}

export default async function SiteContentPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Site Content</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let rows: SiteContentRow[] | null = null;
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase.from("site_content").select("*").order("key");
    if (error) loadError = error.message;
    else rows = data as SiteContentRow[];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Site Content</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The site_content table couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload. Marketing pages themselves are unaffected — they fall back to the hardcoded copy in lib/site-content.ts while this table is unreachable.`}
        />
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Site Content</h1>
        <InstructiveMessage
          title="No site content found"
          body="site_content is empty. Run supabase/migrations/20260722000001_site_content.sql against this database to load the seed content, then reload."
        />
      </div>
    );
  }

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const missingKeys = SITE_CONTENT_KEYS.filter((k) => !byKey.has(k));

  type AuditRow = {
    id: string;
    content_key: string;
    old_value: unknown;
    new_value: unknown;
    changed_at: string;
    reason: string | null;
  };
  let auditRows: AuditRow[] = [];
  let auditError: string | null = null;
  try {
    const { data: audit, error } = await supabase
      .from("site_content_audit_log")
      .select("id, content_key, old_value, new_value, changed_at, reason")
      .order("changed_at", { ascending: false })
      .limit(20);
    if (error) auditError = error.message;
    else auditRows = (audit as AuditRow[]) ?? [];
  } catch (err) {
    auditError = err instanceof Error ? err.message : "Unknown error loading audit log.";
  }

  const siteMetaRow = byKey.get("site_meta");
  const contactInfoRow = byKey.get("contact_info");
  const aboutStoryRow = byKey.get("about_story");
  const brandsSuppliedRow = byKey.get("brands_supplied");
  const trustSignalsRow = byKey.get("trust_signals");
  const testimonialsRow = byKey.get("testimonials");
  const serviceLinesRow = byKey.get("service_lines");
  const productCategoriesRow = byKey.get("product_categories");
  const foundersRow = byKey.get("founders");

  const siteMetaValue = (siteMetaRow?.value.value ?? {}) as Record<string, string>;
  const contactInfoValue = (contactInfoRow?.value.value ?? {}) as Record<string, string>;
  const aboutStoryValue = (aboutStoryRow?.value.value ?? { heading: "", body: [] }) as {
    heading: string;
    body: string[];
  };
  const brandsSuppliedValue = (brandsSuppliedRow?.value.value ?? []) as string[];
  const trustSignalsValue = (trustSignalsRow?.value.value ?? []) as Record<string, unknown>[];
  const testimonialsValue = (testimonialsRow?.value.value ?? []) as Record<string, unknown>[];
  const serviceLinesValue = (serviceLinesRow?.value.value ?? []) as Record<string, unknown>[];
  const productCategoriesValue = (productCategoriesRow?.value.value ?? []) as Record<
    string,
    unknown
  >[];
  const foundersValue = (foundersRow?.value.value ?? []) as Record<string, unknown>[];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Site Content</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Marketing-site copy, editable here instead of by code change. Saving a section takes
        effect on the live site immediately (no deploy needed) — every save is recorded below.
        Page navigation, the primary &ldquo;Request a Quote&rdquo; button, and the quote-request
        form routes are structural and stay hardcoded, not editable here.
      </p>

      {missingKeys.length > 0 && (
        <div className="mt-4">
          <InstructiveMessage
            title="Some content sections are missing"
            body={`The following section(s) have no row yet and can't be edited until the seed migration is (re-)applied: ${missingKeys.join(", ")}.`}
          />
        </div>
      )}

      <div className="mt-8 space-y-8">
        {siteMetaRow && (
          <SectionShell
            label={siteMetaRow.section_label}
            description={siteMetaRow.description}
            liveHref={LIVE_PAGE_HREF.site_meta}
          >
            <ScalarForm
              action={saveSiteMeta}
              initialValues={{
                tagline: siteMetaValue.tagline ?? "",
                positioning: siteMetaValue.positioning ?? "",
                description: siteMetaValue.description ?? "",
                locality: siteMetaValue.locality ?? "",
              }}
              fields={[
                { name: "tagline", label: "Tagline", kind: "text" },
                { name: "positioning", label: "Positioning statement", kind: "text" },
                { name: "locality", label: "Locality", kind: "text" },
                { name: "description", label: "Meta description", kind: "textarea" },
              ]}
            />
          </SectionShell>
        )}

        {contactInfoRow && (
          <SectionShell
            label={contactInfoRow.section_label}
            description={contactInfoRow.description}
            liveHref={LIVE_PAGE_HREF.contact_info}
          >
            <ScalarForm
              action={saveContactInfo}
              initialValues={{
                email: contactInfoValue.email ?? "",
                whatsappBusinessLabel: contactInfoValue.whatsappBusinessLabel ?? "",
                whatsappBusinessNote: contactInfoValue.whatsappBusinessNote ?? "",
                location: contactInfoValue.location ?? "",
              }}
              fields={[
                { name: "email", label: "Email", kind: "text" },
                { name: "location", label: "Location", kind: "text" },
                { name: "whatsappBusinessLabel", label: "WhatsApp label", kind: "text" },
                {
                  name: "whatsappBusinessNote",
                  label: "WhatsApp number / note",
                  kind: "textarea",
                  help: "Once a real WhatsApp Business number is available, put it here (e.g. as the visible text shown on the Contact page).",
                },
              ]}
            />
          </SectionShell>
        )}

        {brandsSuppliedRow && (
          <SectionShell
            label={brandsSuppliedRow.section_label}
            description={brandsSuppliedRow.description}
            liveHref={LIVE_PAGE_HREF.brands_supplied}
          >
            <ListEditor
              action={saveBrandsSupplied}
              itemLabel="brand"
              emptyItem={{ value: "" }}
              initialItems={brandsSuppliedValue.map((b) => ({ value: b }))}
              fields={[{ name: "value", label: "Brand name", kind: "text" }]}
            />
          </SectionShell>
        )}

        {trustSignalsRow && (
          <SectionShell
            label={trustSignalsRow.section_label}
            description={trustSignalsRow.description}
            liveHref={LIVE_PAGE_HREF.trust_signals}
          >
            <ListEditor
              action={saveTrustSignals}
              itemLabel="trust signal"
              emptyItem={{ title: "", body: "" }}
              initialItems={trustSignalsValue}
              fields={[
                { name: "title", label: "Title", kind: "text" },
                { name: "body", label: "Body", kind: "textarea" },
              ]}
            />
          </SectionShell>
        )}

        {testimonialsRow && (
          <SectionShell
            label={testimonialsRow.section_label}
            description={testimonialsRow.description}
            liveHref={LIVE_PAGE_HREF.testimonials}
          >
            <ListEditor
              action={saveTestimonials}
              itemLabel="testimonial"
              emptyItem={{ quote: "", attribution: "" }}
              initialItems={testimonialsValue}
              fields={[
                { name: "quote", label: "Quote", kind: "textarea" },
                { name: "attribution", label: "Attribution", kind: "text" },
              ]}
            />
          </SectionShell>
        )}

        {serviceLinesRow && (
          <SectionShell
            label={serviceLinesRow.section_label}
            description={serviceLinesRow.description}
            liveHref={LIVE_PAGE_HREF.service_lines}
          >
            <ListEditor
              action={saveServiceLines}
              itemLabel="service line"
              emptyItem={{ key: "", title: "", href: "", summary: "" }}
              initialItems={serviceLinesValue}
              fields={[
                { name: "title", label: "Title", kind: "text" },
                { name: "href", label: "Link path (e.g. /new-construction)", kind: "text" },
                { name: "summary", label: "Summary", kind: "textarea" },
                {
                  name: "key",
                  label: "Internal key (advanced — keep unique, no spaces)",
                  kind: "text",
                },
              ]}
            />
          </SectionShell>
        )}

        {productCategoriesRow && (
          <SectionShell
            label={productCategoriesRow.section_label}
            description={productCategoriesRow.description}
            liveHref={LIVE_PAGE_HREF.product_categories}
          >
            <ListEditor
              action={saveProductCategories}
              itemLabel="category"
              emptyItem={{ key: "", title: "", description: "", brands: [] }}
              initialItems={productCategoriesValue}
              fields={[
                { name: "title", label: "Title", kind: "text" },
                { name: "description", label: "Description", kind: "textarea" },
                { name: "brands", label: "Brands", kind: "stringlist", placeholder: "Comma-separated, may be blank" },
                {
                  name: "key",
                  label: "Internal key (advanced — keep unique, lowercase-hyphenated)",
                  kind: "text",
                },
              ]}
            />
          </SectionShell>
        )}

        {foundersRow && (
          <SectionShell
            label={foundersRow.section_label}
            description={foundersRow.description}
            liveHref={LIVE_PAGE_HREF.founders}
          >
            <ListEditor
              action={saveFounders}
              itemLabel="founder"
              emptyItem={{ name: "", role: "", bio: "" }}
              initialItems={foundersValue}
              fields={[
                { name: "name", label: "Name", kind: "text" },
                { name: "role", label: "Role", kind: "text" },
                { name: "bio", label: "Bio", kind: "textarea" },
              ]}
            />
          </SectionShell>
        )}

        {aboutStoryRow && (
          <SectionShell
            label={aboutStoryRow.section_label}
            description={aboutStoryRow.description}
            liveHref={LIVE_PAGE_HREF.about_story}
          >
            <ScalarForm
              action={saveAboutStory}
              initialValues={{
                heading: aboutStoryValue.heading ?? "",
                body: (aboutStoryValue.body ?? []).join("\n\n"),
              }}
              fields={[
                { name: "heading", label: "Heading", kind: "text" },
                {
                  name: "body",
                  label: "Body",
                  kind: "paragraphs",
                  help: "Separate paragraphs with a blank line.",
                },
              ]}
            />
          </SectionShell>
        )}
      </div>

      <section className="mt-12">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Recent changes
        </h2>
        {auditError ? (
          <InstructiveMessage
            title="Audit log unavailable"
            body={`Recent changes couldn't be loaded (${auditError}).`}
          />
        ) : auditRows.length === 0 ? (
          <p className="text-sm text-veridan-warm-gray">No content changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-veridan-warm-gray-light rounded-md border border-veridan-warm-gray-light bg-white">
            {auditRows.map((row) => (
              <li key={row.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-mono text-xs text-veridan-ink">{row.content_key}</p>
                  <p className="text-xs text-veridan-warm-gray">
                    {new Date(row.changed_at).toLocaleString("en-JM", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                {row.reason && (
                  <p className="mt-1 text-xs italic text-veridan-warm-gray">“{row.reason}”</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
