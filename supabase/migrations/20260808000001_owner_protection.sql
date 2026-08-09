-- ============================================================================
-- Veridan Limited — OWNER protection + atomic ownership transfer
--
-- WHY THIS MIGRATION EXISTS
-- 20260807000004_user_roles.sql introduced founder/staff and one safety net:
-- assert_active_founder_remains(), which guarantees the company always has at
-- least ONE active founder. That is the right invariant for "can anybody still
-- administer this system", and the wrong one for "can anybody remove the person
-- who owns this company". With two founders it is satisfied by either of them —
-- so founder A can demote, lock out or delete founder B and the trigger is
-- perfectly happy, because A is still standing.
--
-- That is acceptable between two co-founders who trust each other. It is not
-- acceptable the moment an EMPLOYEE is given founder-level access to run the
-- business day to day, which is the stated direction. So one row — the owner's —
-- gets protection nobody else can override.
--
-- THE MODEL, and why it is a flag and not a role
--   `is_owner` is a BOOLEAN COLUMN on public.users, not a third value in
--   users_role_check. The Owner is a Founder in every permission check that
--   already exists: is_founder(), lib/roles/matrix.ts, every RLS policy added by
--   20260807000004 and every guard in lib/roles/guards.ts read `role`, and none
--   of them learn about this column. The flag adds PROTECTION ONLY — it grants
--   nothing.
--
--   That is deliberate on two counts. (1) A future Director / Manager ladder
--   will change the role CHECK and the permissions matrix; ownership is
--   orthogonal to seniority and must not have to be re-derived when that
--   happens. (2) Adding an 'owner' role would have meant every `role =
--   'founder'` test in the database and the app silently stopped matching the
--   founder — a whole-codebase change with a whole-codebase blast radius, to
--   express something that is one bit of information.
--
-- WHAT THE TRIGGER BLOCKS — while a row has is_owner = true, NOBODY, through
-- ANY connection (the app, the SQL editor, a service-role script, PostgREST):
--   * changes that row's role away from 'founder'
--   * sets that row's active = false
--   * sets that row's deleted_at (the app's "delete account" soft-delete)
--   * DELETEs that row outright
--   * clears is_owner by hand, outside public.transfer_ownership()
-- and no row may BECOME the owner unless it is an active, non-removed founder.
-- The way out of every one of those is the same: transfer ownership first, and
-- then the ex-owner is an ordinary founder subject to the ordinary rules.
--
-- WHAT IT DELIBERATELY DOES *NOT* TRY TO DO — "only the Owner themselves may
-- demote/deactivate/delete the Owner" was the original shape of rule 3, and it
-- is not implementable here as stated, for two reasons that are worth writing
-- down rather than quietly working around:
--
--   1. NO ACTOR IDENTITY. Every team mutation in this app runs through
--      lib/supabase/admin.ts createAdminClient() — the service-role client —
--      because 20260807000004 revoked the role/active columns from
--      `authenticated` outright. auth.uid() is NULL on a service-role
--      connection, so a trigger cannot tell "the owner is editing their own
--      row" from "a co-founder is editing the owner's row". A trigger that
--      guessed would be worse than no trigger.
--   2. THE APP ALREADY BLOCKS THE SELF CASE ANYWAY. lib/roles/lockout.ts
--      refuses self-demotion ("You cannot change your own role from Founder to
--      Staff"), self-deactivation and self-deletion for EVERY user, owner or
--      not. So "except the Owner themselves" describes an empty set: there is
--      no existing code path by which the owner demotes, deactivates or deletes
--      themselves, and adding one would be a regression in its own right.
--
--   The rule therefore reads "while the flag is held, this row is immutable in
--   those four respects, for everyone" — which is strictly stronger, has no
--   dependence on identity the database cannot see, and has exactly one door:
--   transfer_ownership(). See §5.
--
-- INTERACTION WITH assert_active_founder_remains() — they compose, they do not
-- conflict, and the ordering is not accidental:
--   * users_owner_protection is BEFORE … FOR EACH ROW.
--   * users_keep_one_active_founder is AFTER … FOR EACH STATEMENT.
--   Postgres runs all BEFORE ROW triggers before the row change, and all AFTER
--   STATEMENT triggers once the statement has finished. So the owner rule is
--   evaluated FIRST and aborts the statement before the founder-count check is
--   ever reached; if the owner rule permits the change, the founder-count check
--   still runs and can still veto it independently. Neither can be satisfied by
--   defeating the other.
--   Where BOTH would fire — deactivating an owner who is also the last active
--   founder — the message the caller sees is the owner one, because it is
--   raised first. That is the more useful of the two: it names the actual fix
--   (transfer ownership) rather than the incidental one (promote someone).
--   transfer_ownership() itself only ever writes is_owner, never role or
--   active, so the founder COUNT is unchanged by a transfer and
--   assert_active_founder_remains() passes it without comment.
--
-- KNOWN LIMITATIONS — what this does NOT protect, stated plainly:
--
--   * ANYONE WITH THE POSTGRES SUPERUSER / DATABASE-OWNER CONNECTION (the
--     Supabase dashboard SQL editor, `supabase db` with the DB password, a
--     restored backup) CAN UNDO ALL OF THIS. `alter table public.users disable
--     trigger users_owner_protection`, then do anything. No trigger can defend
--     against the role that owns the trigger. This protects against a founder
--     acting through the APP and against a service-role script — which is the
--     realistic threat, because the service key is what the app ships with and
--     what an employee-founder could conceivably get at. It is NOT a defence
--     against whoever holds the database credentials themselves. If that
--     matters, the database password must stop being shared, which is an
--     operational control, not a SQL one.
--   * THE BREAK-GLASS GUC IS DELIBERATE AND DELIBERATELY WEAK. §4 refuses to
--     let is_owner be cleared unless the transaction has set
--     `veridan.ownership_transfer = 'on'`, which transfer_ownership() does with
--     `set_config(..., is_local => true)`. Anything that can already run
--     arbitrary SQL can set that GUC itself. Its job is to stop an ACCIDENT —
--     a stray `update public.users set is_owner = false` in a maintenance
--     script, a bad WHERE clause — and to force the flag through the one path
--     that validates the recipient and writes the audit row. It is a guard
--     rail, not a lock, and it is documented here as such so nobody mistakes
--     it for one.
--   * WHO INITIATED A TRANSFER IS ENFORCED IN THE SERVER ACTION, NOT HERE.
--     transfer_ownership() verifies that p_from IS the current owner and that
--     p_to is a legitimate recipient, but it cannot verify that the human
--     driving the request IS p_from — same missing auth.uid() as above. That
--     check lives in app/admin/team/actions.ts transferOwnership(), which
--     re-derives the session with requireFounderAction() and compares the
--     session's user id against the live owner row, exactly the way every
--     other founder-gated action in this app derives its authority. The
--     function is granted to service_role ONLY (no `authenticated` grant at
--     all), so it is unreachable by RPC from a signed-in session + anon key.
--   * THE OWNER'S SUPABASE AUTH USER CAN STILL BE DELETED FROM THE SUPABASE
--     DASHBOARD. This migration governs public.users. 20260807000004 already
--     severed the auth.users FK cascade, so deleting the owner's auth user
--     destroys their SIGN-IN while leaving a public.users row that still says
--     is_owner = true — protected, flagged, and unusable. Recovery is to
--     transfer ownership to the remaining founder (which this migration
--     supports and which does not require the old owner to be reachable, only
--     the new one to be an active founder). Auth-side deletion cannot be
--     blocked from SQL; it is called out here so the recovery path is known
--     before it is needed rather than discovered during it.
--   * NOTHING HERE CHANGES ACCESS. The owner sees exactly what any founder
--     sees, no more. If the intent were ever "the owner sees things other
--     founders do not", that is a permissions change and belongs in
--     lib/roles/matrix.ts and the RLS policies, not in this file.
--
-- RE-RUNNABLE: `begin; … commit;`, every statement idempotent
-- (`if not exists` / `drop … if exists` / `create or replace`). The seed in §3
-- is a no-op — never an error — if the founder's row is absent or if an owner
-- already exists.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. public.users.is_owner
--
-- Defaults false, so every existing row and every future invite is a non-owner
-- until deliberately made one. `authenticated` has no write access to it: the
-- column grants in 20260807000004 §3 are `grant update (email, display_name)`
-- and `grant insert (id, email, display_name)` after a blanket revoke, and this
-- column is in neither list — so a signed-in session cannot set it on itself or
-- anyone else via PostgREST, for the same structural reason it cannot set
-- `role`. Nothing needs to be revoked here; the deny is inherited.
-- ----------------------------------------------------------------------------
alter table public.users
  add column if not exists is_owner boolean not null default false;

comment on column public.users.is_owner is
  'Ownership flag — NOT a role. The owner is a founder in every permission check (role stays ''founder''); this column only makes their row un-demotable, un-deactivatable and un-deletable by anyone else. At most one row may hold it. Moves only via public.transfer_ownership().';

-- ----------------------------------------------------------------------------
-- 2. At most one owner, ever
--
-- Partial unique index rather than a unique constraint on the column itself:
-- `unique (is_owner)` would also permit only ONE non-owner, which is absurd.
-- The predicate restricts the index to the true rows, so false is unconstrained
-- and true is unique.
--
-- Note for §5: this index is NOT deferrable (a partial unique index cannot be),
-- so it is enforced row-by-row as each tuple is written — which is why the
-- transfer clears the old owner before setting the new one instead of trying to
-- express the swap as a single `set is_owner = (id = p_to)` UPDATE. That form
-- would fail with a duplicate-key error whenever the scan happened to reach the
-- incoming owner first, non-deterministically. See §5.
-- ----------------------------------------------------------------------------
create unique index if not exists idx_users_single_owner
  on public.users (is_owner)
  where is_owner;

-- ----------------------------------------------------------------------------
-- 3. Seed the founder as owner
--
-- Matched on email, case-insensitively, and guarded three ways so this can
-- never abort the migration:
--   * `where not exists (… where is_owner)` — if an owner already exists (a
--     re-run, or ownership has since been transferred) this updates zero rows
--     rather than fighting the unique index.
--   * matching on email means zero rows if that account is absent — an UPDATE
--     that matches nothing is a success, not an error.
--   * it runs BEFORE §4 creates the protection trigger, so it cannot be
--     rejected by the "may only become owner if an active founder" rule while
--     that row is mid-normalisation.
--
-- Deliberately NOT keyed on the id d80ca93f-… : an id is unverifiable by
-- reading this file, and if it were ever wrong the migration would silently
-- seed nothing and leave the system unprotected while appearing to succeed.
-- ----------------------------------------------------------------------------
update public.users
   set is_owner = true
 where lower(email) = 'yattapang@gmail.com'
   and deleted_at is null
   and not exists (select 1 from public.users where is_owner);

-- ----------------------------------------------------------------------------
-- 4. The protection trigger
--
-- BEFORE … FOR EACH ROW, because the rules are per-row and compare OLD to NEW;
-- the existing founder-count trigger is AFTER … FOR EACH STATEMENT because its
-- rule is about the table's end state. Different questions, different shapes,
-- and they run in that order (see the header).
--
-- SECURITY DEFINER + `set search_path = public` for the same reasons
-- assert_active_founder_remains() is: the function must not be redirectable at
-- a shadow `users` table via a caller-controlled search_path, and it must not
-- depend on the invoking session's RLS visibility. `revoke all … from public`
-- matches the hygiene every other definer function in 20260807000004 follows.
-- ----------------------------------------------------------------------------
create or replace function public.assert_owner_protected()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  transferring boolean := coalesce(current_setting('veridan.ownership_transfer', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.is_owner then
      raise exception
        'Cannot delete the owner account (%). Transfer ownership to another active founder first, then delete.',
        old.email
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- ---- The row IS the owner and is staying the owner: freeze the four fields
  -- that would otherwise end their access or their authority.
  if old.is_owner and new.is_owner then
    if new.role is distinct from old.role then
      raise exception
        'Cannot change the owner''s role (%). The owner must remain a founder — transfer ownership first, then change the role.',
        old.email
        using errcode = 'check_violation';
    end if;

    if new.active is distinct from true then
      raise exception
        'Cannot deactivate the owner account (%). Transfer ownership to another active founder first.',
        old.email
        using errcode = 'check_violation';
    end if;

    if new.deleted_at is not null and old.deleted_at is null then
      raise exception
        'Cannot mark the owner account (%) as removed. Transfer ownership to another active founder first.',
        old.email
        using errcode = 'check_violation';
    end if;
  end if;

  -- ---- The flag is being GIVEN UP. Only transfer_ownership() may do this; it
  -- sets the transaction-local GUC below before it writes. Everything else —
  -- a stray UPDATE, a maintenance script, a hand-typed statement — is refused,
  -- so the flag cannot be quietly cleared as step one of "and now delete them".
  -- (A caller that can already run arbitrary SQL can set the GUC itself; this
  -- is a guard rail against accident, and the header says so plainly.)
  if old.is_owner and not new.is_owner and not transferring then
    raise exception
      'Ownership cannot be cleared directly. Use public.transfer_ownership(from, to), which moves it to another active founder in one transaction and records the change.'
      using errcode = 'check_violation';
  end if;

  -- ---- The flag is being TAKEN UP. An owner who is not an active founder is a
  -- protected row that cannot administer anything and cannot be repaired, so
  -- the state is refused at the point it would be created rather than left to
  -- be discovered later.
  if new.is_owner and not coalesce(old.is_owner, false) then
    if new.role is distinct from 'founder' then
      raise exception
        'Only a founder can be the owner (% is %).', new.email, coalesce(new.role, 'null')
        using errcode = 'check_violation';
    end if;
    if new.active is distinct from true then
      raise exception
        'Only an active account can be the owner (% is locked out).', new.email
        using errcode = 'check_violation';
    end if;
    if new.deleted_at is not null then
      raise exception
        'A removed account cannot be the owner (%).', new.email
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.assert_owner_protected() from public;

comment on function public.assert_owner_protected() is
  'Row-level guard for the owner account: while is_owner is true the row cannot be demoted, deactivated, soft-deleted or deleted by anyone, the flag cannot be cleared outside transfer_ownership(), and only an active founder can receive it. Composes with assert_active_founder_remains() — this runs BEFORE ROW, that runs AFTER STATEMENT.';

drop trigger if exists users_owner_protection on public.users;
create trigger users_owner_protection
  before update or delete on public.users
  for each row execute function public.assert_owner_protected();

-- ----------------------------------------------------------------------------
-- 5. Ownership transfer
--
-- Without this the protection is a locked door with no key: an owner who leaves
-- the business, hands it over, or loses access to that mailbox would leave a
-- permanently un-demotable, un-deletable row and no lawful way to move
-- ownership to whoever is actually running the company.
--
-- ATOMICITY. The whole body runs in one transaction — a function call is a
-- single statement to the client, so it either completes or leaves nothing
-- behind. There is no window in which the table has zero owners that any other
-- transaction can observe, and no possibility of the "clear the old one, then
-- fail before setting the new one" outcome that a two-round-trip
-- application-level swap would have.
--
-- Why not literally one UPDATE: `update public.users set is_owner = (id = p_to)
-- where id in (p_from, p_to)` is the obvious single statement, and it is unsafe
-- here. The partial unique index from §2 is not deferrable, so it is checked as
-- each row version is written; if the executor happens to reach p_to first, the
-- incoming `true` collides with p_from's still-live `true` and the statement
-- dies with a duplicate-key error. Whether it fails depends on scan order,
-- which is exactly the kind of intermittent failure that shows up first in
-- production. So the swap is ordered explicitly — clear, then set — inside one
-- transaction, which gives the same all-or-nothing guarantee without depending
-- on the planner.
--
-- CONCURRENCY. Both rows are locked FOR UPDATE, in a deterministic id order,
-- before anything is read or written. Two simultaneous transfers therefore
-- serialise instead of interleaving, and the second one re-reads state the
-- first has already committed — so it fails its "p_from is the current owner"
-- check rather than silently overwriting the first transfer's result.
--
-- AUDIT. The audit row is written HERE rather than in the server action, which
-- is a deliberate departure from the convention in lib/roles/teamAudit.ts.
-- Every other team action writes its audit row from TypeScript because the
-- change and the log are two round trips either way. Here they can be one
-- transaction, and ownership moving with no record of who moved it is the one
-- entry in that log it would be least acceptable to lose. changed_by is p_from:
-- the current owner is the only person permitted to initiate a transfer, which
-- the calling server action verifies against the live session.
--
-- service_role ONLY. No `authenticated` grant, matching the §8 convention in
-- 20260807000004 — a signed-in session plus the public anon key cannot reach
-- this by RPC at all. It is called from the server via createAdminClient().
-- ----------------------------------------------------------------------------

-- The audit log's action CHECK predates this migration and does not know the
-- new verb. Dropped and re-added with it (the constraint name is the one
-- Postgres generates for an inline column CHECK on that table).
alter table public.user_admin_audit_log
  drop constraint if exists user_admin_audit_log_action_check;
alter table public.user_admin_audit_log
  add constraint user_admin_audit_log_action_check check (
    action in (
      'invite', 'role_change', 'deactivate', 'reactivate', 'delete',
      'password_reset', 'ownership_transfer'
    )
  );

create or replace function public.transfer_ownership(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  from_row public.users;
  to_row   public.users;
begin
  if p_from is null or p_to is null then
    raise exception 'Ownership transfer needs both a current owner and a recipient.'
      using errcode = 'check_violation';
  end if;

  if p_from = p_to then
    raise exception 'That account is already the owner.'
      using errcode = 'check_violation';
  end if;

  -- Lock both rows first, lowest id first, so concurrent transfers serialise
  -- rather than racing. Nothing below is read until both locks are held.
  perform 1 from public.users where id in (p_from, p_to) order by id for update;

  select * into from_row from public.users where id = p_from;
  select * into to_row   from public.users where id = p_to;

  if from_row.id is null then
    raise exception 'The current owner account no longer exists.'
      using errcode = 'check_violation';
  end if;
  if to_row.id is null then
    raise exception 'That account no longer exists.'
      using errcode = 'check_violation';
  end if;

  if not from_row.is_owner then
    raise exception 'Only the current owner can transfer ownership (% does not hold it).',
      from_row.email
      using errcode = 'check_violation';
  end if;

  -- The recipient must be able to actually exercise ownership the moment they
  -- receive it. §4 refuses the write anyway; checking here turns a generic
  -- trigger exception into a sentence that says what to fix.
  if to_row.deleted_at is not null then
    raise exception 'Ownership cannot be transferred to a removed account (%).', to_row.email
      using errcode = 'check_violation';
  end if;
  if to_row.role is distinct from 'founder' then
    raise exception 'Ownership can only be transferred to a founder (% is %). Promote them first.',
      to_row.email, coalesce(to_row.role, 'null')
      using errcode = 'check_violation';
  end if;
  if to_row.active is distinct from true then
    raise exception 'Ownership can only be transferred to an active founder (% is locked out). Restore their access first.',
      to_row.email
      using errcode = 'check_violation';
  end if;

  -- Transaction-local permission for §4 to let the flag leave the old row.
  -- is_local => true, so it is discarded at commit/rollback and cannot leak
  -- into a later statement on a pooled connection.
  perform set_config('veridan.ownership_transfer', 'on', true);

  update public.users set is_owner = false where id = p_from;
  update public.users set is_owner = true  where id = p_to;

  insert into public.user_admin_audit_log (
    target_user_id, target_email, action, old_value, new_value, changed_by, reason
  ) values (
    p_to,
    to_row.email,
    'ownership_transfer',
    jsonb_build_object('owner_id', p_from, 'owner_email', from_row.email),
    jsonb_build_object('owner_id', p_to,   'owner_email', to_row.email),
    p_from,
    format('Ownership transferred from %s to %s.', from_row.email, to_row.email)
  );
end;
$$;

revoke all on function public.transfer_ownership(uuid, uuid) from public;
grant execute on function public.transfer_ownership(uuid, uuid) to service_role;

comment on function public.transfer_ownership(uuid, uuid) is
  'Moves public.users.is_owner from p_from to p_to in ONE transaction (clear then set, both rows locked first — the partial unique index in this migration is not deferrable, so a single set-expression UPDATE could collide with itself). Validates that p_from holds ownership and p_to is an active, non-removed founder, and writes the ownership_transfer audit row in the same transaction. service_role only: called from app/admin/team/actions.ts via lib/supabase/admin.ts createAdminClient(), which is also where "the requester IS the current owner" is verified against the live session — this function cannot see auth.uid() on a service-role connection.';

commit;
