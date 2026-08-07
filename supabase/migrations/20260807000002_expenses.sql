-- ============================================================================
-- Veridan Limited — Operating expenses + cash-basis reporting support
-- (founder request 2026-08-07: "the P&L, Cash Flow, and Margin reports are
-- not structured like proper financial statements that allows the business
-- to have detailed transaction reports for the accountant.")
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT:
--   ADDS  · `expense_categories` — an admin-managed taxonomy (same shape and
--           discipline as `article_categories`, 20260806000001).
--         · `expenses` — real operating expenditure that is NOT attributable
--           to any single order (rent, salaries, insurance, bank charges…).
--           This is the missing bottom half of a real income statement:
--           Revenue − Cost of Sales = Gross Profit − Operating Expenses =
--           Net Profit.
--         · `actual_costs.paid_date` — additive nullable column so cost of
--           sales can be reported on a CASH basis alongside the existing
--           accrual (`incurred_date`) basis.
--   DOES NOT  · introduce double-entry accounting. No journals, no trial
--           balance, no bank reconciliation, no chart of accounts beyond the
--           two flat taxonomies (`actual_costs.category` for cost of sales,
--           `expense_categories` for opex). The founder's explicit decision:
--           Veridan owns its numbers; the accountant works from clean
--           exports in their own software.
--
-- THE CRITICAL EXISTING RULE IS UNCHANGED AND EXTENDED, NOT WEAKENED
-- (PRD §9.2, restated in 20260718000004_orders_actuals.sql): report figures
-- derive from REAL data — `invoice_payments`, `invoices`, `actual_costs`,
-- and now `expenses`. NEVER from `quotes` / `quote_line_items` projections.
-- The margin audit remains the sole, labelled exception. `expenses` has no
-- quote/order relationship at all, so it cannot even accidentally become a
-- projection source.
--
-- OPERATING EXPENSES ARE NOT ORDER-ATTRIBUTABLE — BY DESIGN. There is
-- deliberately no `order_id` on `expenses`. Rent is not a cost of any one
-- shipment, and inventing an allocation key would produce a per-order
-- "margin" that is an opinion rather than a measurement. Gross margin stays
-- order-level and real (`actual_costs`); net margin is period-level only.
-- This is also why the margin audit is untouched by this migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- expense_categories — admin-managed taxonomy.
--
-- Shape mirrors public.article_categories (20260806000001) with one
-- deliberate difference: `name` here is a STABLE MACHINE KEY (snake_case,
-- e.g. 'rent_utilities') and `label` is the founder-editable display string.
-- article_categories could get away with a single user-facing `name` because
-- articles.category is free text with no FK. Here `expenses` carries a real
-- FK, and a renamed category must not change the identity that historical
-- expense rows point at — so display text (`label`) is editable while
-- `name` stays put as the audit-stable handle that CSV/Excel exports and any
-- future accountant-side mapping can key on.
--
-- NO ANON POLICY OF ANY KIND. Unlike article_categories (whose rows are
-- public by construction — they drive the public /articles filter chips),
-- an expense taxonomy is internal financial structure. Anon gets no select,
-- no grant, nothing.
-- ----------------------------------------------------------------------------
create table public.expense_categories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  label        text not null,
  description  text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.expense_categories is
  'Admin-managed operating-expense taxonomy (founder request 2026-08-07).
   `name` is a stable snake_case machine key referenced by exports; `label`
   is the editable display string. Referenced by expenses.expense_category_id
   with ON DELETE RESTRICT — a category that is in use CANNOT be deleted, by
   design: deleting it would silently orphan or rewrite historical financial
   statements. The admin UI surfaces the usage count and blocks the delete
   with a plain-English explanation rather than letting the FK error through
   raw. See app/admin/expenses/categories/ and lib/expenses/categoryAdmin.ts.';

comment on column public.expense_categories.name is
  'Stable snake_case machine key. Never rewritten by a rename — rename edits
   `label` only, so historical exports keyed on `name` stay reconcilable.';

create trigger set_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();

create index idx_expense_categories_sort_order on public.expense_categories (sort_order);

alter table public.expense_categories enable row level security;

-- Founders: full CRUD (§10: two founders, both full CRUD — same pattern as
-- article_categories_founder_all / item_groups_founder_all).
create policy expense_categories_founder_all on public.expense_categories
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.expense_categories to authenticated;

-- ----------------------------------------------------------------------------
-- expenses — real operating expenditure. Entered by hand as bills arrive,
-- exactly like actual_costs; never derived from anything.
--
-- TWO DATES, TWO BASES (this is the whole point of the restructure):
--   · `incurred_date` (NOT NULL) — when the expense was INCURRED. This is
--     the ACCRUAL-basis date. Every expense has one.
--   · `paid_date` (NULLABLE) — when it was actually PAID. This is the
--     CASH-basis date. NULL means unpaid/accrued: the row counts on the
--     accrual basis and is EXCLUDED from every cash-basis figure and from
--     the cash-flow statement's outflows. A cash-basis report that silently
--     included unpaid bills would not be a cash-basis report.
--
-- CURRENCY: mirrors actual_costs exactly — either currency accepted, at
-- least one required (chk_expenses_amount_present below is the same
-- constraint as chk_actual_costs_amount_present). What differs is the FX
-- CONVERSION RULE, and the difference is forced by the data:
--   · actual_costs belong to an order, whose quote carries a LOCKED
--     fx_snapshot.effective_rate. USD-only costs convert at THAT rate —
--     unchanged by this migration.
--   · expenses belong to no order, so there is no locked rate to use. A
--     USD-only expense is converted for DISPLAY at the CURRENT
--     `fx_bank_sell_rate_usd_jmd` x (1 + `fx_risk_buffer_pct`/100) read at
--     REPORT RENDER TIME. That means a USD-only expense's JMD figure can
--     move between two renders of the same historical period. The report UI
--     states this in plain English wherever such a conversion contributes
--     to a total, and the transaction-detail export labels each row's FX
--     basis per row. A founder who wants a frozen JMD figure should simply
--     enter the JMD amount they were actually billed — a row with its own
--     amount_jmd never gets converted.
-- No converted value is ever written back to this table.
-- ----------------------------------------------------------------------------
create table public.expenses (
  id                  uuid primary key default gen_random_uuid(),
  -- ON DELETE RESTRICT: an expense's category is part of the financial
  -- record. Cascading would delete money; SET NULL would produce an
  -- uncategorized row that quietly breaks the income statement's opex
  -- section. Restrict forces the founder to re-categorize first.
  expense_category_id uuid not null references public.expense_categories (id) on delete restrict,
  description         text not null,
  vendor              text,
  amount_jmd          numeric(14,2),
  amount_usd          numeric(12,2),
  incurred_date       date not null default current_date,
  paid_date           date,
  payment_method      text,
  reference           text,
  notes               text,
  recorded_by         uuid references public.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_expenses_amount_present
    check (amount_usd is not null or amount_jmd is not null)
);

comment on table public.expenses is
  'Operating expenses — real money spent running the business, NOT
   attributable to any order (no order_id, deliberately). Feeds the income
   statement''s Operating Expenses section and the cash-flow statement''s
   outflows. incurred_date drives accrual-basis figures; paid_date (NULL =
   unpaid) drives cash-basis figures.';

comment on column public.expenses.paid_date is
  'When the expense was actually paid. NULL = unpaid/accrued: counted on the
   accrual basis, excluded from every cash-basis figure and from cash-flow
   outflows.';

create trigger set_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

create index idx_expenses_expense_category_id on public.expenses (expense_category_id);
create index idx_expenses_incurred_date on public.expenses (incurred_date);
create index idx_expenses_paid_date on public.expenses (paid_date);

alter table public.expenses enable row level security;

create policy expenses_founder_all on public.expenses
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.expenses to authenticated;

-- ----------------------------------------------------------------------------
-- actual_costs.paid_date — ADDITIVE ONLY.
--
-- WHY: cost of sales previously had only `incurred_date`, which is an
-- accrual-basis date. Without a payment date there is no honest way to
-- report cost of sales on a cash basis, and no honest way to show cash
-- OUTFLOWS on the cash-flow statement (which previously showed inflows
-- only). This adds the missing date and nothing else — no column is
-- dropped, renamed, retyped, or defaulted; no existing row is rewritten;
-- no existing constraint, index, policy, or grant is touched.
--
-- EXISTING ROWS KEEP NULL, AND NULL MEANS UNPAID. Every actual_cost recorded
-- before this migration therefore does NOT appear in cash-basis cost of
-- sales or in cash-flow outflows until a founder fills in its paid_date.
-- This is the deliberate, conservative reading: the alternative
-- (backfilling paid_date = incurred_date) would fabricate payment dates
-- that were never recorded and would put invented figures into a statement
-- the accountant relies on. The reports UI states this so a founder reading
-- an unexpectedly small cash-basis cost figure knows exactly why, and the
-- accrual basis — which is the default — is unaffected and complete.
-- ----------------------------------------------------------------------------
alter table public.actual_costs
  add column paid_date date;

comment on column public.actual_costs.paid_date is
  'When this cost was actually paid. NULL = unpaid (and every row that
   predates the 2026-08-07 expenses migration is NULL, since no payment date
   was ever recorded for it — deliberately NOT backfilled). Cash-basis cost
   of sales and cash-flow outflows exclude NULL rows; accrual-basis figures
   (incurred_date) are unaffected.';

