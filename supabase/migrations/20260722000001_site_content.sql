-- ============================================================================
-- Veridan Limited — Phase 3A: admin-editable site content
-- Source: Veridan_Phase3_Plan_v1.md §1.4 (schema), §1.2/§1.3 (Option (i) —
-- a business_parameters-shaped key/value table, chosen over per-section
-- relational tables at this scale — see plan for full rationale).
--
-- `site_content` mirrors `business_parameters` exactly (same envelope shape,
-- same value_type discipline, same audit-log pairing) so founders reuse a
-- mental model they already have from /admin/parameters. One row per
-- top-level marketing-copy section; list-shaped sections (testimonials,
-- founders, trust_signals, service_lines, product_categories,
-- brands_supplied) store a JSON array in that one row, same as
-- business_parameters.margin_tiers already does.
--
-- `navLinks`, `primaryCta`, and `quoteRequestRoutes` are DELIBERATELY NOT
-- included here — they are routing/structural, not "content that will
-- change" (plan §1.4), and stay hardcoded in lib/site-content.ts. Do not add
-- them to this table or to the seed insert below.
-- ============================================================================

create table public.site_content (
  key            text primary key,
  value          jsonb not null, -- envelope {"type":"table","value":<content>} — same shape as business_parameters.value
  value_type     text not null default 'table' check (value_type = 'table'), -- every site_content row is structured; no bare scalar rows (plan §1.4)
  section_label  text not null, -- founder-facing label for the admin UI, e.g. "Home page trust signals"
  description    text,
  updated_by     uuid references public.users (id) on delete set null,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create trigger set_updated_at before update on public.site_content
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- site_content_audit_log — identical shape to parameter_audit_log.
-- ----------------------------------------------------------------------------
create table public.site_content_audit_log (
  id              uuid primary key default gen_random_uuid(),
  content_key     text not null,
  old_value       jsonb,
  new_value       jsonb,
  changed_by      uuid not null references public.users (id) on delete restrict,
  changed_at      timestamptz not null default now(),
  reason          text
);
create index idx_site_content_audit_log_content_key on public.site_content_audit_log (content_key);
create index idx_site_content_audit_log_changed_by on public.site_content_audit_log (changed_by);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.site_content           enable row level security;
alter table public.site_content_audit_log enable row level security;

create policy site_content_founder_all on public.site_content
  for all to authenticated using (true) with check (true);

-- Audit log stays founder-only, no anon access at all — matches
-- parameter_audit_log_founder_all exactly (Plan §1.4: "audit log stays
-- founder-only, no anon").
create policy site_content_audit_log_founder_all on public.site_content_audit_log
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- *** FIRST ANON-SELECT RLS POLICY IN THIS APP ***
--
-- Every table in this schema up to now (see 20260713000002_rls.sql's header
-- comment) exposes exactly two shapes to the `anon` role: nothing, or a
-- narrow, column-restricted INSERT (enquiries_anon_insert_only). No table
-- has ever granted `anon` a SELECT. This policy is the first exception, and
-- is deliberately unrestricted (`using (true)`) rather than row- or
-- column-scoped: every row in `site_content` is, by construction, public
-- marketing copy that is meant to render on the public marketing site for an
-- unauthenticated visitor — there is no "should stay private" subset of this
-- table to protect, unlike enquiries_anon_insert_only's WITH CHECK (which
-- exists because an anonymous *submitter* must not set fields only a founder
-- should control). This is the precedent Phase 3B (articles, row-scoped to
-- status = 'published') and Phase 3C (catalogue_documents, row-scoped to
-- visibility = 'public') will each follow with their own narrower version of
-- this same shape.
--
-- READ-ONLY: anon gets SELECT only. No anon INSERT/UPDATE/DELETE policy
-- exists on this table, so RLS denies those outright (default-deny once RLS
-- is enabled) — a public visitor can read site content but can never write
-- to it. Verify this stays true on any future edit to this migration.
-- ============================================================================
create policy site_content_anon_select on public.site_content
  for select to anon
  using (true);

-- Explicit grants (mirrors 20260713000002_rls.sql's self-contained-grants
-- discipline). `authenticated` already has blanket
-- "grant select, insert, update, delete on all tables" from that migration,
-- so only the new anon SELECT grant is needed here.
grant select on public.site_content to anon;

-- ============================================================================
-- Seed migration — idempotent (insert ... on conflict (key) do nothing),
-- same style as 20260719000001_invoice_payment_instructions_param.sql.
--
-- Values below are copied VERBATIM from the current lib/site-content.ts
-- constants (siteMeta, contactInfo, brandsSupplied, trustSignals,
-- testimonials, serviceLines, productCategories, founders, aboutStory) so a
-- fresh migration produces byte-identical marketing pages to today. Only the
-- editable subset of each section is stored — e.g. site_meta stores
-- tagline/positioning/description/locality only; siteMeta's structural
-- fields (name, legalName, wordmark, domain, siteUrl) are NOT here and stay
-- hardcoded, merged back in by lib/site-content-db/loader.ts at read time.
-- 9 rows total (Task 59).
-- ============================================================================

insert into public.site_content (key, value, value_type, section_label, description) values
('site_meta',
  '{"type":"table","value":{"tagline":"Verified Quality. Delivered.","positioning":"Jamaica''s premium commercial hardware specialist","description":"Veridan Limited is Jamaica''s premium commercial hardware specialist, supplying architect-specified, internationally certified door hardware and ironmongery to architects, contractors, and building owners across Jamaica.","locality":"Kingston, Jamaica"}}'::jsonb,
  'table',
  'Home page site meta (tagline, positioning, description, locality)',
  'Editable subset of site metadata shown across marketing pages: tagline, positioning statement, meta description, and locality. Structural fields (legal name, wordmark, domain, canonical site URL) are NOT stored here and stay hardcoded in lib/site-content.ts.')
on conflict (key) do nothing;

insert into public.site_content (key, value, value_type, section_label, description) values
('contact_info',
  '{"type":"table","value":{"email":"quotes@veridanlimited.com","whatsappBusinessLabel":"WhatsApp Business","whatsappBusinessNote":"WhatsApp Business number to be added by the founders before launch.","location":"Kingston, Jamaica"}}'::jsonb,
  'table',
  'Contact page details (email, WhatsApp, location)',
  'Public contact details shown on the Contact page, site footer, and LocalBusiness structured data: email, WhatsApp Business label/number note, and location.')
on conflict (key) do nothing;

insert into public.site_content (key, value, value_type, section_label, description) values
('brands_supplied',
  '{"type":"table","value":["Assa Abloy","Allegion","Schlage","Consort","LCN","Von Duprin"]}'::jsonb,
  'table',
  'Home page brand strip',
  'Manufacturer brand names shown in the home page brand strip and referenced by Product Categories.')
on conflict (key) do nothing;

insert into public.site_content (key, value, value_type, section_label, description) values
('trust_signals',
  '{"type":"table","value":[{"title":"First order completed","body":"Veridan has already delivered a full commercial hardware package end-to-end — from specification review to site delivery with warranty documentation."},{"title":"Multi-origin supply chain","body":"A proven logistics footprint spanning the US, UK, and Canada — built on dual Jamaican-Canadian citizenship and direct manufacturer/distributor relationships."},{"title":"Manufacturer warranties","body":"Every item ships with full manufacturer warranty documentation, so owners and contractors have recourse long after handover."}]}'::jsonb,
  'table',
  'Home page trust signals',
  'The three trust-signal cards shown on the home page (title + body).')
on conflict (key) do nothing;

insert into public.site_content (key, value, value_type, section_label, description) values
('testimonials',
  '{"type":"table","value":[]}'::jsonb,
  'table',
  'Home page testimonials',
  'Client testimonials (quote + attribution) shown on the home page. Seeded empty for launch — no testimonial exists yet.')
on conflict (key) do nothing;

insert into public.site_content (key, value, value_type, section_label, description) values
('service_lines',
  '{"type":"table","value":[{"key":"new-construction","title":"New Construction","href":"/new-construction","summary":"Full specification procurement for architects and contractors — from architect''s hardware schedule to an itemised, landed-cost quote and managed import."},{"key":"retrofit","title":"Retrofit & Replacement","href":"/retrofit","summary":"Commercial-grade replacement hardware for building owners, facilities managers, and the contractors sourcing on their instruction."}]}'::jsonb,
  'table',
  'Home page service lines',
  'The two service-line cards shown on the home page (key, title, link path, summary).')
on conflict (key) do nothing;

insert into public.site_content (key, value, value_type, section_label, description) values
('product_categories',
  '{"type":"table","value":[{"key":"locksets","title":"Locksets & Deadbolts","description":"Cylindrical and mortise locksets, deadbolts, and lever handle sets specified to commercial grade, in a range of finishes.","brands":["Assa Abloy","Schlage"]},{"key":"closers","title":"Door Closers","description":"Surface-mounted and concealed door closers sized to door mass and traffic, including fire-rated and accessible-compliant options.","brands":["LCN","Consort"]},{"key":"hinges","title":"Hinges & Pivots","description":"Ball-bearing hinges, continuous hinges, and pivot sets rated for commercial door weights and duty cycles.","brands":["Consort","Assa Abloy"]},{"key":"exit-devices","title":"Exit Devices","description":"Panic and fire exit hardware for life-safety egress compliance, rim, surface-vertical-rod, and concealed-vertical-rod configurations.","brands":["Von Duprin","Allegion"]},{"key":"access-control","title":"Access Control","description":"Electrified locking hardware and access control-ready components that integrate with a building''s security system.","brands":["Allegion","Schlage"]},{"key":"ironmongery","title":"Architectural Ironmongery","description":"Door stops, flush bolts, push/pull hardware, kick plates, and the full range of specified architectural ironmongery.","brands":["Assa Abloy","Consort"]},{"key":"frames","title":"Door Frames & Accessories","description":"Hollow metal and specialty door frames plus the accessories that complete a fully specified door opening.","brands":["Consort"]},{"key":"signage","title":"Bathroom & Amenity Signage","description":"Code-compliant washroom, amenity, and wayfinding signage to match a building''s finish schedule.","brands":[]}]}'::jsonb,
  'table',
  'Products page categories',
  'The product category cards shown on the Products page (key, title, description, brands).')
on conflict (key) do nothing;

insert into public.site_content (key, value, value_type, section_label, description) values
('founders',
  '{"type":"table","value":[{"name":"Ken Yatta","role":"Co-Founder — Operations & Procurement","bio":"Ken brings an engineering background and an MBA to Veridan''s procurement and operations, translating architects'' hardware schedules into precise, landed-cost quotes and managing the multi-origin import process end-to-end."},{"name":"Kaylia","role":"Co-Founder — Sales & Marketing","bio":"Kaylia holds an MBA in sales and marketing and leads Veridan''s client relationships — working with architects, contractors, and building owners from first enquiry through to delivery."}]}'::jsonb,
  'table',
  'About page founder bios',
  'Founder name, role, and bio shown on the About page.')
on conflict (key) do nothing;

insert into public.site_content (key, value, value_type, section_label, description) values
('about_story',
  '{"type":"table","value":{"heading":"Built to close Jamaica''s commercial hardware gap","body":["Architects across Jamaica routinely specify internationally certified hardware — Assa Abloy, Allegion, Schlage, Consort, LCN, Von Duprin — on commercial projects. Until Veridan, there was no dedicated local supplier built to source, land, and deliver that exact specification.","Veridan was founded by Ken Yatta and Kaylia to close that gap: a Kingston-based specialist with a proven multi-origin supply chain across the United States, United Kingdom, and Canada, built on the founders'' dual Jamaican-Canadian citizenship.","The company has already delivered its first order end-to-end — from specification review through managed import to site delivery with full warranty documentation — proving the model works before scaling it."]}}'::jsonb,
  'table',
  'About page story',
  'The About page heading and body paragraphs.')
on conflict (key) do nothing;
