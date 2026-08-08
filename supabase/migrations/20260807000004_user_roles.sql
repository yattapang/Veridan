-- ============================================================================
-- Veridan Limited — Founder / Staff roles, user deactivation, team audit log
--
-- WHY THIS MIGRATION EXISTS
-- Until now the app had exactly two users, both founders, and 20260713000002_rls.sql
-- says so in its header: "any `authenticated` Supabase Auth session IS a founder
-- session ... If a non-founder authenticated role is ever introduced, tighten
-- these policies to check public.users.role at that time."
--
-- That time is now. Introducing a `staff` role while every RLS policy still reads
-- `for all to authenticated using (true)` would mean a staff member could bypass
-- the entire app UI — the anon key is public by definition (NEXT_PUBLIC_*), so
-- with their own session token they could `select * from actual_costs` straight
-- from PostgREST. So this migration does four things:
--
--   1. Constrains public.users.role to ('founder','staff') and adds
--      active / invited_at / deactivated_at.
--   2. Stops any authenticated user from writing their OWN role/active
--      (column-level grants + self-only row policies) — no self-promotion.
--   3. Tightens RLS on the founder-only *data* tables to require a founder row.
--   4. Adds public.user_admin_audit_log for invite / role-change / deactivation.
--
-- SAFETY FOR THE LIVE DATABASE
--   * Every existing users row is normalised to 'founder' BEFORE the CHECK is
--     added, so no current row can violate it (both current users are founders).
--   * Founders keep byte-for-byte the same access they have today: every
--     tightened policy is `public.is_founder()`, which is true for them.
--   * A statement trigger makes it impossible — even from raw SQL — to leave the
--     table with zero active founders.
--
--   * BOOTSTRAP NOTE: the column DEFAULT for role becomes 'staff' (least
--     privilege), because a row created by the app's own first-login sync gets
--     the default. On a brand-new database the first user must therefore be
--     promoted once by hand:
--         update public.users set role = 'founder', active = true where email = '...';
--     On THIS database both founders already exist, so nothing to do.
--
--   * SUPABASE DASHBOARD NOTE (cannot be done in SQL — see the build report):
--     Authentication → URL Configuration must allow-list the app's callback URLs,
--     and the "Invite user" / "Reset password" email templates should point at
--     the app's confirm route so the recipient — and only the recipient — sets
--     their own password:
--         {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/set-password
--         {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/set-password
--     /auth/set-password also accepts the default templates' implicit-flow hash
--     tokens, so both styles work.
--
--   * LOCK-OUT NOTE: deactivating a user sets active = false here AND bans the
--     Supabase Auth user (ban_duration, via the service-role admin API), so an
--     in-flight session stops working on its next server round-trip rather than
--     lasting until the access token expires.
--
--   * >>> EMAIL SIGN-UPS MUST BE DISABLED <<< (cannot be done in SQL — Supabase
--     dashboard → Authentication → Providers → Email → turn "Enable sign ups"
--     OFF; also confirm Authentication → Providers has no social provider
--     enabled). Access to this admin is INVITE-ONLY by design: a person gets in
--     only when a founder invites them from /admin/team, which is the only code
--     path that creates their public.users row. lib/roles/session.ts now DENIES
--     any authenticated session that has no public.users row (deny by default),
--     so a self-registered account would already be refused at the app layer —
--     but leaving sign-ups on would still let strangers create Supabase Auth
--     users against this project and hammer the login route. Turn it off.
--
--   * RE-RUNNABLE: the whole file is wrapped in `begin; … commit;` and every
--     statement is idempotent (`if not exists` / `drop … if exists` first), so
--     a half-applied or repeated run is safe and simply converges.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. public.users — role constraint, active flag, invite/deactivation stamps
-- ----------------------------------------------------------------------------

-- `role` was free text (`text not null default 'founder'`, schema.sql §1.17).
-- Normalise first so the CHECK below cannot fail on an existing row. Anything
-- that is not already exactly 'staff' becomes 'founder': the only rows that
-- exist today are the two founders, and treating an unrecognised legacy value
-- as 'founder' preserves their current access rather than silently locking a
-- live user out mid-migration.
update public.users
   set role = 'founder'
 where role is distinct from 'staff';

alter table public.users
  drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('founder', 'staff'));

-- Least-privilege default for rows created WITHOUT an explicit role — i.e. the
-- first-login sync in lib/auth.ts. An invited user's row is pre-created by the
-- founder with an explicit role, so the default never applies to them.
alter table public.users
  alter column role set default 'staff';

-- Deactivation instead of deletion: override_log.overridden_by,
-- parameter_audit_log.changed_by, site_content_audit_log.changed_by,
-- expenses.recorded_by, articles.author, actual_costs.recorded_by and others
-- all reference public.users(id) — several with `on delete restrict` — so a
-- hard delete would either fail outright or orphan an audit trail.
alter table public.users
  add column if not exists active          boolean not null default true,
  add column if not exists invited_at      timestamptz,
  add column if not exists deactivated_at  timestamptz,
  add column if not exists deleted_at      timestamptz;

create index if not exists idx_users_role_active on public.users (role, active);

-- ----------------------------------------------------------------------------
-- 1b. Account DELETION must not take the audit trail with it
--
-- public.users.id was declared `references auth.users (id) on delete cascade`
-- (schema.sql §1.17). "Delete this account" in /admin/team deletes the AUTH user
-- permanently — that is the point: the person can never sign in again and the
-- address is freed for reuse. But with the cascade in place that same delete
-- would silently remove their public.users row, and with it every FK that
-- attributes a business action to them:
--
--     override_log.overridden_by         (on delete restrict)
--     parameter_audit_log.changed_by     (on delete restrict)
--     site_content_audit_log.changed_by  (on delete restrict)
--     user_admin_audit_log.changed_by    (on delete restrict)
--     expenses.recorded_by, articles.author, orders/actual_costs recorded_by,
--     projects.created_by, quotes/invoices created_by …  (on delete set null)
--
-- The `restrict` ones would make the delete fail outright; the `set null` ones
-- would turn "who approved this below-floor margin" into "unknown". Neither is
-- acceptable, so the cascade goes: the public.users row is retained and stamped
-- with deleted_at, giving destroyed ACCESS with intact ATTRIBUTION. Rows for
-- deleted users are rendered as "Name (removed)" and are never active.
-- ----------------------------------------------------------------------------
alter table public.users
  drop constraint if exists users_id_fkey;

comment on table public.users is
  'Admin users. NOT FK-linked to auth.users any more: deleting an auth user (permanent sign-in removal) deliberately leaves this row behind so audit-log attribution survives. deleted_at stamped = account removed; such rows are always active = false.';
comment on column public.users.deleted_at is
  'Set when the Supabase Auth user was permanently deleted. The row is kept ONLY so historical audit rows still resolve to a name; the person has no access of any kind.';

comment on column public.users.role is
  'founder = full admin incl. costs, margins, finance, team management. staff = operational areas only (see lib/roles/matrix.ts).';
comment on column public.users.active is
  'false = access revoked. getCurrentUser() returns null for an inactive user, so every existing `if (!user)` check denies them. Never hard-delete a user; audit trails FK into this table.';

-- ----------------------------------------------------------------------------
-- 2. Founder predicate — SECURITY DEFINER so RLS policies that call it do not
--    recurse through public.users' own policies.
-- ----------------------------------------------------------------------------
create or replace function public.is_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.users u
     where u.id = auth.uid()
       and u.role = 'founder'
       and u.active
  );
