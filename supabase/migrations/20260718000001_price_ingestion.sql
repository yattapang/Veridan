-- ============================================================================
-- Phase 2B Task 35 — Price ingestion schema delta (Phase2 Plan §2.2, §2.4)
--
-- price_file_uploads and extracted_prices ALREADY EXIST: the Phase 1 schema
-- migration (20260713000001) pre-created every Build Plan §1.18 table. This
-- migration is therefore a DELTA that upgrades those base shapes to the
-- Phase 2B plan's spec, plus the new product_price_history table and the
-- extraction confidence threshold parameter.
--
-- Both tables are empty in every environment (the upload UI ships after this
-- migration), so CHECK-constraint replacement and default changes are safe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- price_file_uploads — upgrade to Plan §2.2 Stage 1 / §2.4 shape
-- ----------------------------------------------------------------------------
-- supplier unknown until detected/confirmed (Plan: nullable, set-null on delete)
alter table public.price_file_uploads
  drop constraint price_file_uploads_supplier_id_fkey;
alter table public.price_file_uploads
  alter column supplier_id drop not null;
alter table public.price_file_uploads
  add constraint price_file_uploads_supplier_id_fkey
    foreign key (supplier_id) references public.suppliers (id) on delete set null;

alter table public.price_file_uploads
  add column original_filename text,
  add column detected_supplier_confidence numeric,  -- Plan §2.4: surfaces uncertain supplier auto-detection
  add column error_message text;

-- richer extraction lifecycle (empty table — safe to replace)
alter table public.price_file_uploads
  drop constraint price_file_uploads_extraction_status_check;
alter table public.price_file_uploads
  add constraint price_file_uploads_extraction_status_check
    check (extraction_status in ('pending','extracting','review','completed','failed'));

create index idx_price_file_uploads_uploaded_by on public.price_file_uploads (uploaded_by);

-- ----------------------------------------------------------------------------
-- extracted_prices — upgrade to Plan §2.2 Stage 2–3 / §2.4 shape
-- ----------------------------------------------------------------------------
alter table public.extracted_prices
  add column item_group_match_id uuid references public.item_groups (id) on delete set null, -- cross-supplier match
  add column proposed_description text,
  add column proposed_product_ref text,
  add column proposed_qty numeric,
  add column confidence_threshold_used numeric, -- snapshot: later threshold tuning never reclassifies old reviews
  add column reviewed_at timestamptz;

-- review lifecycle per Plan §2.2 Stage 3 (empty table — safe to replace)
alter table public.extracted_prices
  drop constraint extracted_prices_review_status_check;
alter table public.extracted_prices
  alter column review_status set default 'needs_review';
alter table public.extracted_prices
  add constraint extracted_prices_review_status_check
    check (review_status in ('confident','needs_review','accepted','edited','rejected'));
-- raw source line is required for audit from here on (empty table — safe)
alter table public.extracted_prices
  alter column raw_extracted_text set not null;

create index idx_extracted_prices_item_group_match_id on public.extracted_prices (item_group_match_id);

-- ----------------------------------------------------------------------------
-- product_price_history (new — Plan §2.2 Stage 4a recommended history table)
-- ----------------------------------------------------------------------------
create table public.product_price_history (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products (id) on delete cascade,
  price_file_upload_id  uuid references public.price_file_uploads (id) on delete set null, -- null = manual edit
  unit_cost             numeric not null,
  cost_currency         text not null check (cost_currency in ('USD','CAD','JMD','EUR','GBP')),
  effective_date        date not null default current_date,
  recorded_by           uuid references public.users (id) on delete set null,
  created_at            timestamptz not null default now()
);
create index idx_product_price_history_product_id on public.product_price_history (product_id);
create index idx_product_price_history_upload_id on public.product_price_history (price_file_upload_id);

alter table public.product_price_history enable row level security;
create policy product_price_history_founder_all on public.product_price_history
  for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Parameter: extraction confidence threshold (Plan §8 Q5 — start conservative,
-- admin-editable, tune later)
-- ----------------------------------------------------------------------------
insert into public.business_parameters (key, value, value_type, description) values
('extraction_confidence_threshold',
  '{"type":"numeric","value":0.85}'::jsonb,
  'numeric',
  'Extraction rows below this confidence (0-1) are held for review rather than usable directly (PRD §9.1 flagged-only review; Phase2 Plan §8 Q5 — start conservative, tune later).')
on conflict (key) do nothing;
