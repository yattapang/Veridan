-- ============================================================================
-- Veridan Limited — Orders + actual costs (Phase 2D, Tasks 52-54)
-- Source: Veridan_Phase2_Plan_v1.md §4 (Phase 2D spec), §8 Q6 resolution
-- ("when 2D's `orders` table lands, the [customs-cleared] event becomes an
-- order-status transition ... without changing the invoice logic"), PRD §9.2
-- (financial reporting decisions — actuals capture per order), Build Plan
-- §1.18 (orders/actual_costs sketches).
--
-- WHAT AN "ORDER" IS: an order is an accepted quote's fulfillment. It is NOT
-- auto-created on quote acceptance (that would duplicate `quotes.accepted_at`
-- as a lifecycle marker for no benefit) — a founder clicks "Create order"
-- from an accepted quote's page once fulfillment actually starts. This keeps
-- the entire 2C acceptance/customs-cleared/invoicing hook chain in
-- app/admin/quotes/[id]/workflowActions.ts completely untouched by this
-- migration; the only change to that file (made in the same Phase 2D
-- commit) is an ADDITIVE, non-fatal, conditional-update side effect inside
-- markCustomsCleared that advances an order's status IF one happens to
-- exist for the quote — see that file's updated header comment for the
-- full argument. No column, table, or existing behavior in the invoicing
-- migration (20260718000002_invoicing.sql) is altered here.
--
-- CRITICAL RULE (PRD §9.2, re-stated for the Layer 2 reviewer per the task
-- brief): nothing in this migration or in the Task 53/54 application code
-- built against it may cause report totals to derive from `quotes`/
-- `quote_line_items` (projections). Revenue must always trace to
-- `invoice_payments` (real cash received) and cost must always trace to
-- `actual_costs` (real money spent). `orders.quote_id` and any quote_ref
-- shown in the UI are labels/links only, never inputs to a report sum.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Orders
-- ----------------------------------------------------------------------------
create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  -- An order IS an accepted quote's fulfillment — one order per quote, not
  -- per revision chain (a revised quote gets a NEW quote_id per the existing
  -- revision flow in workflowActions.ts createRevision, and would need its
  -- own order if fulfilled independently; this migration does not attempt to
  -- collapse revisions into a single order identity, matching how invoices
  -- already key off quote_id directly rather than a revision-chain root).
  quote_id          uuid not null unique references public.quotes (id) on delete restrict,
  -- Denormalized from quote_id -> projects at creation time, same rationale
  -- as invoices.project_id/company_id (20260718000002_invoicing.sql): cheap
  -- list-view queries without hopping through quotes on every row. quote_id
  -- remains the single source of truth; these are never read back into any
  -- amount calculation.
  project_id        uuid references public.projects (id) on delete set null,
  company_id        uuid references public.companies (id) on delete set null,
  status            text not null default 'confirmed'
                       check (status in ('confirmed', 'in_procurement', 'shipped', 'customs_cleared', 'delivered', 'closed')),
  customs_cleared_at timestamptz,
  delivered_at      timestamptz,
  closed_at         timestamptz,
  notes             text,
  created_by        uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create index idx_orders_quote_id on public.orders (quote_id);
create index idx_orders_project_id on public.orders (project_id);
create index idx_orders_company_id on public.orders (company_id);
create index idx_orders_status on public.orders (status);

-- ----------------------------------------------------------------------------
-- Actual costs — real money spent fulfilling an order. Never derived from
-- quote_line_items / quote_origins; entered by hand (or, later, from a
-- supplier invoice) as fulfillment actually happens. Rows are immediate
-- (no draft state) and freely editable/deletable until the order is closed
-- — enforced in application code (Task 53), not by a DB trigger, mirroring
-- how invoice void/payment guards are split between fast-path app checks and
-- a hard DB backstop only where a race genuinely matters (this doesn't: cost
-- entry is single-founder-at-a-time data entry, not a concurrent-payment
-- race like invoice_payments).
-- ----------------------------------------------------------------------------
create table public.actual_costs (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  category        text not null
                    check (category in ('hardware', 'freight', 'insurance', 'brokerage', 'port_handling', 'duty', 'delivery', 'other')),
  description     text,
  -- Either currency allowed, at least one required — a supplier invoice may
  -- arrive in USD, a local delivery bill in JMD; the report layer (Task 54)
  -- converts for DISPLAY ONLY at the order's quote's locked fx_snapshot rate,
  -- clearly labeled, and never stores a converted value back onto this row.
  amount_usd      numeric(12,2),
  amount_jmd      numeric(14,2),
  incurred_date   date not null default current_date,
  supplier_id     uuid references public.suppliers (id) on delete set null,
  notes           text,
  recorded_by     uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint chk_actual_costs_amount_present
    check (amount_usd is not null or amount_jmd is not null)
);

create index idx_actual_costs_order_id on public.actual_costs (order_id);
create index idx_actual_costs_category on public.actual_costs (category);
create index idx_actual_costs_supplier_id on public.actual_costs (supplier_id);
create index idx_actual_costs_incurred_date on public.actual_costs (incurred_date);

-- ----------------------------------------------------------------------------
-- RLS — same founder-full-CRUD model as every other table.
-- ----------------------------------------------------------------------------
alter table public.orders        enable row level security;
alter table public.actual_costs  enable row level security;

create policy orders_founder_all on public.orders
  for all to authenticated using (true) with check (true);

create policy actual_costs_founder_all on public.actual_costs
  for all to authenticated using (true) with check (true);

-- Same reasoning as 20260718000002_invoicing.sql's own grant note: new
-- tables need explicit grants, the blanket Phase 1 RLS migration's grant was
-- a point-in-time snapshot, not a standing default-privilege rule.
grant select, insert, update, delete on public.orders, public.actual_costs
  to authenticated;
