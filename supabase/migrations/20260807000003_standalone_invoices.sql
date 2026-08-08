-- ============================================================================
-- Veridan Limited — Standalone (ad-hoc) invoices
-- Source: founder request 2026-08-07 — "under the invoices tab, all invoices
-- are generated from Quote however we need a new invoice creation button in
-- case we want to build an invoice from scratch."
--
-- NEW MIGRATION ONLY — 20260718000002_invoicing.sql is APPLIED LIVE and must
-- never be edited. This migration is additive/permissive: it widens
-- `invoices.quote_id` to nullable and widens the `invoice_type` vocabulary,
-- but touches no existing row and drops nothing.
--
-- WHAT THIS ADDS
--   1. `invoices.quote_id` becomes NULLABLE — a standalone invoice has no
--      source quote to point at.
--   2. `invoices.invoice_type` gains a third value, 'standalone', alongside
--      the existing 'deposit'/'balance'.
--   3. A CHECK constraint ties the two together so the two columns can never
--      drift apart: a deposit/balance invoice must still carry a quote_id
--      (exactly the old NOT NULL guarantee, just expressed as a conditional
--      check instead of an unconditional one); a standalone invoice must
--      have quote_id NULL and company_id NOT NULL (the founder's form always
--      requires picking a company — enforced here too, not just in the UI).
--   4. `invoice_line_items` — ad-hoc invoices have no `quote_line_items` to
--      itemize from (lib/invoices/itemization.ts only ever reads a QUOTE's
--      line items), so they get their own minimal line-item table.
--
-- THE (quote_id, invoice_type) UNIQUE-WHERE-NOT-VOID CONSTRAINT AND NULLs —
-- NO CHANGE NEEDED. `uq_invoices_quote_type_active` is a plain (not
-- NULLS NOT DISTINCT) unique index, and Postgres's default behaviour for
-- ordinary unique indexes/constraints is that NULL is never considered equal
-- to another NULL (see "Indexes and NULL values" /
-- "7.11. Unique Constraints" in the Postgres 14+ docs: "each null value is
-- considered distinct" unless NULLS NOT DISTINCT is specified, which nothing
-- here does). So `(quote_id, invoice_type) = (NULL, 'standalone')` never
-- collides with itself no matter how many standalone invoices exist — every
-- founder-facing "create N standalone invoices" flow already works against
-- the existing index with zero migration changes to it. This is verified,
-- not assumed: it's the documented default, and is also exactly the
-- behaviour the existing deposit/balance invoices already rely on for
-- `project_id`/`company_id` (both nullable FKs on this same table with no
-- special uniqueness handling required).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) quote_id: NOT NULL -> nullable. Pure widening — no existing row's
--    quote_id is touched (they all keep their current, non-null value).
-- ----------------------------------------------------------------------------
alter table public.invoices
  alter column quote_id drop not null;

-- ----------------------------------------------------------------------------
-- 2) invoice_type: widen the CHECK vocabulary to add 'standalone'.
--    invoices_invoice_type_check is the implicit name Postgres gave the
--    unnamed `check (invoice_type in (...))` clause in
--    20260718000002_invoicing.sql (default naming: <table>_<column>_check).
-- ----------------------------------------------------------------------------
alter table public.invoices
  drop constraint if exists invoices_invoice_type_check;

alter table public.invoices
  add constraint invoices_invoice_type_check
  check (invoice_type in ('deposit', 'balance', 'standalone'));

-- ----------------------------------------------------------------------------
-- 3) Consistency check: quote_id and invoice_type can never drift apart.
--    Every existing row satisfies this already (every current row is
--    'deposit' or 'balance' with a non-null quote_id, since quote_id was
--    NOT NULL until the ALTER above), so this can be added without any
--    backfill or NOT VALID/VALIDATE two-step.
-- ----------------------------------------------------------------------------
alter table public.invoices
  add constraint invoices_type_quote_consistency_check
  check (
    (invoice_type in ('deposit', 'balance') and quote_id is not null)
    or
    (invoice_type = 'standalone' and quote_id is null and company_id is not null)
  );

-- ----------------------------------------------------------------------------
-- Ad-hoc line items — one row per line on a standalone invoice. Free-text
-- description + qty + unit price, the same shape lib/invoices/pdf.ts and the
-- invoice detail page already render for line_item-mode quotes
-- (lib/quote-pdf/QuotePdfFlatLineRow: description/qty/unitPriceJmd/
-- lineTotalJmd) — see lib/invoices/standaloneItemization.ts, which maps this
-- table straight into that existing display shape so no new PDF/table
-- rendering code was needed.
--
-- `line_total_jmd` is stored (not recomputed on read) so the invoice's own
-- rendering never re-derives a total from qty x unit_price with a different
-- rounding rule than lib/invoices/lineItems.ts used at creation time — same
-- "store what was computed, never recompute on display" discipline as
-- `invoices.subtotal_jmd` etc.
-- ----------------------------------------------------------------------------
create table public.invoice_line_items (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices (id) on delete cascade,
  description     text not null,
  qty             numeric(12,2) not null default 1,
  unit_price_jmd  numeric(14,2) not null default 0,
  line_total_jmd  numeric(14,2) not null default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger set_updated_at before update on public.invoice_line_items
  for each row execute function public.set_updated_at();

create index idx_invoice_line_items_invoice_id on public.invoice_line_items (invoice_id);

-- ----------------------------------------------------------------------------
-- RLS — founder-only, no anon (same pattern as every other table; see
-- 20260713000002_rls.sql / 20260718000002_invoicing.sql headers).
-- ----------------------------------------------------------------------------
alter table public.invoice_line_items enable row level security;

create policy invoice_line_items_founder_all on public.invoice_line_items
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.invoice_line_items to authenticated;
