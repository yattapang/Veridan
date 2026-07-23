/**
 * Marketing site content.
 *
 * FALLBACK ONLY since Phase 3A (2026-07-22): 9 of the sections below —
 * siteMeta (editable subset), contactInfo, brandsSupplied, trustSignals,
 * testimonials, serviceLines, productCategories, founders, aboutStory — are
 * now admin-editable from /admin/content, backed by the `site_content` table
 * (supabase/migrations/20260722000001_site_content.sql) and read through
 * lib/site-content-db/loader.ts. The exports below are used ONLY as the
 * fallback when a DB row is missing, a Supabase call errors, or a row's
 * shape doesn't validate — same discipline as invoicePaymentInstructions
 * below / lib/invoices/paymentInstructions.ts. Do not delete or reshape
 * these constants; marketing pages depend on them staying byte-identical to
 * what the seed migration copied.
 *
 * navLinks, primaryCta, and quoteRequestRoutes are DELIBERATELY excluded
 * from that migration (Phase3 Plan §1.4: routing/structural, not "content
 * that will change") and stay hardcoded here permanently — components keep
 * importing them directly from this file, no loader involved.
 */

export const siteMeta = {
  name: "Veridan Limited",
  legalName: "Veridan Limited",
  wordmark: "VERIDAN",
  tagline: "Verified Quality. Delivered.",
  domain: "veridanlimited.com",
  siteUrl: "https://www.veridanlimited.com",
  positioning: "Jamaica's premium commercial hardware specialist",
  locality: "Kingston, Jamaica",
  description:
    "Veridan Limited is Jamaica's premium commercial hardware specialist, supplying architect-specified, internationally certified door hardware and ironmongery to architects, contractors, and building owners across Jamaica.",
} as const;

// Founder-confirmed 2026-07-16: quotes@ is the public quote/contact address.
// All @veridanlimited.com addresses are currently aliases to one GoDaddy
// mailbox; they will be separated into real mailboxes as the team expands.
// TODO(founder input needed): WhatsApp Business number for a working wa.me link.
export const contactInfo = {
  email: "quotes@veridanlimited.com",
  whatsappBusinessLabel: "WhatsApp Business",
  // TODO(founder input needed): provide the WhatsApp Business number so this
  // can become a working https://wa.me/<number> link.
  whatsappBusinessNote:
    "WhatsApp Business number to be added by the founders before launch.",
  location: "Kingston, Jamaica",
} as const;

// Founder-confirmed 2026-07-16: enquiry notifications go to kaydean@ (Kay-Dean
// runs sales; kenyatta@ also exists — add it here if Kenyatta wants direct
// copies). All aliases currently deliver to one shared mailbox, so both
// founders see every enquiry today; the split becomes real after expansion.
export const enquiryNotificationRecipients = [
  "kaydean@veridanlimited.com",
] as const;

