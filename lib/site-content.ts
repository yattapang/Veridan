/**
 * Marketing site content.
 *
 * TODO(Phase 1.5, PRD §5.3): this file holds all "changeable" marketing copy
 * (testimonials, brand list, taglines, contact details) as hardcoded typed
 * constants for Phase 1. The PRD flags this content as eventually editable
 * from the admin via a `site_content` DB table (see Build Plan §1.18-style
 * future table, PRD §5.3: "Marketing copy that will change ... lives in the
 * database and is editable from the admin"). When that table ships, replace
 * the exports below with a data-fetching layer that reads from Supabase,
 * keeping the same shapes so components don't need to change.
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

export const navLinks = [
  { href: "/", label: "Home" },
  { href: "/new-construction", label: "New Construction" },
  { href: "/retrofit", label: "Retrofit & Replacement" },
  { href: "/products", label: "Products" },
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
