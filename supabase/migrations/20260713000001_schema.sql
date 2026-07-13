-- ============================================================================
-- Veridan Limited — Phase 1 schema migration
-- Source of truth: Veridan_Build_Plan_v1.md §1 (data model), §7 + §7.1 (ambiguity
-- resolutions, which override anything contradictory elsewhere in the PRD).
--
-- Conventions:
--   * All PKs: uuid primary key default gen_random_uuid()
--   * All tables: created_at / updated_at timestamptz default now() unless noted
--   * All money columns: numeric (never float)
--   * Status / classification fields: CHECK constraints (not native enum types,
--     so the founders/agents can extend the allowed set later with a simple
--     ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT instead of the more
--     awkward ALTER TYPE ... ADD VALUE dance for native enums).
--   * Tables are created in FK-dependency order. Two pairs are mutually
--     referential (enquiries <-> projects) and are resolved with an ALTER
--     TABLE ... ADD CONSTRAINT once both sides exist.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto on older Postgres; Supabase images ship
-- it enabled by default, but this is a harmless no-op if already present.
create extension if not exists pgcrypto;

-- updated_at trigger helper, reused by every table below.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1.17 Users / Roles (§10) — mirrors auth.users.id. Created early since many
-- other tables FK into it (created_by / updated_by / changed_by / etc).
-- ----------------------------------------------------------------------------
create table public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  display_name  text,
  role          text not null default 'founder', -- single role in Phase 1 ("both can do everything", §10); column exists now so Phase 3+ client-portal roles don't require a migration
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 1.1 Suppliers
-- ----------------------------------------------------------------------------
create table public.suppliers (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  country                  text,
  origin_region            text, -- groups suppliers into shipment origins per §6.3, e.g. "UK–Consort", "USA–Miami", "Canada–Fort Erie", "Other"; admin-editable list
  default_currency         text not null check (default_currency in ('USD','CAD','GBP','EUR','JMD')),
  default_lead_time_text   text, -- free text e.g. "4-8 weeks"; falls back to parameter table's per-origin lead time if blank
  notes                    text,
  active                   boolean not null default true, -- soft-disable instead of delete (referenced by historical quotes)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 1.10 Companies
-- ----------------------------------------------------------------------------
create table public.companies (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  -- [ASSUMPTION §7 item 6, resolved §7.1 item 6]: type is company-level, single primary type.
  type                    text not null check (type in ('architect','contractor','owner','fm','supplier_contact')),
  status                  text not null default 'new' check (status in ('new','established')), -- drives deposit default; §7.1 item 7: manual override only, no auto-flip
  completed_order_count   int not null default 0, -- maintained for a possible future auto-flip rule; not used to auto-flip in Phase 1
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();
create index idx_companies_status on public.companies (status);

-- ----------------------------------------------------------------------------
-- 1.11 Contacts
-- ----------------------------------------------------------------------------
create table public.contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  first_name   text not null,
  last_name    text,
  email        text,
  phone        text,
  role_title   text,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
create index idx_contacts_company_id on public.contacts (company_id);

-- ----------------------------------------------------------------------------
-- 1.2 Products (Hardware Library)
-- ----------------------------------------------------------------------------
create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  generic_category   text not null check (generic_category in
                        ('locksets','closers','hinges','exit_devices','access_control','ironmongery','signage','frames','other')),
  description        text not null,
  catalogue_ref      text,
  specified_finish   text, -- what the architect's schedule calls for
  supplied_finish    text, -- what will actually ship; defaults to parameter default_finish
  manufacturer       text,
  product_ref        text, -- manufacturer/supplier SKU
  supplier_id        uuid references public.suppliers (id) on delete set null, -- default supplier for this product
  unit               text not null,
  unit_cost          numeric(12,4) not null,
  cost_currency      text not null check (cost_currency in ('USD','CAD','GBP','EUR','JMD')),
  source             text not null default 'manual' check (source in ('manual','price_file_extraction')),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create index idx_products_supplier_id on public.products (supplier_id);
create index idx_products_active on public.products (active);
create index idx_products_generic_category on public.products (generic_category);

-- ----------------------------------------------------------------------------
-- 1.12 Enquiries (portal intake, §5.4, §8)
-- project_id FK to projects is added later (ALTER TABLE) because projects
-- references enquiries too (mutual reference).
-- ----------------------------------------------------------------------------
create table public.enquiries (
  id                             uuid primary key default gen_random_uuid(),
  pathway                        text not null check (pathway in ('new_construction','retrofit')),
  company_name                   text, -- as typed by the submitter, pre-matching
  matched_company_id             uuid references public.companies (id) on delete set null, -- set once staff match/create the company record
  contact_name                   text not null,
  contact_email                  text not null,
  contact_phone                  text,
  project_details                text,
  delivery_timeframe             text,
  building_type                  text, -- retrofit-specific
  failing_hardware_description   text, -- retrofit-specific
  urgency_flag                   boolean not null default false, -- retrofit-specific
  retrofit_pathway               text check (retrofit_pathway in ('owner_direct','contractor_instructed')),
  uploaded_file_paths            jsonb, -- array of Supabase Storage paths (PDF/Excel/photo schedules)
  line_items_structured          jsonb, -- if submitted via structured entry instead of file upload
  honeypot_tripped                boolean not null default false, -- spam control (§5.4); record but do not necessarily block
  status                         text not null default 'new' check (status in ('new','reviewing','converted','discarded')),
  project_id                     uuid, -- FK added below once public.projects exists
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);
create trigger set_updated_at before update on public.enquiries
  for each row execute function public.set_updated_at();
create index idx_enquiries_status on public.enquiries (status);
create index idx_enquiries_matched_company_id on public.enquiries (matched_company_id);

-- ----------------------------------------------------------------------------
-- 1.5 Projects
-- ----------------------------------------------------------------------------
create table public.projects (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete restrict,
  primary_contact_id    uuid references public.contacts (id) on delete set null,
  architect_company_id  uuid references public.companies (id) on delete set null, -- separate from client company per workbook's "architect" field on quotes
  name                  text not null,
  site_address          text,
  project_type          text not null check (project_type in ('new_construction','retrofit')), -- determines quoting mode (§6.2)
  status                text not null default 'active' check (status in ('active','closed','archived')),
  enquiry_id            uuid references public.enquiries (id) on delete set null, -- link back to the originating portal submission (§5.4)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create index idx_projects_company_id on public.projects (company_id);
create index idx_projects_primary_contact_id on public.projects (primary_contact_id);
create index idx_projects_architect_company_id on public.projects (architect_company_id);
create index idx_projects_enquiry_id on public.projects (enquiry_id);
create index idx_projects_status on public.projects (status);

-- Close the mutual reference: enquiries.project_id -> projects.id
alter table public.enquiries
  add constraint fk_enquiries_project_id foreign key (project_id)
    references public.projects (id) on delete set null;
create index idx_enquiries_project_id on public.enquiries (project_id);

-- ----------------------------------------------------------------------------
-- 1.3 Hardware Sets (HW groups)
-- ----------------------------------------------------------------------------
create table public.hardware_sets (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid references public.projects (id) on delete cascade, -- nullable while a set is being cloned/templated before assignment
  code                 text not null, -- "HW01", "HW02" ... unique per project
  name                 text,
  cloned_from_set_id   uuid references public.hardware_sets (id) on delete set null, -- provenance when cloning from a previous project (§6.1)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_hardware_sets_project_code unique (project_id, code)
);
create trigger set_updated_at before update on public.hardware_sets
  for each row execute function public.set_updated_at();
create index idx_hardware_sets_project_id on public.hardware_sets (project_id);
create index idx_hardware_sets_cloned_from_set_id on public.hardware_sets (cloned_from_set_id);

-- ----------------------------------------------------------------------------
-- 1.4 Hardware Set Line Items
-- ----------------------------------------------------------------------------
create table public.hardware_set_line_items (
  id                      uuid primary key default gen_random_uuid(),
  hardware_set_id         uuid not null references public.hardware_sets (id) on delete cascade,
  product_id              uuid not null references public.products (id) on delete restrict,
  supplier_id             uuid not null references public.suppliers (id) on delete restrict, -- may differ from product's default supplier (mixed-origin sets, §6.1)
  qty                     numeric(10,2) not null,
  unit_cost_override      numeric(12,4),
  cost_currency_override  text check (cost_currency_override in ('USD','CAD','GBP','EUR','JMD')),
  sort_order              int,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger set_updated_at before update on public.hardware_set_line_items
  for each row execute function public.set_updated_at();
create index idx_hsli_hardware_set_id on public.hardware_set_line_items (hardware_set_id);
create index idx_hsli_product_id on public.hardware_set_line_items (product_id);
create index idx_hsli_supplier_id on public.hardware_set_line_items (supplier_id);

-- ----------------------------------------------------------------------------
-- 1.6 Doors (Door Register)
-- ----------------------------------------------------------------------------
create table public.doors (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects (id) on delete cascade,
  floor                  text,
  door_number            text not null, -- as entered/uploaded
  -- door_type: derived-but-stored (§7.1 item 5) — alphabetic code following the
  -- leading "D" in the door number ("DE01" -> "E", "D05" -> null). Populated by
  -- application logic (configurable rule), not a DB generated column, so the
  -- founders can correct the derivation rule without a migration.
  door_type              text,
  location_description   text,
  hardware_set_id        uuid references public.hardware_sets (id) on delete set null,
  sort_order             int,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger set_updated_at before update on public.doors
  for each row execute function public.set_updated_at();
create index idx_doors_project_id on public.doors (project_id);
create index idx_doors_hardware_set_id on public.doors (hardware_set_id);

-- ----------------------------------------------------------------------------
-- 1.7 Quotes
-- ----------------------------------------------------------------------------
create table public.quotes (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references public.projects (id) on delete restrict,
  quote_ref                text not null unique, -- human-facing ref, e.g. sequential per year
  revision_number          int not null default 1,
  parent_quote_id          uuid references public.quotes (id) on delete set null, -- prior revision; revisions are new rows, never overwrites (§6.4)
  status                   text not null default 'draft' check (
                              status in ('draft','approved','sent','viewed','accepted','declined','expired')
                            ),
  quote_mode               text not null check (quote_mode in ('door_register','line_item')), -- §6.2
  quote_date               date not null default current_date, -- date the FX snapshot and parameter snapshot are taken
  validity_days            int not null default 15, -- copied from parameter at creation
  architect_company_id     uuid references public.companies (id) on delete set null,
  deposit_pct              numeric(5,2) not null, -- resolved at creation from parameter default (60% standard), editable per quote (§7.1 item 7 — manual override only, no auto-flip)
  margin_pct               numeric(5,2) not null, -- selected tier (30/35/40) or override
  margin_override_reason   text, -- required if margin_pct < 20 (hard floor) or below the selected tier
  parameters_snapshot      jsonb not null, -- full copy of every business parameter at quote_date (§7) — never re-read live parameters for a created quote
  fx_snapshot              jsonb not null, -- { bank_sell_rate, fx_buffer_pct, effective_rate, supplier_rates: {CAD,GBP,EUR,...}, source, as_of }
  total_landed_usd         numeric(14,2), -- computed, cached for reporting
  total_client_jmd         numeric(14,2), -- computed, cached
  total_client_usd         numeric(14,2), -- computed, cached (informational; JMD is client-facing per §6.3.6)
  sent_at                  timestamptz,
  viewed_at                timestamptz, -- Phase 2 (Resend open tracking)
  accepted_at              timestamptz,
  declined_at              timestamptz,
  pdf_storage_path         text, -- Supabase Storage path of the rendered PDF
  created_by               uuid references public.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger set_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();
create index idx_quotes_project_id on public.quotes (project_id);
create index idx_quotes_status on public.quotes (status);
create index idx_quotes_parent_quote_id on public.quotes (parent_quote_id);
create index idx_quotes_architect_company_id on public.quotes (architect_company_id);
create index idx_quotes_created_by on public.quotes (created_by);

-- ----------------------------------------------------------------------------
-- 1.8 Quote Origins (shipment cost pools per quote)
-- ----------------------------------------------------------------------------
create table public.quote_origins (
  id                        uuid primary key default gen_random_uuid(),
  quote_id                  uuid not null references public.quotes (id) on delete cascade,
  origin_label              text not null, -- "UK-Consort", "USA-Miami", "Canada-Fort Erie", "Other" ... (§6.3.1)
  supplier_invoice_total    numeric(14,2), -- auto-summed from lines, stored post-conversion to USD; native amount kept for reference
  freight_export_fees_usd   numeric(12,2) not null default 0,
  ocean_freight_usd         numeric(12,2) not null default 0, -- defaults from parameter freight_insurance_fallback_usd ($1,250) if left blank — §7.1 item 2
  marine_insurance_usd      numeric(12,2), -- defaults to 1.5% of CIF basis, editable
  port_handling_usd         numeric(12,2), -- defaults to parameter port_handling_usd ($50, §7.1 item 3), editable
  brokerage_usd             numeric(12,2), -- computed: $120 + $50 x (pallet_count - 1), editable override
  pallet_count              int not null default 1, -- drives brokerage formula
  duty_gct_pct              numeric(5,2), -- defaults to parameter duty_gct_pct (55%), editable per quote
  cif_basis_usd             numeric(14,2), -- computed = supplier_invoice_total + freight_export_fees + ocean_freight
  total_shipment_cost_usd   numeric(14,2), -- computed sum of all cost components for this origin, allocated pro-rata to lines
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger set_updated_at before update on public.quote_origins
  for each row execute function public.set_updated_at();
create index idx_quote_origins_quote_id on public.quote_origins (quote_id);

-- ----------------------------------------------------------------------------
-- 1.9 Quote Line Items
-- ----------------------------------------------------------------------------
create table public.quote_line_items (
  id                            uuid primary key default gen_random_uuid(),
  quote_id                      uuid not null references public.quotes (id) on delete cascade,
  door_id                       uuid references public.doors (id) on delete set null, -- populated in door_register mode
  hardware_set_id               uuid references public.hardware_sets (id) on delete set null, -- populated in door_register mode, for grouping
  product_id                    uuid not null references public.products (id) on delete restrict,
  quote_origin_id               uuid not null references public.quote_origins (id) on delete restrict, -- which shipment pool this line belongs to
  description_override          text, -- per-quote override, does not touch products table
  qty                           numeric(10,2) not null,
  unit_cost                     numeric(12,4) not null, -- snapshot of cost at quote time, in cost_currency
  cost_currency                 text not null check (cost_currency in ('USD','CAD','GBP','EUR','JMD')),
  unit_cost_usd                 numeric(12,4) not null, -- converted via fx_snapshot.supplier_rates (USD per 1 native unit, §7.1 item 9)
  line_value_usd                numeric(14,2) not null, -- qty x unit_cost_usd — basis for pro-rata allocation (§6.3.3)
  allocated_shipment_cost_usd   numeric(14,2), -- computed pro-rata share of quote_origins.total_shipment_cost_usd
  landed_cost_usd               numeric(14,2) not null, -- line_value_usd + allocated_shipment_cost_usd
  sort_order                    int,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger set_updated_at before update on public.quote_line_items
  for each row execute function public.set_updated_at();
create index idx_qli_quote_id on public.quote_line_items (quote_id);
create index idx_qli_door_id on public.quote_line_items (door_id);
create index idx_qli_hardware_set_id on public.quote_line_items (hardware_set_id);
create index idx_qli_product_id on public.quote_line_items (product_id);
create index idx_qli_quote_origin_id on public.quote_line_items (quote_origin_id);

-- ----------------------------------------------------------------------------
-- 1.14 Business Parameters (key-value, typed, audited — §7)
-- ----------------------------------------------------------------------------
create table public.business_parameters (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  value        jsonb not null, -- typed payload, e.g. {"type":"numeric","value":55}
  value_type   text not null check (value_type in ('numeric','percent','text','boolean','table')),
  description  text,
  updated_by   uuid references public.users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index idx_business_parameters_key on public.business_parameters (key);

-- ----------------------------------------------------------------------------
-- 1.15 Parameter Audit Log
-- ----------------------------------------------------------------------------
create table public.parameter_audit_log (
  id              uuid primary key default gen_random_uuid(),
  parameter_key   text not null,
  old_value       jsonb,
  new_value       jsonb,
  changed_by      uuid not null references public.users (id) on delete restrict,
  changed_at      timestamptz not null default now(),
  reason          text
);
create index idx_parameter_audit_log_parameter_key on public.parameter_audit_log (parameter_key);
create index idx_parameter_audit_log_changed_by on public.parameter_audit_log (changed_by);

-- ----------------------------------------------------------------------------
-- 1.16 Override Log (margin/floor overrides — §6.3.5, §10)
-- ----------------------------------------------------------------------------
create table public.override_log (
  id                     uuid primary key default gen_random_uuid(),
  quote_id               uuid not null references public.quotes (id) on delete cascade,
  override_type          text not null check (override_type in ('margin_below_tier','margin_below_floor','price_below_landed_cost')),
  requested_margin_pct   numeric(5,2),
  landed_cost_usd        numeric(14,2), -- for price_below_landed_cost overrides
  quoted_price_usd       numeric(14,2),
  reason                 text not null, -- required — "every override records who + reason and is visible to both" (§6.3.5)
  overridden_by          uuid not null references public.users (id) on delete restrict,
  created_at             timestamptz not null default now()
);
create index idx_override_log_quote_id on public.override_log (quote_id);
create index idx_override_log_overridden_by on public.override_log (overridden_by);

-- ----------------------------------------------------------------------------
-- 1.13 Pipeline Stage — derived view, not a table (avoid dual-sourcing truth).
-- Exact stage-mapping SQL per §1.13; joins enquiries -> projects -> quotes.
-- ----------------------------------------------------------------------------
create view public.pipeline_view as
select
  e.id as enquiry_id,
  p.id as project_id,
  q.id as quote_id,
  e.company_name,
  e.contact_name,
  e.pathway,
  e.created_at as enquiry_created_at,
  q.quote_ref,
  q.status as quote_status,
  p.status as project_status,
  case
    when p.status = 'closed' then 'Fulfilled'
    when q.status = 'accepted' then 'Accepted'
    when q.status = 'declined' then 'Declined'
    when q.status in ('approved','sent','viewed') then 'Sent'
    when q.status = 'draft' then 'Quote Drafted'
    when e.status = 'reviewing' then 'Technical Review'
    when e.status = 'new' then 'Enquiry'
    else 'Unknown'
  end as stage
from public.enquiries e
left join public.projects p on p.enquiry_id = e.id
left join public.quotes q on q.project_id = p.id;

-- ============================================================================
-- 1.18 Phase 2/3 tables — specced now so no later re-migration is needed for
-- FK targets (per build plan §1.18 instruction); not exercised by Phase 1 UI.
-- ============================================================================

-- Invoices (§9.3)
create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  quote_id         uuid not null references public.quotes (id) on delete restrict,
  invoice_number   text not null unique, -- sequential
  type             text not null check (type in ('deposit','balance')),
  issue_date       date not null default current_date,
  due_date         date,
  jmd_amount       numeric(14,2) not null,
  usd_equivalent   numeric(14,2),
  gct_applied      boolean not null default false,
  gct_rate_pct     numeric(5,2),
  fx_snapshot      jsonb, -- copied from the source quote
  status           text not null default 'unpaid' check (status in ('unpaid','part_paid','paid')),
  pdf_storage_path text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
create index idx_invoices_quote_id on public.invoices (quote_id);
create index idx_invoices_status on public.invoices (status);

-- Payments
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices (id) on delete cascade,
  amount_jmd    numeric(14,2) not null,
  payment_date  date not null default current_date,
  method        text,
  recorded_by   uuid references public.users (id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create index idx_payments_invoice_id on public.payments (invoice_id);

-- Price File Uploads (§9.1)
create table public.price_file_uploads (
  id                 uuid primary key default gen_random_uuid(),
  supplier_id        uuid not null references public.suppliers (id) on delete cascade,
  file_storage_path  text not null,
  uploaded_by        uuid references public.users (id) on delete set null,
  uploaded_at        timestamptz not null default now(),
  extraction_status  text not null default 'pending' check (extraction_status in ('pending','processing','needs_review','applied','rejected')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger set_updated_at before update on public.price_file_uploads
  for each row execute function public.set_updated_at();
create index idx_price_file_uploads_supplier_id on public.price_file_uploads (supplier_id);
create index idx_price_file_uploads_extraction_status on public.price_file_uploads (extraction_status);

-- Extracted Prices
create table public.extracted_prices (
  id                     uuid primary key default gen_random_uuid(),
  price_file_upload_id   uuid not null references public.price_file_uploads (id) on delete cascade,
  matched_product_id     uuid references public.products (id) on delete set null, -- maps to existing library product per v3 requirement
  raw_extracted_text     jsonb,
  proposed_unit_cost     numeric(12,4),
  proposed_currency      text check (proposed_currency in ('USD','CAD','GBP','EUR','JMD')),
  confidence_score       numeric(5,4),
  review_status          text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  reviewed_by            uuid references public.users (id) on delete set null,
  applied_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger set_updated_at before update on public.extracted_prices
  for each row execute function public.set_updated_at();
create index idx_extracted_prices_upload_id on public.extracted_prices (price_file_upload_id);
create index idx_extracted_prices_matched_product_id on public.extracted_prices (matched_product_id);
create index idx_extracted_prices_review_status on public.extracted_prices (review_status);

-- Orders (§9.2 actuals capture)
create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  quote_id     uuid not null references public.quotes (id) on delete restrict, -- the accepted quote
  order_date   date not null default current_date,
  status       text not null default 'pending' check (status in ('pending','confirmed','in_production','shipped','delivered','cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create index idx_orders_quote_id on public.orders (quote_id);
create index idx_orders_status on public.orders (status);

-- Actual Costs
create table public.actual_costs (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  quote_origin_id     uuid references public.quote_origins (id) on delete set null, -- which shipment this actual replaces
  actual_freight_usd  numeric(12,2),
  actual_duty_gct_usd numeric(12,2),
  actual_brokerage_usd numeric(12,2),
  actual_insurance_usd numeric(12,2),
  recorded_by         uuid references public.users (id) on delete set null,
  recorded_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger set_updated_at before update on public.actual_costs
  for each row execute function public.set_updated_at();
create index idx_actual_costs_order_id on public.actual_costs (order_id);
create index idx_actual_costs_quote_origin_id on public.actual_costs (quote_origin_id);

-- Articles (§9.4)
create table public.articles (
  id                        uuid primary key default gen_random_uuid(),
  title                     text not null,
  slug                      text not null unique,
  body                      text, -- markdown/rich text
  status                    text not null default 'draft' check (status in ('draft','review','published')),
  author                    uuid references public.users (id) on delete set null,
  published_at              timestamptz,
  linkedin_cross_posted     boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger set_updated_at before update on public.articles
  for each row execute function public.set_updated_at();
create index idx_articles_status on public.articles (status);
create index idx_articles_author on public.articles (author);