$$;

revoke all on function public.is_founder() from public;
grant execute on function public.is_founder() to authenticated, service_role;

comment on function public.is_founder() is
  'True when the calling session belongs to an ACTIVE founder. Used by every founder-only RLS policy. service_role bypasses RLS entirely and does not need it.';

-- ----------------------------------------------------------------------------
-- 3. public.users policies + column grants — nobody escalates themselves
--
-- The old single `users_founder_all ... using (true) with check (true)` let any
-- authenticated session update any users row, including its own `role`. Replace
-- it with: everyone may READ the directory (names/emails of colleagues, and the
-- joins in override_log / audit logs depend on it); a user may INSERT/UPDATE
-- only their OWN row; nobody may DELETE. Role/active are then removed from the
-- writable column set entirely, so even a self-row UPDATE cannot touch them.
-- All team management goes through the service-role client, which bypasses RLS.
-- ----------------------------------------------------------------------------
drop policy if exists users_founder_all on public.users;

drop policy if exists users_select_authenticated on public.users;
create policy users_select_authenticated on public.users
  for select to authenticated
  using (true);

drop policy if exists users_insert_self on public.users;
create policy users_insert_self on public.users
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No DELETE policy at all → deletes are denied for `authenticated`.
-- No `anon` policy at all, and the grant below is explicitly revoked →
-- anonymous sessions get nothing from public.users, of any kind.
revoke all on public.users from anon;

-- Column-level write privileges. A table-level UPDATE grant implies every
-- column, so it must be revoked before per-column grants mean anything.
revoke insert, update, delete on public.users from authenticated;
grant insert (id, email, display_name) on public.users to authenticated;
grant update (email, display_name)     on public.users to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Last-active-founder invariant, enforced in the database
--
-- The app blocks self-demotion / self-deactivation / demoting the last founder
-- (lib/roles/lockout.ts, re-checked server-side in app/admin/team/actions.ts).
-- This trigger is the backstop: it makes "zero active founders" unreachable even
-- from the SQL editor or a service-role script. Statement-level so a single
-- multi-row UPDATE is judged on its end state, not row by row.
--
-- SECURITY DEFINER, and not optional: the count(*) below must see EVERY row in
-- public.users, not the subset the invoking session's RLS policies expose. Today
-- users_select_authenticated is `using (true)` so an invoker-rights count would
-- happen to be right — but the moment that policy is narrowed (e.g. "staff see
-- only themselves"), an invoker-rights count would return 0 for a staff session
-- and this trigger would raise on every ordinary users UPDATE, i.e. it would
-- break the first-login sync for every staff member. `set search_path = public`
-- pins name resolution so a definer-rights function cannot be redirected at a
-- shadow `users` table via a caller-controlled search_path.
-- ----------------------------------------------------------------------------
create or replace function public.assert_active_founder_remains()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.users where role = 'founder' and active) = 0 then
    raise exception 'At least one active founder must remain (attempted change would leave none).'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

