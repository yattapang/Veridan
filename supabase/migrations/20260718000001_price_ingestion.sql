-- ============================================================================
-- Phase 2B Task 35 — Price ingestion schema (Phase2 Plan §2.2 Stage 1–2, §2.4)
--
-- Three tables backing the supplier quote scanner:
--   price_file_uploads    — one row per uploaded supplier file (PDF/Excel/CSV/photo)
--   extracted_prices      — one row per extracted line item, with match + confidence
--   product_price_history — non-lossy price provenance (scan or manual edit)
--
-- The `price-files` storage bucket + founder-only policies already exist from
-- 20260713000002_rls.sql (created ahead of time in Phase 1) — not recreated here.
--
-- Additive-only: no changes to any existing table other than one new
-- business_parameters seed row (extraction_confidence_threshold).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- price_file_uploads
-- ----------------------------------------------------------------------------
create table public.price_file_uploads (
  id                            uuid primary key default gen_random_uuid(),
  supplier_id                   uuid references public.suppliers (id) on delete set null, -- null until detected/confirmed
  file_storage_path             text not null,
  original_filename             text,
  uploaded_by                   uuid references public.users (id) on delete set null,
  uploaded_at                   timestamptz not null default now(),
  extraction_status             text not null default 'pending'
                                  check (extraction_status in ('pending','extracting','review','completed','failed')),
  detected_supplier_confidence  numeric,          -- surfaces uncertain supplier auto-detection (Plan §2.4)
  error_message                 text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger set_updated_at before update on public.price_file_uploads
  for each row execute function public.set_updated_at();
create index idx_price_file_uploads_supplier_id on public.price_file_uploads (supplier_id);
create index idx_price_file_uploads_uploaded_by on public.price_file_uploads (uploaded_by);
create index idx_price_file_uploads_extraction_status on public.price_file_uploads (extraction_status);

-- ----------------------------------------------------------------------------
-- extracted_prices
-- ----------------------------------------------------------------------------
create table public.extracted_prices (
  id                          uuid primary key default gen_random_uuid(),
  price_file_upload_id        uuid not null references public.price_file_uploads (id) on delete cascade,
  matched_product_id          uuid references public.products (id) on delete set null,
  item_group_match_id         uuid references public.item_groups (id) on delete set null, -- cross-supplier match (Plan §2.4)
  raw_extracted_text          jsonb not null,   -- full raw line for audit (Plan §2.2 Stage 2)
  proposed_description        text,
  proposed_product_ref        text,
  proposed_qty                numeric,
  proposed_unit_cost          numeric,
  proposed_currency           text check (proposed_currency in ('USD','CAD','JMD','EUR','GBP')),
  confidence_score            numeric,
  confidence_threshold_used   numeric,          -- snapshot so later threshold tuning never reclassifies old reviews (Plan §2.4)
  review_status               text not null default 'needs_review'
                                check (review_status in ('confident','needs_review','accepted','edited','rejected')),
  reviewed_by                 uuid references public.users (id) on delete set null,
  reviewed_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create trigger set_updated_at before update on public.extracted_prices
  for each row execute function public.set_updated_at();
create index idx_extracted_prices_upload_id on public.extracted_prices (price_file_upload_id);
create index idx_extracted_prices_matched_product_id on public.extracted_prices (matched_product_id);
create index idx_extracted_prices_item_group_match_id on public.extracted_prices (item_group_match_id);
create index idx_extracted_prices_review_status on public.extracted_prices (review_status);

-- ----------------------------------------------------------------------------
-- product_price_history (Plan §2.2 Stage 4a — recommended history table)
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

-- ----------------------------------------------------------------------------
-- RLS — founder_all per repo convention
-- ----------------------------------------------------------------------------
alter table public.price_file_uploads enable row level security;
alter table public.extracted_prices enable row level security;
alter table public.product_price_history enable row level security;

create policy price_file_uploads_founder_all on public.price_file_uploads
  for all to authenticated using (true) with check (true);
create policy extracted_prices_founder_all on public.extracted_prices
  for all to authenticated using (true) with check (true);
create policy product_price_history_founder_all on public.product_price_history
  for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Parameter: extraction confidence threshold (Plan §8 Q5 resolution —
-- start conservative at 0.85, admin-editable, tune later)
-- ----------------------------------------------------------------------------
insert into public.business_parameters (key, value, value_type, description) values
('extraction_confidence_threshold',
  '{"type":"numeric","value":0.85}'::jsonb,
  'numeric',
  'Extraction rows below this confidence (0-1) are held for review rather than usable directly (PRD §9.1 flagged-only review; Phase2 Plan §8 Q5 — start conservative, tune later).')
on conflict (key) do nothing;
