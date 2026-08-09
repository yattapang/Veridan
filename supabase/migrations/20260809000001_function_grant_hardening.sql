-- ============================================================================
-- Veridan Limited — function EXECUTE grants: close the Supabase default-ACL hole
--
-- WHY THIS MIGRATION EXISTS
-- 20260807000004_user_roles.sql and 20260808000001_owner_protection.sql both
-- follow the pattern:
--
--     revoke all on function public.f() from public;
--     grant execute on function public.f() to service_role;
--
-- and that pattern DOES NOT WORK on Supabase. Verified against the live
-- database immediately after both migrations applied: every function in schema
-- public was still executable by `anon` AND `authenticated`.
--
-- The reason is `alter default privileges`. A Supabase project ships with:
--
--     pg_default_acl, schema public, objtype 'f':
--       postgres=X/postgres | anon=X/postgres |
--       authenticated=X/postgres | service_role=X/postgres
--
-- (and an identical entry owned by supabase_admin). So the instant a function
-- is created in `public`, EXECUTE is granted to `anon` and `authenticated`
-- EXPLICITLY, BY NAME — it is not the implicit PUBLIC grant that a bare
-- `create function` normally carries. `revoke ... from public` removes the
-- implicit PUBLIC grant and leaves a named-role grant completely untouched.
-- Every revoke in both prior migrations was therefore a no-op, and the
-- service_role-only intent documented at length in 20260807000004 §8 was never
-- actually in force.
--
-- WHAT WAS ACTUALLY EXPOSED (live, until this migration runs)
--   * public.snapshot_business_parameters() — callable by ANON. The anon key is
--     public by construction (NEXT_PUBLIC_SUPABASE_ANON_KEY, shipped in the
--     browser bundle of the marketing site). Anyone on the internet could
--     POST /rest/v1/rpc/snapshot_business_parameters and read margin_floor_pct,
--     margin_tiers, contingency_pct, procurement_handling_fee_usd and the FX
--     buffer. This is the company's entire pricing model, and it is the single
--     worst item on this list.
--   * public.quote_origins_for_quote(uuid) — callable by ANON. Full shipment
--     cost build-up (supplier_invoice_total, ocean_freight_usd, brokerage_usd,
--     cif_basis_usd, total_shipment_cost_usd …) for any quote id supplied.
--     Quote ids are not secrets: they appear in client-facing quote URLs, so a
--     CLIENT holding their own quote link could read the exact cost basis and
--     therefore the exact margin being charged to them.
--   * public.quote_origins_insert / _update_computed / _delete — callable by
--     ANON and AUTHENTICATED. Write access to shipment-cost rows.
--   * public.transfer_ownership(uuid, uuid) — callable by AUTHENTICATED. The
--     function validates that p_from currently holds is_owner, but p_from is a
--     CALLER-SUPPLIED ARGUMENT: it verifies that the named account is the
--     owner, never that the caller IS that account (it cannot — auth.uid() is
--     unavailable to it as documented in 20260808000001). The "requester is the
--     owner" check lives in app/admin/team/actions.ts, which a direct RPC call
--     bypasses entirely. So any founder — precisely the employee-with-founder-
--     access this feature exists to defend against — could have called
--     transfer_ownership(<owner id>, <their own id>) and taken ownership.
--     Owner protection was defeated at the database layer from the moment it
--     was created.
--   * public.quote_origin_suppliers(uuid[]) and public.is_founder() — intended
--     for `authenticated`, but also reachable by `anon`. is_founder() is
--     harmless to anon (auth.uid() is null, so it returns false);
--     quote_origin_suppliers leaks supplier origin_region/country to anon.
--   * The trigger functions (assert_owner_protected, assert_active_founder_
--     remains, set_updated_at) were executable by anon/authenticated too.
--     Postgres refuses to invoke a trigger function outside trigger context, so
--     this was not exploitable — but it is granted for no reason and is removed
--     here so the schema states its intent honestly.
--
-- HOW THIS FIXES IT
--   1. §1 revokes EXECUTE from public, anon AND authenticated on EVERY function
--      in schema public — by oid, in a loop, so no signature can be missed and
--      no future-added function is silently skipped by a stale hand-written
--      list. This is the deny-by-default baseline the prior migrations believed
--      they had.
--   2. §2 grants back, explicitly and minimally, only what the application
--      genuinely calls, at the privilege level it genuinely needs.
--   3. §3 fixes the ROOT CAUSE so this cannot recur: it changes the default
--      privileges for functions created in schema public so that anon and
--      authenticated are no longer granted EXECUTE automatically.
--
-- NOTE ON §3 — this changes the behaviour of every FUTURE `create function` in
-- schema public: a new function will NOT be callable by anon or authenticated
-- unless a migration grants it explicitly. That is deliberate, and it is the
-- correct default for this database (deny by default, grant on purpose — the
-- convention both prior migrations already tried to follow). It only applies to
-- objects created by the `postgres` role; the parallel supabase_admin default
-- ACL is owned by Supabase's own superuser and is deliberately left alone.
-- The failure mode if a future migration forgets its grant is a loud, immediate
-- permission error — not silent data exposure — which is the right way round.
-- To reverse it:
--     alter default privileges in schema public
--       grant execute on functions to anon, authenticated;
--
-- NOTE ON THE PRIOR MIGRATIONS: 20260807000004 and 20260808000001 are left
-- exactly as they are. They are already applied to this database, and their
-- ineffective `revoke ... from public` lines are harmless once this migration
-- has run — on a rebuild from scratch this file runs last and produces the same
-- correct end state. Their headers are wrong about what they achieved, and this
-- header is the correction of record.
--
-- RE-RUNNABLE: `begin; … commit;`, and every statement is a revoke/grant with a
-- fixed target end state, so repeated runs converge.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Deny by default — strip EXECUTE from public, anon and authenticated on
--    every function in schema public.
--
-- Driven off pg_proc by oid (`oid::regprocedure` renders the exact, fully
-- qualified, argument-typed signature) rather than a hand-maintained list of
-- names and argument types. A hand-written list is what produced this bug: the
-- prior migrations named all ten functions correctly and still missed the
-- grantee. Anything this loop revokes that is genuinely needed is granted back
-- immediately below, where the full set is visible in one place.
-- ----------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')   -- functions and procedures; not aggregates/windows
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Grant back, minimally and explicitly.
--
-- Matched by NAME (not by signature) so an overload cannot be missed, and
-- guarded by an explicit list so a function added later is not swept in by a
-- pattern. Anything not named here ends up callable by service_role only —
-- which, because service_role bypasses RLS and is never exposed to a browser,
-- is the safe end of the range.
--
--   authenticated + service_role
--     is_founder()                    — every founder-only RLS policy calls it;
--                                       without this, RLS evaluation itself
--                                       fails for a signed-in session.
--     snapshot_business_parameters()  — staff quote creation reads the pricing
--                                       parameters through it (20260807000004
--                                       §7). Still a deliberate, disclosed
--                                       residual: an authenticated caller can
--                                       invoke it directly and read the margin
--                                       floor and tiers. Closing that needs the
--                                       service-role rewire quote_origins got,
--                                       and is NOT in scope here — this
--                                       migration restores the intended
--                                       boundary, it does not move it.
--     quote_origin_suppliers(uuid[])  — same path; origin region/country only.
--     next_invoice_number(...)        — invoice creation; SECURITY INVOKER, so
--                                       RLS on invoices/invoice_counters still
--                                       gates it to founders.
--     record_invoice_payment(...)     — payment recording; likewise invoker
--                                       rights, RLS-gated to founders.
--
--   service_role ONLY
--     quote_origins_for_quote / _insert / _update_computed / _delete
--                                     — 20260807000004 §8's stated intent,
--                                       finally in force. All four call sites
--                                       already use createAdminClient().
--     transfer_ownership(uuid, uuid)  — 20260808000001 §5's stated intent. The
--                                       "requester is the owner" check lives in
--                                       app/admin/team/actions.ts and is only
--                                       meaningful if the function cannot be
--                                       reached around it.
--
--   NOBODY (no grant at all)
--     assert_owner_protected(), assert_active_founder_remains(), set_updated_at()
--                                     — trigger functions. A trigger fires on
--                                       behalf of the table, not the session,
--                                       and needs no EXECUTE grant to anyone.
-- ----------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
  loop
    if fn.proname in (
         'is_founder',
         'snapshot_business_parameters',
         'quote_origin_suppliers',
         'next_invoice_number',
         'record_invoice_payment'
       ) then
      execute format('grant execute on function %s to authenticated, service_role', fn.sig);

    elsif fn.proname in (
            'quote_origins_for_quote',
            'quote_origins_insert',
            'quote_origins_update_computed',
            'quote_origins_delete',
            'transfer_ownership'
          ) then
      execute format('grant execute on function %s to service_role', fn.sig);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. The root cause — stop new functions being auto-granted to anon/authenticated
--
-- Without this, the very next `create or replace function` in schema public
-- re-opens exactly the hole this migration just closed, silently, with no
-- diagnostic anywhere. See the note in the header before changing it.
-- ----------------------------------------------------------------------------
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

commit;