create index idx_actual_costs_paid_date on public.actual_costs (paid_date);

-- ----------------------------------------------------------------------------
-- Seed: a small-importer operating-expense chart.
--
-- `on conflict (name) do nothing` — idempotent, and deliberately does NOT
-- overwrite a founder's own edits (relabel / re-describe / reorder) on a
-- re-run, matching article_categories' seeding discipline.
-- ----------------------------------------------------------------------------
insert into public.expense_categories (name, label, description, sort_order)
values
  ('rent_utilities', 'Rent & Utilities',
   'Premises rent, electricity, water, internet and phone.', 1),
  ('salaries_wages', 'Salaries & Wages',
   'Staff pay and statutory payroll contributions.', 2),
  ('professional_fees', 'Professional Fees',
   'Accounting, legal, audit and consultancy fees.', 3),
  ('insurance', 'Insurance',
   'Business insurance not attributable to a specific shipment (marine cargo insurance on an order is a cost of sales, not an operating expense).', 4),
  ('marketing_advertising', 'Marketing & Advertising',
   'Advertising, print, website, trade shows and promotional material.', 5),
  ('bank_charges_interest', 'Bank Charges & Interest',
   'Bank fees, merchant/wire charges, FX spread charged as a fee, and loan interest.', 6),
  ('office_admin', 'Office & Admin',
   'Stationery, office supplies, courier, cleaning and general administration.', 7),
  ('travel_vehicle', 'Travel & Vehicle',
   'Fuel, vehicle maintenance and licensing, local and overseas travel.', 8),
  ('software_subscriptions', 'Software & Subscriptions',
   'Software licences, SaaS subscriptions, hosting and domains.', 9),
  ('depreciation', 'Depreciation',
   'Non-cash write-down of fixed assets. Recorded with incurred_date and left UNPAID (paid_date NULL) by nature — it therefore appears on the accrual-basis income statement and is correctly absent from cash-basis figures and cash-flow outflows.', 10),
  ('other', 'Other',
   'Anything that does not fit a category above. Keep this small — a growing "Other" is a sign a new category is needed.', 11)
on conflict (name) do nothing;
