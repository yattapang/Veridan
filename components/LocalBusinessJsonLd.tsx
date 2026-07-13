import { siteMeta, contactInfo } from "@/lib/site-content";

/**
 * LocalBusiness structured data (PRD §5.2). Rendered on the home page only.
 * Address is intentionally limited to locality/region (Kingston, Jamaica) —
 * TODO(founder input needed): add a precise street address / postal code
 * here once the founders confirm what should be publicly listed.
 */
export function LocalBusinessJsonLd() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: siteMeta.legalName,
    description: siteMeta.description,
    url: siteMeta.siteUrl,
    email: contactInfo.email,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Kingston",
      addressCountry: "JM",
    },
    areaServed: {
      "@type": "Country",
      name: "Jamaica",
    },
    slogan: siteMeta.tagline,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
