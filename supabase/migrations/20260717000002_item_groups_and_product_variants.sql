-- ============================================================================
-- Veridan Limited — Phase 2A: item_groups + product variant/filter columns
-- Source of truth: Veridan_Phase2_Plan_v1.md §1.4 (schema, migration-level
-- detail) and §8 FOUNDER RESOLUTIONS (grade = ANSI/BHMA Grade 1/2/3).
--
-- ADDITIVE ONLY. No change to hardware_set_line_items, quote_line_items, or
-- any existing FK — products.id remains the thing line items point to.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- item_groups — canonical "this is the same physical item" grouping key.
-- Lightweight lookup table (§1.3 Option i + additions), not the full
-- base_products/product_variants/supplier_offerings model (Option ii,
-- explicitly deferred).
-- ----------------------------------------------------------------------------
create table public.item_groups (
  id           uuid primary key default gen_random_uuid(),
  family_name  text not null, -- founder-facing name, e.g. "Commercial Lever Lockset"
  grade        text check (grade in ('Grade 1','Grade 2','Grade 3')), -- ANSI/BHMA grade (§8 Q2 RESOLVED); null if not applicable
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger set_updated_at before update on public.item_groups
  for each row execute function public.set_updated_at();
create index idx_item_groups_family_name on public.item_groups (family_name);

-- ----------------------------------------------------------------------------
-- products — additive columns only (§1.4). item_group_id is nullable:
-- grouping is opt-in and can be done retroactively. `on delete set null`
-- means deleting an item_groups row never corrupts a product row — it just
-- ungroups it (see item-groups UAT §6.1 item 6).
-- ----------------------------------------------------------------------------
alter table public.products
  add column item_group_id uuid references public.item_groups (id) on delete set null,
  add column finish_code   text,   -- e.g. "US32D", "US26D" — short filterable code, distinct from supplied_finish free text
  add column design_series text;   -- handle/design variant name, e.g. "Athens", "Rhodes"; null where not applicable

create index idx_products_item_group_id on public.products (item_group_id);
create index idx_products_finish_code on public.products (finish_code);

-- ----------------------------------------------------------------------------
-- item_group_merges — audit trail for Task 30's merge operation (§1.5,
-- §7 open question Q9: "purely forward-looking library operation" — the
-- merge itself is logged with counts/reason, but does not rewrite any
-- historical quote/hardware-set data, which never referenced item_groups
-- directly in the first place).
-- ----------------------------------------------------------------------------
create table public.item_group_merges (
  id                    uuid primary key default gen_random_uuid(),
  surviving_group_id    uuid not null references public.item_groups (id) on delete cascade,
  losing_group_family_name  text not null, -- snapshot — the losing row is deleted as part of the merge
  losing_group_grade        text,
  product_count         int not null, -- how many products.item_group_id rows were re-pointed
  reason                text,
  merged_by             uuid references public.users (id) on delete set null,
  merged_at             timestamptz not null default now()
);
create index idx_item_group_merges_surviving_group_id on public.item_group_merges (surviving_group_id);

-- ----------------------------------------------------------------------------
-- RLS — same founder_all pattern as every other table (§10: two founders,
-- both full CRUD).
-- ----------------------------------------------------------------------------
alter table public.item_groups       enable row level security;
alter table public.item_group_merges enable row level security;

create policy item_groups_founder_all on public.item_groups
  for all to authenticated using (true) with check (true);

create policy item_group_merges_founder_all on public.item_group_merges
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.item_groups, public.item_group_merges to authenticated;
