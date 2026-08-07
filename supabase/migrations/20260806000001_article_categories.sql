-- ============================================================================
-- Veridan Limited — article_categories: an ADMIN-MANAGED create/rename/
-- delete list of article categories, seeded with the founder-approved
-- education-campaign set (founder decision 2026-08-06).
--
-- CRITICAL DESIGN CONSTRAINT (carried over from Phase 3B, 20260723000001_
-- articles_workspace.sql): `articles.category` STAYS a free-text column.
-- This migration does NOT touch that column — no type change, no FK, no
-- CHECK constraint, no backfill/UPDATE of any existing article row. This
-- table is a SUGGESTION/管理 (management) list the editor's category picker
-- reads from, not a referential constraint. An article whose category
-- string isn't (or is no longer) present in this table keeps working and
-- keeps displaying its category exactly as stored — see
-- lib/articles/categoryAdmin.ts's mergeManagedCategoriesWithLegacyValue,
-- which is what makes that guarantee hold at the UI layer, and
-- app/admin/articles/categories/actions.ts's deleteArticleCategory, which
-- only ever deletes the article_categories row itself.
--
-- Table/RLS shape and seeding style follow item_groups
-- (20260717000002_item_groups_and_product_variants.sql) for the founder_all
-- policy, and the anon-select policy style from articles
-- (20260723000001_articles_workspace.sql, articles_anon_select_published)
-- for the anon-select policy — except this table has no row-level gate at
-- all (every category is public by construction, same reasoning as
-- site_content_anon_select), so anon SELECT is blanket `using (true)`.
-- ============================================================================

create table public.article_categories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  slug         text not null unique,
  description  text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.article_categories is
  'Admin-managed suggestion list for the article editor''s category picker
   (founder decision 2026-08-06). articles.category remains free text and is
   NEVER migrated, backfilled, or constrained by this table — deleting a row
   here only removes it from future pickers; it never modifies or orphans
   any article. See lib/articles/categoryAdmin.ts and
   app/admin/articles/categories/.';

create trigger set_updated_at before update on public.article_categories
  for each row execute function public.set_updated_at();

create index idx_article_categories_sort_order on public.article_categories (sort_order);

alter table public.article_categories enable row level security;

-- Founders: full CRUD (§10: two founders, both full CRUD — same pattern as
-- item_groups_founder_all).
create policy article_categories_founder_all on public.article_categories
  for all to authenticated using (true) with check (true);

-- Anon SELECT only — the public /articles page reads this list to order its
-- category filter chips (lib/articles/categoriesLoader.ts). No anon write
-- of any kind. Blanket `using (true)` is deliberate: every row here is a
-- category label/description a founder chose to publish, public by
-- construction (same reasoning as site_content_anon_select
-- 20260722000001_site_content.sql) — unlike articles_anon_select_published,
-- there is no draft/review/published row-state to scope against here.
create policy article_categories_anon_select on public.article_categories
  for select to anon
  using (true);

grant select, insert, update, delete on public.article_categories to authenticated;
grant select on public.article_categories to anon;

-- ----------------------------------------------------------------------------
-- Seed: the 8 founder-approved education-campaign categories
-- (founder decision 2026-08-06, superseding the Phase 3B curated list in
-- lib/articles/categories.ts, which is updated in the same change to match
-- these names verbatim so the fallback-constant stays in sync with the
-- seed). `on conflict (name) do nothing` — idempotent, and deliberately
-- does NOT overwrite a founder's own edits (rename/description/reorder) on
-- a re-run of this migration.
-- ----------------------------------------------------------------------------
insert into public.article_categories (name, slug, description, sort_order)
values
  ('Hardware Fundamentals', 'hardware-fundamentals',
   'Ground zero: what commercial hardware is and how a door opening works.', 1),
  ('Grades & Standards', 'grades-standards',
   'ANSI/BHMA grades, cycle testing, and what certifications actually mean.', 2),
  ('Finishes & Materials', 'finishes-materials',
   'Finish codes, stainless grades, corrosion resistance, and aesthetics.', 3),
  ('Fire Safety & Compliance', 'fire-safety-compliance',
   'Fire-rated assemblies, egress, panic hardware, and inspections.', 4),
  ('Specifying for Jamaica', 'specifying-for-jamaica',
   'Salt air, humidity, hurricanes, power reliability, and hospitality.', 5),
  ('Cost & Value', 'cost-value',
   'Lifecycle cost, value-engineering risk, warranty, and liability.', 6),
  ('Product Spotlights', 'product-spotlights',
   'Deep dives on specific products and why they are specified.', 7),
  ('Project Stories', 'project-stories',
   'Real Veridan installations, start to finish.', 8)
on conflict (name) do nothing;
