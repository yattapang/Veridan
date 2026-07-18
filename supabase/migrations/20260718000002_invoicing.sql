-- ============================================================================
-- Veridan Limited — Invoicing core (Phase 2C, Tasks 44-47)
-- Source: Veridan_Phase2_Plan_v1.md §3 (Phase 2C spec) + §8 founder
-- resolutions (balance invoice triggers on manual "Mark customs cleared"),
-- PRD §9.3 (invoicing decisions), Build Plan §1.18 (original invoices/
-- payments sketch in 20260713000001_schema.sql).
--
-- WHY THIS MIGRATION DROPS AND RECREATES `invoices`/`payments` INSTEAD OF
-- ALTERING THEM: 20260713000001_schema.sql §1.18 explicitly speced
-- `invoices`/`payments` early "so no later re-migration is needed for FK
-- targets... not exercised by Phase 1 UI." A repo-wide search confirms no
-- Phase 1/2A/2B code path ever reads or writes either table, so there is no
-- production data at risk. The Phase 2C task brief's shape (invoice_type
-- naming, draft/issued/sent/paid/partially_paid/void status vocabulary,
-- gct_amount_jmd/subtotal_jmd/fx_note/due_note provenance columns,
-- project_id/company_id denormalization for cheap list queries, the
-- (quote_id, invoice_type)-where-not-void idempotency constraint) differs
-- enough from the Phase 1 placeholder that a clean drop+recreate of an
-- empty, unexercised table pair is more honest and more reviewable than a
-- long ALTER/rename chain arriving at the same destination. `invoice_payments`
-- replaces `payments` (same columns, renamed, plus a `reference` field) to
-- match the task's naming and to read unambiguously once `invoices` no
-- longer has a same-migration-era plain-English "payments" partner reading
-- awkwardly against later Phase 2D `actual_costs`/`orders` tables.
-- ============================================================================

drop table if exists public.payments;
drop table if exists public.invoices;

