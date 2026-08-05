-- ============================================================================
-- Veridan Limited — Marketing frameworks: brand logos, install-photo
-- gallery, consultation booking link (all founder-populated later)
-- 2026-08-05.
--
-- Three "founder-populates-it-later" frameworks, each additive-only and
-- seeded so the live site's appearance changes by exactly zero until a
-- founder adds content from /admin/content:
--
--   Framework A — optional per-brand logo on `brands_supplied`. No schema
--     change to site_content itself (the row already stores a free-form
--     jsonb value) — just a new PUBLIC Storage bucket for the logo files.
--     The existing brands_supplied row is left completely untouched by this
--     migration; its stored shape (string[] of names) keeps validating
--     (lib/brands/normalize.ts) exactly as it does today.
--
--   Framework B — a new `install_gallery` site_content row (seeded empty,
--     same "founder-populates-it-later" discipline as `testimonials`) plus
--     a new PUBLIC Storage bucket for the install photos.
--
--   Framework C — a new `consultation_booking` site_content row (seeded
--     with an empty url — no Storage bucket needed).
--
-- Both new Storage buckets follow the ONE precedent for a public bucket in
-- this schema, `article-hero-images`
-- (20260723000001_articles_workspace.sql): public: true, anon gets SELECT
-- ONLY, scoped narrowly with `bucket_id = '<this bucket>'` — no anon
-- INSERT/UPDATE/DELETE on any bucket anywhere in this schema, still true
-- after this migration. `authenticated` (founders) gets full CRUD, same as
-- every other bucket.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Storage buckets
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('brand-logos', 'brand-logos', true),
  ('install-photos', 'install-photos', true)
on conflict (id) do nothing;

-- brand-logos: founders manage (upload/replace/remove).
create policy brand_logos_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'brand-logos')
  with check (bucket_id = 'brand-logos');

-- brand-logos: anon SELECT only, scoped to this bucket alone.
create policy brand_logos_anon_select on storage.objects
  for select to anon
  using (bucket_id = 'brand-logos');

-- install-photos: founders manage (upload/replace/remove).
create policy install_photos_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'install-photos')
  with check (bucket_id = 'install-photos');

-- install-photos: anon SELECT only, scoped to this bucket alone.
create policy install_photos_anon_select on storage.objects
  for select to anon
  using (bucket_id = 'install-photos');

-- ----------------------------------------------------------------------------
-- site_content seed rows — additive only. Both use `on conflict (key) do
-- nothing`, same idempotent-seed discipline as
-- 20260722000001_site_content.sql, so re-running this migration against a
-- database that already has these rows (e.g. a founder already saved a
-- value from /admin/content before this migration file was re-applied in a
-- fresh environment) never clobbers a real edit.
-- ----------------------------------------------------------------------------

insert into public.site_content (key, value, value_type, section_label, description) values
('install_gallery',
  '{"type":"table","value":[]}'::jsonb,
  'table',
  '"Our Work" completed-install photo gallery',
  'Photos of completed installs (image + optional caption) shown in the "Our Work" section on the home page. Seeded empty — the section stays hidden on the live site until a founder adds at least one photo from /admin/content.')
on conflict (key) do nothing;

insert into public.site_content (key, value, value_type, section_label, description) values
('consultation_booking',
  '{"type":"table","value":{"url":""}}'::jsonb,
  'table',
  '"Book a Consultation" link',
  'Optional booking link (e.g. a Microsoft Bookings URL) — when set, a "Book a Consultation" button appears on the Contact page and the home page''s closing CTA, opening in a new tab. Seeded empty — no button renders on the live site until a founder pastes a URL from /admin/content.')
on conflict (key) do nothing;