-- Not directly callable regardless (its return type is `trigger`, and
-- Postgres refuses to invoke a trigger function outside trigger context), but
-- every other SECURITY DEFINER function in this migration revokes from
-- `public` explicitly — this one was the only exception, and leaving it
-- implicit is the kind of gap that gets copy-pasted forward.
revoke all on function public.assert_active_founder_remains() from public;

drop trigger if exists users_keep_one_active_founder on public.users;
create trigger users_keep_one_active_founder
  after update or delete on public.users
  for each statement execute function public.assert_active_founder_remains();

-- ----------------------------------------------------------------------------
-- 5. public.user_admin_audit_log
--
-- Shape is deliberately identical to parameter_audit_log (schema.sql §1.15) and
-- site_content_audit_log — old_value / new_value jsonb, changed_by, changed_at,
-- reason — so there is one audit-row idiom in this schema, not three. It is a
-- SEPARATE table rather than a reuse of either of those because both are keyed
-- by a text subject (`parameter_key` / `content_key`) with their own indexes and
-- their own admin pages; overloading one of them with user ids would corrupt
-- those pages' queries and their meaning.
--
-- `target_email` is denormalised on purpose: an invite is recorded before the
-- invitee has ever signed in, and the row must stay readable as a historical
-- record even if the address later changes.
-- ----------------------------------------------------------------------------
create table if not exists public.user_admin_audit_log (
  id              uuid primary key default gen_random_uuid(),
  target_user_id  uuid references public.users (id) on delete set null,
  target_email    text not null,
  action          text not null check (
                    action in ('invite', 'role_change', 'deactivate', 'reactivate', 'delete', 'password_reset')
                  ),
  old_value       jsonb,
  new_value       jsonb,
  changed_by      uuid not null references public.users (id) on delete restrict,
  changed_at      timestamptz not null default now(),
  reason          text
);
create index if not exists idx_user_admin_audit_log_target_user_id on public.user_admin_audit_log (target_user_id);
create index if not exists idx_user_admin_audit_log_changed_by on public.user_admin_audit_log (changed_by);
create index if not exists idx_user_admin_audit_log_changed_at on public.user_admin_audit_log (changed_at desc);

alter table public.user_admin_audit_log enable row level security;