// Phase 3B (2026-07-23): "Articles" added — a structural nav change, not
// content (Plan §2.5: "Add 'Articles' to the marketing nav ... this IS a
// structural nav change, acceptable here"). navLinks itself stays hardcoded
// per the Phase 3A exclusion above; only its entries changed.
export const navLinks = [
  { href: "/", label: "Home" },
  { href: "/new-construction", label: "New Construction" },
  { href: "/retrofit", label: "Retrofit & Replacement" },
  { href: "/products", label: "Products" },
  { href: "/articles", label: "Articles" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

export const primaryCta = {
  label: "Request a Quote",
  href: "/quote-request",
} as const;

// Brand list — manufacturers Veridan sources from. Per PRD §5.1 trust signals
// and §5.1 Products page requirement. TODO: confirm exhaustive/final list and
// any brand usage-rights constraints (logos) with founders before using logo
// marks (text-only for now).
export const brandsSupplied = [
  "Assa Abloy",
  "Allegion",
  "Schlage",
  "Consort",
  "LCN",
  "Von Duprin",
] as const;

export const originsSupplied = [
  { region: "United States", note: "Miami-consolidated shipments" },
  { region: "United Kingdom", note: "Consort and Trudoor-network suppliers" },
  { region: "Canada", note: "Fort Erie-consolidated shipments" },
] as const;

export const trustSignals = [
  {
    title: "First order completed",
    body: "Veridan has already delivered a full commercial hardware package end-to-end — from specification review to site delivery with warranty documentation.",
  },
  {
    title: "Multi-origin supply chain",
    body: "A proven logistics footprint spanning the US, UK, and Canada — built on dual Jamaican-Canadian citizenship and direct manufacturer/distributor relationships.",
  },
  {
    title: "Manufacturer warranties",
    body: "Every item ships with full manufacturer warranty documentation, so owners and contractors have recourse long after handover.",
  },
] as const;

// Placeholder testimonial content — TODO(founder input needed): replace with
// a real client testimonial once available; do not publish a fabricated
// quote. Structure kept here so it is trivial to swap or move to the DB.
export const testimonials: Array<{
  quote: string;
  attribution: string;
}> = [
  // Intentionally empty for launch — no testimonial exists yet
  // (first order only recently completed). Add here when available.
];

export const serviceLines = [
  {
    key: "new-construction",
    title: "New Construction",
    href: "/new-construction",
    summary:
      "Full specification procurement for architects and contractors — from architect's hardware schedule to an itemised, landed-cost quote and managed import.",
  },
  {
    key: "retrofit",
    title: "Retrofit & Replacement",
    href: "/retrofit",
    summary:
      "Commercial-grade replacement hardware for building owners, facilities managers, and the contractors sourcing on their instruction.",
  },
] as const;

export const productCategories = [
  {
    key: "locksets",
    title: "Locksets & Deadbolts",
    description:
      "Cylindrical and mortise locksets, deadbolts, and lever handle sets specified to commercial grade, in a range of finishes.",
    brands: ["Assa Abloy", "Schlage"],
  },
  {
    key: "closers",
    title: "Door Closers",
    description:
      "Surface-mounted and concealed door closers sized to door mass and traffic, including fire-rated and accessible-compliant options.",
    brands: ["LCN", "Consort"],
  },
  {
    key: "hinges",
    title: "Hinges & Pivots",
    description:
      "Ball-bearing hinges, continuous hinges, and pivot sets rated for commercial door weights and duty cycles.",
    brands: ["Consort", "Assa Abloy"],
  },
  {
    key: "exit-devices",
    title: "Exit Devices",
    description:
      "Panic and fire exit hardware for life-safety egress compliance, rim, surface-vertical-rod, and concealed-vertical-rod configurations.",
    brands: ["Von Duprin", "Allegion"],
  },
  {
    key: "access-control",
    title: "Access Control",
    description:
      "Electrified locking hardware and access control-ready components that integrate with a building's security system.",
    brands: ["Allegion", "Schlage"],
  },
  {
    key: "ironmongery",
    title: "Architectural Ironmongery",
    description:
      "Door stops, flush bolts, push/pull hardware, kick plates, and the full range of specified architectural ironmongery.",
    brands: ["Assa Abloy", "Consort"],
  },
  {
    key: "frames",
    title: "Door Frames & Accessories",
    description:
      "Hollow metal and specialty door frames plus the accessories that complete a fully specified door opening.",
    brands: ["Consort"],
  },
  {
    key: "signage",
    title: "Bathroom & Amenity Signage",
    description:
      "Code-compliant washroom, amenity, and wayfinding signage to match a building's finish schedule.",
    brands: [],
  },
] as const;

export const founders = [
  {
    name: "Ken Yatta",
    role: "Co-Founder — Operations & Procurement",
    bio: "Ken brings an engineering background and an MBA to Veridan's procurement and operations, translating architects' hardware schedules into precise, landed-cost quotes and managing the multi-origin import process end-to-end.",
  },
  {
    name: "Kaylia",
    role: "Co-Founder — Sales & Marketing",
    bio: "Kaylia holds an MBA in sales and marketing and leads Veridan's client relationships — working with architects, contractors, and building owners from first enquiry through to delivery.",
  },
] as const;

export const aboutStory = {
  heading: "Built to close Jamaica's commercial hardware gap",
  body: [
    "Architects across Jamaica routinely specify internationally certified hardware — Assa Abloy, Allegion, Schlage, Consort, LCN, Von Duprin — on commercial projects. Until Veridan, there was no dedicated local supplier built to source, land, and deliver that exact specification.",
    "Veridan was founded by Ken Yatta and Kaylia to close that gap: a Kingston-based specialist with a proven multi-origin supply chain across the United States, United Kingdom, and Canada, built on the founders' dual Jamaican-Canadian citizenship.",
    "The company has already delivered its first order end-to-end — from specification review through managed import to site delivery with full warranty documentation — proving the model works before scaling it.",
  ],
} as const;

export const quoteRequestRoutes = {
  newConstruction: "/quote-request/new-construction",
  retrofit: "/quote-request/retrofit",
} as const;

// FALLBACK ONLY since 2026-07-19: the live source of truth for bank details
// is the admin-editable "invoice_payment_instructions" business parameter
// (Admin → Parameters — founder request: bank details change over time and
// must be editable without a code change). This constant is used only when
// that parameter row is missing (e.g. migration unapplied); its TODO markers
// keep the send gate closed in that state. See
// lib/invoices/paymentInstructions.ts.
export const invoicePaymentInstructions = {
  bankName: "TODO founder: bank name",
  accountName: "Veridan Limited",
  accountNumber: "TODO founder: account number",
  branch: "TODO founder: branch",
  routingOrSwift: "TODO founder: routing / SWIFT code",
  note: "Bank details above are placeholders — founders to confirm real payment instructions before this invoice is sent to a client.",
} as const;

// The configured-check now lives in lib/invoices/paymentInstructionsCore.ts
// (pure) + lib/invoices/paymentInstructions.ts (parameter-backed loader).