-- ----------------------------------------------------------------------------
-- Invoices
-- ----------------------------------------------------------------------------
create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  invoice_number    text not null unique, -- VI-YYYY-NNN, see next_invoice_number() below
  quote_id          uuid not null references public.quotes (id) on delete restrict,
  -- Denormalized from quote_id -> projects -> companies at creation time,
  -- purely so the list/detail views don't have to hop through quotes for
  -- every row. quote_id remains the single source of truth; project_id/
  -- company_id are never read back into any amount calculation.
  project_id        uuid references public.projects (id) on delete set null,
  company_id        uuid references public.companies (id) on delete set null,
  invoice_type      text not null check (invoice_type in ('deposit', 'balance')),
  status            text not null default 'draft'
                       check (status in ('draft', 'issued', 'sent', 'paid', 'partially_paid', 'void')),
  -- Amounts. subtotal is the pre-GCT deposit/balance share of the quote's
  -- total_client_jmd; gct_amount_jmd is computed from the QUOTE'S OWN frozen
  -- parameters_snapshot (gct_enabled/gct_rate_pct) at invoice-creation time,
  -- never from a live business_parameters read (see lib/invoices/amounts.ts
  -- header for the full fidelity argument). amount_jmd = subtotal + gct is
  -- the amount actually due.
  subtotal_jmd      numeric(14,2),
  gct_amount_jmd    numeric(14,2) not null default 0,
  amount_jmd        numeric(14,2) not null,
  amount_usd        numeric(12,2), -- informational only (converted via the quote's fx_snapshot.effective_rate)
  fx_note           text, -- human-readable provenance, e.g. "162.00 x 1.03 = 166.86"
  due_note          text, -- human-readable payment-terms text; no fixed due-date model yet
  issued_at         timestamptz, -- set on draft -> issued
  sent_at           timestamptz, -- reserved for Task 48 (Resend send)
  sent_to           text,
  pdf_storage_path  text, -- reserved for Task 48 (PDF render)
  created_by        uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

create index idx_invoices_quote_id on public.invoices (quote_id);
create index idx_invoices_project_id on public.invoices (project_id);
create index idx_invoices_company_id on public.invoices (company_id);
create index idx_invoices_status on public.invoices (status);
create index idx_invoices_invoice_type on public.invoices (invoice_type);

-- Idempotency backstop (Tasks 46/47): at most one non-void invoice of each
-- type per quote. A double-click on "accept" or "mark customs cleared", or a
-- retried server action after a network blip, cannot create two deposit (or
-- two balance) invoices for the same quote — the second insert fails this
-- constraint and the caller treats it as "already exists" rather than
-- double-billing. Void invoices are excluded so a void-and-reissue correction
-- flow stays possible without a workaround.
create unique index uq_invoices_quote_type_active
  on public.invoices (quote_id, invoice_type)
  where status != 'void';

-- ----------------------------------------------------------------------------
-- Invoice payments
-- ----------------------------------------------------------------------------
create table public.invoice_payments (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices (id) on delete cascade,
  amount_jmd    numeric(14,2) not null check (amount_jmd > 0),
  paid_at       date not null default current_date,
  method        text,
  reference     text,
  notes         text,
  recorded_by   uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index idx_invoice_payments_invoice_id on public.invoice_payments (invoice_id);

-- ----------------------------------------------------------------------------
-- Invoice numbering (Task 45) — race-safe sequential counter, one row per
-- calendar year. Format `VI-YYYY-NNN` is applied in lib/invoices/numbering.ts;
-- this table + function only ever hand out the next raw integer for a year.
-- ----------------------------------------------------------------------------
create table public.invoice_counters (
  year        int primary key,
  last_number int not null default 0
);

-- Atomic "give me the next number for this year". A single INSERT ... ON
-- CONFLICT DO UPDATE ... RETURNING statement takes a row lock on (year) for
-- the duration of the statement, so two concurrent founders (or a retried
-- request) can never both read the same last_number and independently
-- compute NNN+1 in application code — the exact read-then-write race the
-- task brief calls out. Called via supabase.rpc('next_invoice_number', ...),
-- never emulated with a JS read + write.
create or replace function public.next_invoice_number(p_year int)
returns int
language sql
as $$
  insert into public.invoice_counters (year, last_number)
  values (p_year, 1)
  on conflict (year) do update set last_number = public.invoice_counters.last_number + 1
  returning last_number;
$$;

-- ----------------------------------------------------------------------------
-- customs_cleared_at (Task 47 trigger event) — a column on quotes, not a new
-- table. Per Phase2_Plan §8 Q6 RESOLUTION: the balance invoice generates on a
-- manual founder action ("Mark customs cleared" button on the quote/order);
-- "when 2D's `orders` table lands, the same event becomes an order-status
-- transition ... without changing the invoice logic." Placing it on `quotes`
-- now (rather than standing up a one-column `orders`-shaped table Task 52
-- will define properly anyway) keeps 2C fully decoupled from 2D's schema and
-- matches the existing pattern of `accepted_at`/`accepted_by`,
-- `declined_at`, `sent_at`/`sent_to` already living directly on `quotes` as
-- the single source of truth for "this deal's lifecycle timestamps."
-- customs_cleared_by mirrors quotes.approved_by's provenance pattern.
-- ----------------------------------------------------------------------------
alter table public.quotes
  add column customs_cleared_at timestamptz,
  add column customs_cleared_by uuid references public.users (id) on delete set null;

-- ----------------------------------------------------------------------------
-- RLS — same founder-full-CRUD model as every other table (see
-- 20260713000002_rls.sql header note: exactly two founders, both full CRUD).
-- ----------------------------------------------------------------------------
alter table public.invoices          enable row level security;
alter table public.invoice_payments  enable row level security;
alter table public.invoice_counters  enable row level security;

create policy invoices_founder_all on public.invoices
  for all to authenticated using (true) with check (true);

create policy invoice_payments_founder_all on public.invoice_payments
  for all to authenticated using (true) with check (true);

create policy invoice_counters_founder_all on public.invoice_counters
  for all to authenticated using (true) with check (true);

-- Dropping public.invoices/public.payments above also drops the grants the
-- Phase 1 RLS migration issued via its blanket "all tables in schema public"
-- grant (that grant was a snapshot at the time it ran, not a standing
-- default-privilege rule) — so the three new/recreated tables need their own
-- explicit grants here to be self-contained, same reasoning as
-- 20260713000002_rls.sql's own header note.
grant select, insert, update, delete on public.invoices, public.invoice_payments, public.invoice_counters
  to authenticated;
grant execute on function public.next_invoice_number(int) to authenticated;

-- ----------------------------------------------------------------------------
-- Storage bucket — invoice-pdfs, same pattern as quote-pdfs
-- (20260713000002_rls.sql): founders only, no anon/public access. Resend
-- delivers by attachment/link (Task 48), never a public URL.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('invoice-pdfs', 'invoice-pdfs', false)
on conflict (id) do nothing;

create policy invoice_pdfs_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'invoice-pdfs')
  with check (bucket_id = 'invoice-pdfs');