-- APPEND-ONLY. An audit log a founder can edit is not an audit log: with
-- `for all` + a blanket update/delete grant, a founder could rewrite (or erase)
-- the record of who demoted, locked out or deleted whom — including their own
-- actions. So there are exactly two policies, SELECT and INSERT; there is
-- deliberately no UPDATE and no DELETE policy, and the grant below withholds
-- those privileges as well, so the two layers agree. Corrections are made by
-- appending a new row with a `reason`, never by editing history.
--
-- (service_role bypasses RLS and keeps its schema-level privileges, which is
-- what the /admin/team actions use to WRITE these rows. If an operational
-- deletion is ever genuinely required it has to be done deliberately with the
-- service key, not silently through the app's own authenticated session.)
drop policy if exists user_admin_audit_log_founder_all on public.user_admin_audit_log;
drop policy if exists user_admin_audit_log_founder_select on public.user_admin_audit_log;
create policy user_admin_audit_log_founder_select on public.user_admin_audit_log
  for select to authenticated
  using (public.is_founder());

drop policy if exists user_admin_audit_log_founder_insert on public.user_admin_audit_log;
create policy user_admin_audit_log_founder_insert on public.user_admin_audit_log
  for insert to authenticated
  with check (public.is_founder());

revoke all on public.user_admin_audit_log from authenticated;
grant select, insert on public.user_admin_audit_log to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Founder-only DATA tables — RLS now actually checks the role
--
-- These are the tables a staff member must never read, per the access matrix in
-- lib/roles/matrix.ts: business parameters and their audit trail, margin/floor
-- overrides, invoicing, expenses, and per-order actual costs. Blocking the pages
-- and server actions is not enough on its own — the anon key is public, so the
-- boundary has to hold at PostgREST too.
--
-- Founders are unaffected: is_founder() is true for them, so `using (true)`
-- becomes `using (is_founder())` with identical results.
--
-- KNOWN LIMITATION (deliberate, documented — full disclosure, not just the
-- headline example; silence is not acceptable here): RLS is row-level, not
-- column-level. Cost COLUMNS on tables a staff member legitimately needs stay
-- readable to any authenticated session that queries PostgREST directly, in
-- full, and two of the SECURITY DEFINER bridges below have the exact same
-- shape of exposure by design:
--   * products.unit_cost / cost_currency
--   * quote_line_items.unit_cost / unit_cost_usd / landed_cost_usd /
--     allocated_shipment_cost_usd / line_value_usd / margin_pct_override
--   * quotes.total_landed_usd, quotes.margin_pct
--   * quotes.parameters_snapshot — the ENTIRE frozen pricing model for that
--     quote: margin_tiers, margin_floor_pct, contingency_pct, duty_gct_pct,
--     procurement_handling_fee_usd, and every other key
--     SNAPSHOT_PARAMETER_KEYS freezes (§7 below). A staff member who reads
--     this column directly via PostgREST sees the founder's margin floor and
--     margin tiers plainly, in JSON, on every quote row — this is NOT
--     narrower than reading business_parameters itself, it is the same
--     numbers copied onto a table staff already have row access to.
--   * hardware_set_line_items.unit_cost_override / cost_currency_override
--   * public.snapshot_business_parameters() (§7 below) — this bridge is
--     DELIBERATELY grantable to `authenticated`, not just to a staff session
--     mid quote-creation: any authenticated caller can `POST
--     /rest/v1/rpc/snapshot_business_parameters` directly and get
--     margin_floor_pct and margin_tiers back, at any time, not only while
--     creating a quote. Same numbers as business_parameters itself, reached
--     through a door left open on purpose rather than a leak in one meant to
--     be shut — unlike quote_origins' bridge functions (§8 below), which are
--     NOT part of this list because they are service_role only.
--   * public.pipeline_view.total_landed_usd — the view is granted to
--     `authenticated` (only `anon` was revoked, 20260717000001:70). §9 below
--     adds `security_invoker`, which makes the view finally evaluate RLS as
--     the querying session rather than the view owner, but that does not
--     touch the grant. Because enquiries/projects/quotes all stay
--     `using (true)` for `authenticated` today, an invoker-rights read still
--     returns every row's total_landed_usd to every authenticated session —
--     §9 closes a latent bypass, it does not itself restrict who sees this
--     column.
-- Hiding those would need per-column grants (which cannot distinguish founder
-- from staff — both are the `authenticated` DB role) or a parallel set of
-- cost-free views wired through every founder page. They are hidden at the
-- app layer (lib/roles/matrix.ts canViewCosts + the cost-free DTOs in
-- app/admin/**, which strip the fields BEFORE they can reach a client
-- component's props / the RSC flight payload), which stops the realistic
-- threat: a staff member using the admin UI or reading view-source. Closing
-- it at the DB needs a views refactor — out of scope here.
--
-- WHAT IS *NOT* A LIMITATION, and is closed below: every table and bucket
-- whose WHOLE PURPOSE is cost, price history, invoicing, expenses or supplier
-- data, WITH THE TWO NAMED EXCEPTIONS ABOVE (snapshot_business_parameters(),
-- pipeline_view.total_landed_usd) — those two are the only doors left open on
-- purpose, and both are named above rather than left implicit.
-- public.quote_origins (§8 below) is NOT a third exception: every non-key
-- column there is a shipment-cost figure, and both the table and the four
-- functions that bridge it are closed to anything other than service_role —
-- a staff or founder JWT plus the anon key cannot reach it by any route,
-- direct table access or RPC. See §8 for the full reasoning, including the
-- first attempt at this that did not fully close it.
-- ----------------------------------------------------------------------------
drop policy if exists business_parameters_founder_all on public.business_parameters;
create policy business_parameters_founder_all on public.business_parameters
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

drop policy if exists parameter_audit_log_founder_all on public.parameter_audit_log;
create policy parameter_audit_log_founder_all on public.parameter_audit_log
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

drop policy if exists override_log_founder_all on public.override_log;
create policy override_log_founder_all on public.override_log
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

drop policy if exists invoices_founder_all on public.invoices;
create policy invoices_founder_all on public.invoices
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

drop policy if exists invoice_payments_founder_all on public.invoice_payments;
create policy invoice_payments_founder_all on public.invoice_payments
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

drop policy if exists invoice_counters_founder_all on public.invoice_counters;
create policy invoice_counters_founder_all on public.invoice_counters
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

drop policy if exists expenses_founder_all on public.expenses;
create policy expenses_founder_all on public.expenses
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

drop policy if exists actual_costs_founder_all on public.actual_costs;
create policy actual_costs_founder_all on public.actual_costs
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

-- extracted_prices is every row scanned out of a supplier price list: a unit
-- cost per line. The founder's brief allows staff into Price Files, but the
-- no-supplier-costs rule outranks an area allowance, so the split is: staff see
-- the UPLOADS list (file name, supplier, status — price_file_uploads, left
-- open), founders see the extracted COSTS and the review screen that edits them
-- (/admin/price-files/[id]/review is gated whole by its layout).
drop policy if exists extracted_prices_founder_all on public.extracted_prices;
create policy extracted_prices_founder_all on public.extracted_prices
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

-- ----------------------------------------------------------------------------
-- 6b. The surfaces the first pass missed (security review, 2026-08-08)
--
-- Each of these was still `for all to authenticated using (true)` from an
-- earlier migration, which means a staff JWT plus the PUBLIC anon key reads it
-- straight off PostgREST/Storage with no app code involved. They are listed with
-- the migration that created the open policy, so the pair is easy to audit.
-- ----------------------------------------------------------------------------

-- product_price_history (20260718000001_price_ingestion.sql:82) — one row per
-- price change, each carrying unit_cost + cost_currency. This IS the historical
-- supplier cost book: strictly MORE sensitive than products.unit_cost, because
-- it exposes the trend as well as today's number.
drop policy if exists product_price_history_founder_all on public.product_price_history;
create policy product_price_history_founder_all on public.product_price_history
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

-- invoice_line_items (20260807000003_standalone_invoices.sql:116) — `invoices`
-- was tightened above but its CHILD rows were not, so every line, quantity and
-- amount of every client invoice was still readable. Closing the parent while
-- leaving the children open closes nothing.
drop policy if exists invoice_line_items_founder_all on public.invoice_line_items;
create policy invoice_line_items_founder_all on public.invoice_line_items
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

-- payments (20260713000002_rls.sql:104) — the ORIGINAL Phase 1 payments table
-- (invoice_id, amount_jmd, method, recorded_by). NOT a target here: it was
-- DROPPED by 20260718000002_invoicing.sql:27 when invoice_payments superseded
-- it, and never recreated. `drop policy if exists` above tolerates a missing
-- relation, but `create policy ... on public.payments` does not — it would
-- raise 42P01 and roll back this whole migration (`begin; … commit;`). There
-- is no table left to protect and nothing was missed: invoice_payments (the
-- table that actually holds this data now) is tightened above.

-- expense_categories (20260807000002_expenses.sql:92) — the taxonomy of company
-- spend. `expenses` itself is founder-only above; the category list is part of
-- the same founder-only area (/admin/expenses/categories) and leaks the shape of
-- the company's cost base on its own.
drop policy if exists expense_categories_founder_all on public.expense_categories;
create policy expense_categories_founder_all on public.expense_categories
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

-- suppliers (20260713000002_rls.sql:56) — lib/roles/matrix.ts declares the
-- suppliers AREA founder-only ("supplier terms/currencies sit directly against
-- cost"), but the table was still open, so the page guard was the only thing
-- stopping a staff session reading the whole supplier ledger from PostgREST.
--
-- CONSEQUENCE, accepted deliberately: staff no longer see supplier NAMES
-- anywhere either — the product list and quote line rows fall back to their
-- existing "no supplier" rendering. Quote creation still works for staff because
-- the only supplier fields that pipeline needs (origin_region / country, to group
-- shipment origin pools) come from the security-definer helper in §7 below, not
-- from a direct read of this table.
drop policy if exists suppliers_founder_all on public.suppliers;
create policy suppliers_founder_all on public.suppliers
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

-- ----------------------------------------------------------------------------
-- 6c. Storage buckets holding the same class of data
--
-- A storage policy is just an RLS policy on storage.objects, so the same
-- `using (true)`-shaped hole existed there: both of these were scoped only by
-- bucket_id, i.e. any authenticated session could list and download every object.
-- Rewritten as `bucket_id = '<bucket>' and public.is_founder()`.
--
-- The OTHER buckets are deliberately left as they are: enquiry-uploads (client
-- intake — staff triage enquiries), quote-pdfs (the client-facing quote document,
-- which contains client prices, never costs — staff send/track quotes),
-- article-source-uploads / article-hero-images / catalogue-files / brand-logos /
-- install-photos (marketing content, some already anon-readable by design).
-- ----------------------------------------------------------------------------

-- price-files (20260713000002_rls.sql:201) — the RAW supplier price lists every
-- extracted_prices row was scanned out of. Closing extracted_prices while leaving
-- the source PDFs downloadable would be theatre.
drop policy if exists price_files_founder_all on storage.objects;
create policy price_files_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'price-files' and public.is_founder())
  with check (bucket_id = 'price-files' and public.is_founder());

-- invoice-pdfs (20260718000002_invoicing.sql:182) — rendered client invoices.
drop policy if exists invoice_pdfs_founder_all on storage.objects;
create policy invoice_pdfs_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'invoice-pdfs' and public.is_founder())
  with check (bucket_id = 'invoice-pdfs' and public.is_founder());

-- ----------------------------------------------------------------------------
-- 7. Security-definer read paths for the two things STAFF LEGITIMATELY NEED
--    out of founder-only tables
--
-- Staff create quotes. That is the founder's explicit intent, and it is why
-- quotes / quote_line_items / projects stay open to them. But quote creation
-- reads two founder-only tables as PRICING INPUTS:
--
--   * business_parameters — frozen into quotes.parameters_snapshot /
--     fx_snapshot at creation (§1.7). Without it a staff-created quote is
--     priced off nothing.
--   * suppliers.origin_region / country — used ONLY to group the quote's
--     suppliers into shipment-origin cost pools.
--
-- Under RLS an unauthorised SELECT does not error: it returns ZERO ROWS with
-- error = null. So without these functions a staff member clicking "Create
-- quote" would get a quote silently built from hard-coded fallback defaults and
-- with zero line items — wrong numbers, frozen forever, no error anywhere. That
-- is a worse outcome than a refusal, and it is exactly what these two functions
-- prevent.
--
-- Both are SECURITY DEFINER, `stable`, `set search_path = public`, return only
-- the columns the snapshot pipeline actually needs, and take no caller-supplied
-- SQL. Direct table access stays founder-only: the parameters SCREEN, the
-- supplier ledger, and every other read of these tables are unaffected.
-- ----------------------------------------------------------------------------

-- Exactly the keys lib/quotes/snapshot.ts reads (buildParametersSnapshot +
-- buildFxSnapshot), and nothing else. Keep this list in step with
-- SNAPSHOT_PARAMETER_KEYS in lib/quotes/snapshot.ts — the TS side now HARD
-- ERRORS if any of them is missing, so an out-of-step list fails loudly at the
-- first quote creation rather than silently substituting a default.
create or replace function public.snapshot_business_parameters()
returns setof public.business_parameters
language sql
stable
security definer
set search_path = public
as $$
  select *
    from public.business_parameters
   where key = any (array[
           'duty_gct_pct',
           'marine_insurance_pct',
           'brokerage_first_pallet_usd',
           'brokerage_addl_pallet_usd',
           'port_handling_usd',
           'freight_insurance_fallback_usd',
           'procurement_handling_fee_usd',
           'contingency_pct',
           'margin_tiers',
           'margin_floor_pct',
           'min_order_value_usd',
           'deposit_standard_pct',
           'quote_validity_days',
           'default_finish',
           'gct_enabled',
           'gct_rate_pct',
           'lead_times',
           'company_details',
           'fx_bank_sell_rate_usd_jmd',
           'fx_risk_buffer_pct',
           'supplier_fx_rates'
         ])
   order by key;
$$;

revoke all on function public.snapshot_business_parameters() from public;
grant execute on function public.snapshot_business_parameters() to authenticated, service_role;

comment on function public.snapshot_business_parameters() is
  'Read-only, founder-independent view of the pricing parameters a quote snapshot freezes (§1.7). Exists so a STAFF member creating a quote gets the real rates instead of a silent zero-row read; the business_parameters TABLE itself stays founder-only, as does the /admin/parameters screen that edits it.';

-- Output columns are deliberately prefixed so they cannot collide with the
-- selected column names inside the body (a RETURNS TABLE output name and a
-- same-named column are ambiguous in a LANGUAGE sql body).
create or replace function public.quote_origin_suppliers(p_supplier_ids uuid[])
returns table (supplier_id uuid, supplier_origin_region text, supplier_country text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.origin_region, s.country
    from public.suppliers s
   where s.id = any (coalesce(p_supplier_ids, array[]::uuid[]));
$$;

revoke all on function public.quote_origin_suppliers(uuid[]) from public;
grant execute on function public.quote_origin_suppliers(uuid[]) to authenticated, service_role;

comment on function public.quote_origin_suppliers(uuid[]) is
  'Origin-grouping fields (region/country) for the given suppliers — the minimum a staff-created quote needs to build its shipment-origin cost pools. Deliberately excludes name, notes, default_currency, lead times and every other column of the founder-only supplier ledger.';

-- ----------------------------------------------------------------------------
-- 8. public.quote_origins — closed outright, including its own bridge
--    functions (re-review finding, 2026-08-08; the first pass at this closed
--    the table but not the actual hole — see below). Still
--    `for all to authenticated using (true)` from 20260713000002_rls.sql:86
--    before this section runs.
--
-- Every non-key column here is a supplier-cost or shipment-cost figure —
-- freight_export_fees_usd, ocean_freight_usd, marine_insurance_usd,
-- port_handling_usd, brokerage_usd, duty_gct_pct, cif_basis_usd,
-- total_shipment_cost_usd, and supplier_invoice_total (already on
-- lib/roles/costFree.ts's COST_FIELD_NAMES list). A staff JWT plus the public
-- anon key reads the complete shipment cost build-up of every quote straight
-- off PostgREST — `GET /rest/v1/quote_origins?select=*` — with no app code
-- involved. This table belongs in the same category as extracted_prices and
-- product_price_history above: its whole purpose is cost.
--
-- Unlike those two, it cannot simply be closed at the table and left there:
-- staff legitimately create and edit quotes (§7 above), and quote
-- creation/editing both reads AND WRITES this table as the landed-cost
-- engine's working storage — lib/quotes/persist.ts (loadQuoteState,
-- persistComputed, ensureOriginForSupplier, regroupLineItemOrigins), the
-- door-register materialization in app/admin/projects/[id]/actions.ts
-- (createDoorRegisterQuote — staff-usable, no founder gate), the quote
-- builder page render (app/admin/quotes/[id]/page.tsx — fetches origins for
-- EVERY viewer, staff included, to run the engine for the client-price
-- totals staff do see), and the quote PDF (lib/quotes/pdf.ts, reachable by
-- staff via the unconditional "Download PDF" link — its route only checks
-- getCurrentUser(), not founder). Under RLS a denied SELECT returns ZERO ROWS
-- with error = null, not an error (§7's own rationale) — so cutting off this
-- table's read path without a replacement would not fail loudly, it would
-- silently zero out every shipment cost in a staff-created or staff-viewed
-- quote's totals.
--
-- FIRST PASS (superseded below): the table was made founder-only and four
-- SECURITY DEFINER functions were added, granted to `authenticated,
-- service_role`, so staff could reach the exact read/insert/update/delete
-- shapes the app's own quote-engine code performs. That closed the TABLE but
-- not the real hole: the functions were still callable by any `authenticated`
-- session, `quote_origins_for_quote` accepted a caller-supplied p_quote_id
-- with no entitlement check and returned the full row, and quote ids are
-- freely enumerable (`GET /rest/v1/quotes?select=id`, quotes itself stays
-- `using (true)`) — so a staff JWT plus the anon key could still loop the RPC
-- over every quote id and read the complete shipment-cost build-up of the
-- entire business, one HTTP call away instead of zero. The three write
-- functions were equally unscoped by caller identity: any authenticated
-- caller could insert origin rows into ANY quote including approved/sent
-- ones, or update/delete any row by raw id.
--
-- SECOND PASS (what actually ships): the four functions below are granted to
-- `service_role` ONLY — no `authenticated` grant at all. Direct RPC access
-- from a staff or founder JWT plus the anon key is refused outright, closing
-- both the table and the bridge. The app-layer call sites that need these
-- shapes — the same four files named above (lib/quotes/persist.ts,
-- lib/quotes/pdf.ts, app/admin/quotes/[id]/page.tsx,
-- app/admin/projects/[id]/actions.ts) — are rewired in this same commit onto
-- `createAdminClient()` (lib/supabase/admin.ts), the existing service-role
-- client already used elsewhere for privileged server-side work. Each
-- rewired call site carries a comment that the admin client bypasses RLS
-- entirely, so it must never be handed a quote id the calling session isn't
-- entitled to — a non-issue today (every staff and founder session is
-- entitled to every quote) but load-bearing if that ever changes.
-- `quote_origins_update_computed` and `quote_origins_delete` now also take a
-- `p_quote_id` and scope their WHERE clause to it, so even a future re-grant
-- back to `authenticated` could not by itself turn either into an
-- unscoped-by-id mass-DML primitive again.
--
-- Every OTHER call site that touches this table directly
-- (app/admin/quotes/[id]/actions.ts editOrigin,
-- app/admin/quotes/[id]/workflowActions.ts createRevision,
-- app/admin/quotes/[id]/lineItemActions.ts,
-- app/admin/price-files/[id]/review/actions.ts) is already founder-gated with
-- requireFounderAction at the app layer and reads/writes the table directly
-- (not via these functions) using the request-bound client, so is_founder()
-- on the table's own RLS policy passes for them unchanged and they need no
-- code change. lib/invoices/itemization.ts and lib/reports/load.ts also read
-- this table, but /admin/invoices and /admin/reports are founder-gated whole
-- at the layout level (requireFounderPage), so they are unaffected too.
-- ----------------------------------------------------------------------------
drop policy if exists quote_origins_founder_all on public.quote_origins;
create policy quote_origins_founder_all on public.quote_origins
  for all to authenticated using (public.is_founder()) with check (public.is_founder());

-- Full-row read of a quote's origin pools, in the order every existing call
-- site already expects. Every reader (the quote builder page, the quote PDF,
-- and lib/quotes/persist.ts) needs every column — the engine cannot compute a
-- landed cost from a partial row — so unlike quote_origin_suppliers() this is
-- not narrowed to a column subset. What is withheld is everything else about
-- the table: no ad-hoc filter, sort or join beyond what the app already does,
-- and no access to any OTHER founder-only table through it.
create or replace function public.quote_origins_for_quote(p_quote_id uuid)
returns setof public.quote_origins
language sql
stable
security definer
set search_path = public
as $$
  select *
    from public.quote_origins
   where quote_id = p_quote_id
   order by origin_label;
$$;

revoke all on function public.quote_origins_for_quote(uuid) from public;
grant execute on function public.quote_origins_for_quote(uuid) to service_role;

comment on function public.quote_origins_for_quote(uuid) is
  'Full-row read of a quote''s shipment-origin cost pools, for the landed-cost engine (staff and founder alike — quote_origins itself stays founder-only). service_role only: called from the server via lib/supabase/admin.ts createAdminClient(), never directly by an authenticated session. The caller is responsible for only ever passing a quote id the requesting session is entitled to.';

-- Creates one origin row per label with the same seed defaults every existing
-- INSERT call site already used (freight 0; ocean/marine/brokerage null so
-- the engine applies its fallback formulas; pallet_count 1). Covers: a
-- brand-new line_item-mode line that needs somewhere to land
-- (ensureOriginForSupplier), reconciling a line_item quote's pools after an
-- edit (regroupLineItemOrigins), and materializing a door_register quote's
-- pools at creation (createDoorRegisterQuote) — the one staff-usable direct
-- writer this closes. The column set is fixed by the function body, not
-- caller-supplied, so this cannot be used to write any column other than the
-- seven every existing INSERT already wrote.
--
-- Output columns are deliberately prefixed (new_origin_id / new_origin_label,
-- not id / origin_label) so they cannot collide with the actual quote_origins
-- columns named in the RETURNING clause below — a RETURNS TABLE output name
-- and a same-named column are ambiguous in a LANGUAGE sql body. Postgres
-- resolves the unqualified `returning id, origin_label` below to the table's
-- own columns (column-over-parameter), so the unprefixed names were correct
-- either way, but that relied on the resolution rule rather than ruling the
-- ambiguity out — matching the defensive prefixing quote_origin_suppliers()
-- already uses above, and removing one more way `check_function_bodies`
-- could abort this whole migration.
create or replace function public.quote_origins_insert(
  p_quote_id uuid,
  p_labels text[],
  p_port_handling_usd numeric,
  p_duty_gct_pct numeric
)
returns table (new_origin_id uuid, new_origin_label text)
language sql
security definer
set search_path = public
as $$
  insert into public.quote_origins (
    quote_id, origin_label, freight_export_fees_usd, ocean_freight_usd,
    marine_insurance_usd, port_handling_usd, brokerage_usd, pallet_count, duty_gct_pct
  )
  select p_quote_id, lbl, 0, null, null, p_port_handling_usd, null, 1, p_duty_gct_pct
    from unnest(coalesce(p_labels, array[]::text[])) as lbl
  returning id, origin_label;
$$;

revoke all on function public.quote_origins_insert(uuid, text[], numeric, numeric) from public;
grant execute on function public.quote_origins_insert(uuid, text[], numeric, numeric) to service_role;

comment on function public.quote_origins_insert(uuid, text[], numeric, numeric) is
  'Creates new shipment-origin pools with the standard engine-fallback defaults (persist.ts ensureOriginForSupplier / regroupLineItemOrigins, and createDoorRegisterQuote). Cannot write any column beyond the seven the function body fixes. service_role only: called via lib/supabase/admin.ts createAdminClient().';

-- Writes back exactly the three computed caches persistComputed produces —
-- nothing else on the row is reachable through this function. The editable
-- freight/insurance/brokerage INPUTS stay founder-only via direct table
-- access (app/admin/quotes/[id]/actions.ts editOrigin is already
-- requireFounderAction-gated), matching the app-layer rule that only a
-- founder edits those. Scoped to p_quote_id as well as p_id so that even if
-- this function's grant were ever loosened again, it could not become an
-- unscoped-by-id UPDATE primitive on its own.
create or replace function public.quote_origins_update_computed(
  p_id uuid,
  p_quote_id uuid,
  p_supplier_invoice_total numeric,
  p_cif_basis_usd numeric,
  p_total_shipment_cost_usd numeric
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.quote_origins
     set supplier_invoice_total = p_supplier_invoice_total,
         cif_basis_usd = p_cif_basis_usd,
         total_shipment_cost_usd = p_total_shipment_cost_usd
   where id = p_id
     and quote_id = p_quote_id;
$$;

revoke all on function public.quote_origins_update_computed(uuid, uuid, numeric, numeric, numeric) from public;
grant execute on function public.quote_origins_update_computed(uuid, uuid, numeric, numeric, numeric) to service_role;

comment on function public.quote_origins_update_computed(uuid, uuid, numeric, numeric, numeric) is
  'Persists the landed-cost engine''s per-origin computed caches (lib/quotes/persist.ts persistComputed). Scoped to p_quote_id as well as p_id; cannot touch any other column on the row. service_role only: called via lib/supabase/admin.ts createAdminClient().';

-- Deletes origin rows regroupLineItemOrigins has already re-pointed every
-- line away from (its own doc comment, step 4) — never a row still in use.
-- Scoped to p_quote_id so this cannot become an unscoped-by-id mass-DML
-- primitive if the grant is ever loosened again.
create or replace function public.quote_origins_delete(p_ids uuid[], p_quote_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.quote_origins
   where id = any (coalesce(p_ids, array[]::uuid[]))
     and quote_id = p_quote_id;
$$;

revoke all on function public.quote_origins_delete(uuid[], uuid) from public;
grant execute on function public.quote_origins_delete(uuid[], uuid) to service_role;

comment on function public.quote_origins_delete(uuid[], uuid) is
  'Deletes shipment-origin pools by id, scoped to p_quote_id — for lib/quotes/persist.ts regroupLineItemOrigins reconciling a line_item quote''s pools after an edit. service_role only: called via lib/supabase/admin.ts createAdminClient().';

-- ----------------------------------------------------------------------------
-- 9. public.pipeline_view — close the RLS-bypass latent in every plain view
--    (re-review finding, 2026-08-08). Defined in 20260713000001_schema.sql:403,
--    last replaced by 20260717000001_pipeline_view_kpi_columns.sql:36.
--
-- A plain (non-materialized) view with no `security_invoker` option runs its
-- query with the VIEW OWNER's privileges, not the querying session's — RLS on
-- the underlying tables is evaluated as the owner, which for a view created by
-- a migration is a superuser/owner role that bypasses RLS entirely. This view
-- selects q.total_landed_usd (a cost figure) and is granted to `authenticated`
-- (only `anon` is revoked, by 20260717000001:70), so any future tightening of
-- RLS on enquiries/projects/quotes would silently NOT apply here — the view
-- would keep returning every row to every authenticated session regardless.
--
-- Today this changes nothing observable: enquiries/projects/quotes all stay
-- `using (true)` for `authenticated` (§6 above only tightens the tables listed
-- there, and none of the three this view joins are among them), so an
-- invoker-rights read hits the identical permissive policies an owner-rights
-- read already did. The fix is purely defence in depth — it retires a bypass
-- that would otherwise sit latent until the day one of those three tables
-- IS tightened, at which point it would quietly stop being enforced here.
--
-- `security_invoker` is a real view option since Postgres 15 (`alter view …
-- set (security_invoker = true)`); Supabase's managed Postgres is on 15+ for
-- every project new enough to run this schema, so the syntax is valid here.
-- Nothing about /admin/pipeline or the /admin dashboard KPI tiles changes:
-- both already query through the request-bound RLS client (lib/supabase/server.ts),
-- so they were always subject to the CALLING session's own row visibility for
-- everything else on the page — this just makes the view consistent with that,
-- instead of the one silent exception to it.
-- ----------------------------------------------------------------------------
alter view public.pipeline_view set (security_invoker = true);

commit;
