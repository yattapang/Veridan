-- ============================================================================
-- Veridan Limited — managed_taxonomies: ADMIN-MANAGED create/rename/delete
-- lists for two founder pain points (founder feedback 2026-08-07):
--   "Under the companies tab, the company type does not allow the admin to
--   edit, create, or delete company types."
--   "Under the products tab ... Product Category should also allow addition
--   of New Categories in the drop down."
--
-- ROOT CAUSE: both `companies.type` and `products.generic_category` were
-- CHECK-constrained text columns (20260713000001_schema.sql lines ~74 and
-- ~109-110) — a fixed, hardcoded value set with no way to add an option
-- short of a schema migration.
--
-- FIX, following the exact pattern just built and reviewed for article
-- categories (20260806000001_article_categories.sql / lib/articles/
-- categoryAdmin.ts / app/admin/articles/categories/): add a small
-- admin-managed lookup table per taxonomy, and DROP the CHECK constraint so
-- `companies.type` / `products.generic_category` accept any value again.
-- Both columns STAY plain text — no FK, no re-CHECK, no backfill/UPDATE of
-- any existing row. A row holding a value that's no longer in the managed
-- list (or was never in it) keeps working and keeps displaying exactly as
-- stored — see lib/taxonomies/taxonomyAdmin.ts's buildTaxonomyOptions,
-- which is what makes that guarantee hold at the UI layer, and the delete
-- actions in app/admin/companies/types/actions.ts and
-- app/admin/products/categories/actions.ts, which only ever delete the
-- lookup-table row itself.
--
-- Table/RLS shape mirrors article_categories, EXCEPT: these are internal
-- admin taxonomies (not consumed by any public page), so there is no
-- anon-select policy and no anon grant at all — same reasoning as
-- item_groups_founder_all (20260717000002_item_groups_and_product_
-- variants.sql), which also has no public-facing consumer.
--
-- product_categories_admin is named to NOT be confused with the unrelated
-- marketing `product_categories` site_content section (a totally different
-- concept — landing-page copy blocks, see lib/site-content-db/types.ts) —
-- this table backs the Hardware Library product form's Category picker.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- company_types — admin-managed replacement for the fixed
-- companies.type CHECK list. `name` is the stored value written to
-- companies.type (e.g. 'architect'); `label` is what the UI displays
-- (e.g. 'Architect').
-- ----------------------------------------------------------------------------
create table public.company_types (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  label        text not null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.company_types is
  'Admin-managed picker options for companies.type (founder feedback
   2026-08-07). companies.type remains free text and is NEVER migrated,
   backfilled, or constrained by this table — deleting a row here only
   removes it from future pickers; it never modifies or orphans any
   company. See lib/taxonomies/taxonomyAdmin.ts and
   app/admin/companies/types/.';

create trigger set_updated_at before update on public.company_types
  for each row execute function public.set_updated_at();

create index idx_company_types_sort_order on public.company_types (sort_order);

alter table public.company_types enable row level security;

-- Founders: full CRUD (§10: two founders, both full CRUD — same pattern as
-- item_groups_founder_all / article_categories_founder_all). No anon grant —
-- this is an internal admin taxonomy, not consumed by any public page.
create policy company_types_founder_all on public.company_types
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.company_types to authenticated;

-- Seed: the 5 existing values, labels matched verbatim to today's UI
-- (app/admin/companies/CompanyForm.tsx's TYPE_LABELS / app/admin/companies/
-- page.tsx's TYPE_LABELS). `on conflict (name) do nothing` — idempotent, and
-- deliberately does NOT overwrite a founder's own edits on a re-run.
insert into public.company_types (name, label, sort_order)
values
  ('architect', 'Architect', 1),
  ('contractor', 'Contractor', 2),
  ('owner', 'Owner', 3),
  ('fm', 'Facilities Management', 4),
  ('supplier_contact', 'Supplier contact', 5)
on conflict (name) do nothing;

-- Drop the CHECK constraint that made new company types impossible. Default
-- auto-generated name for an inline column CHECK with no explicit name.
alter table public.companies drop constraint if exists companies_type_check;

-- ----------------------------------------------------------------------------
-- product_categories_admin — admin-managed replacement for the fixed
-- products.generic_category CHECK list. Same name/label/sort_order shape as
-- company_types. NOT the marketing `product_categories` site_content
-- section (unrelated) — see header note above.
-- ----------------------------------------------------------------------------
create table public.product_categories_admin (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  label        text not null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.product_categories_admin is
  'Admin-managed picker options for products.generic_category (founder
   feedback 2026-08-07). NOT the marketing product_categories site_content
   section (unrelated). products.generic_category remains free text and is
   NEVER migrated, backfilled, or constrained by this table — deleting a
   row here only removes it from future pickers; it never modifies or
   orphans any product. See lib/taxonomies/taxonomyAdmin.ts and
   app/admin/products/categories/.';

create trigger set_updated_at before update on public.product_categories_admin
  for each row execute function public.set_updated_at();

create index idx_product_categories_admin_sort_order on public.product_categories_admin (sort_order);

alter table public.product_categories_admin enable row level security;

create policy product_categories_admin_founder_all on public.product_categories_admin
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.product_categories_admin to authenticated;

-- Seed: the existing generic_category values + human labels, matched
-- verbatim to today's UI (app/admin/products/ProductForm.tsx's
-- CATEGORY_LABELS / app/admin/products/page.tsx's CATEGORY_LABELS).
insert into public.product_categories_admin (name, label, sort_order)
values
  ('locksets', 'Locksets', 1),
  ('closers', 'Closers', 2),
  ('hinges', 'Hinges', 3),
  ('exit_devices', 'Exit devices', 4),
  ('access_control', 'Access control', 5),
  ('ironmongery', 'Ironmongery', 6),
  ('signage', 'Signage', 7),
  ('frames', 'Frames', 8),
  ('other', 'Other', 9)
on conflict (name) do nothing;

-- Drop the CHECK constraint that made new product categories impossible.
alter table public.products drop constraint if exists products_generic_category_check;
