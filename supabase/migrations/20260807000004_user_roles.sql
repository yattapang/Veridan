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
-- ============================================================================

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

create policy users_select_authenticated on public.users
  for select to authenticated
  using (true);

create policy users_insert_self on public.users
  for insert to authenticated
  with check (id = auth.uid());

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
-- ----------------------------------------------------------------------------
create or replace function public.assert_active_founder_remains()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.users where role = 'founder' and active) = 0 then
    raise exception 'At least one active founder must remain (attempted change would leave none).'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

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
create table public.user_admin_audit_log (
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
create index idx_user_admin_audit_log_target_user_id on public.user_admin_audit_log (target_user_id);
create index idx_user_admin_audit_log_changed_by on public.user_admin_audit_log (changed_by);
create index idx_user_admin_audit_log_changed_at on public.user_admin_audit_log (changed_at desc);

alter table public.user_admin_audit_log enable row level security;

create policy user_admin_audit_log_founder_all on public.user_admin_audit_log
  for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

grant select, insert, update, delete on public.user_admin_audit_log to authenticated;

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
-- KNOWN LIMITATION (deliberate, documented): RLS is row-level, not column-level.
-- Cost COLUMNS on tables a staff member legitimately needs — products.unit_cost,
-- quote_line_items.unit_cost / landed_cost_usd, quotes.total_landed_usd,
-- hardware_set_line_items.unit_cost_override — stay readable to any authenticated
-- session that queries PostgREST directly. Hiding those would need per-column
-- grants (which cannot distinguish founder from staff — both are the `authenticated`
-- DB role) or a parallel set of cost-free views wired through every founder page.
-- They are hidden at the app layer (lib/roles/matrix.ts canViewCosts + the field
-- guards in app/admin/**), which stops the realistic threat: a staff member using
-- the admin UI. Closing it at the DB needs a views refactor — out of scope here.
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
