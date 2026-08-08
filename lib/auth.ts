"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveSessionUser, type RawUserRow } from "@/lib/roles/session";
import type { UserRow } from "@/lib/supabase/types";

/**
 * Syncs the signed-in user's `public.users` row (email / display name only).
 * Called right after a successful sign-in from the login form (Task 5 —
 * "users table sync on first login"). Safe to call repeatedly.
 *
 * ROLE / ACTIVE ARE NEVER WRITTEN HERE. That is the whole point of splitting
 * this into an explicit select + update/insert instead of the upsert it used to
 * be: an upsert's ON CONFLICT clause is generated from the payload keys, so the
 * old version happened to preserve `role` — but only by accident, and only for
 * as long as nobody added a field to the payload. Now it is structural:
 *
 *   - existing row → UPDATE email, display_name. Role and active are untouched,
 *     so a user invited as 'staff' stays staff after their first login, and a
 *     deactivated user cannot resurrect themselves by signing in.
 *   - no row yet   → REFUSED. This is invite-only software.
 *
 * That refusal is the other half of MAJOR-1 (security review 2026-08-08).
 * Denying a row-less session in lib/roles/session.ts achieves nothing on its own
 * if the very next thing that happens is this function CREATING the row: a
 * self-registered account would be denied for exactly one request and admitted
 * as staff on the second. So account creation now lives in exactly one place —
 * a founder's invite in app/admin/team/actions.ts, which writes the row with the
 * service-role client and an explicit role. There is no other path in.
 *
 * The database backs this up: `authenticated` has no UPDATE privilege on the
 * role/active columns at all (per-column grants in the same migration), so even
 * a hand-crafted PostgREST call from a signed-in staff member cannot promote
 * anyone. Role changes go through /admin/team, which uses the service-role
 * client server-side.
 */
export async function syncUserRecord(): Promise<{
  error: string | null;
  deactivated?: boolean;
}> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: userError?.message ?? "Not authenticated." };
  }

  const displayName =
    (user.user_metadata?.display_name as string | undefined) ??
    (user.user_metadata?.full_name as string | undefined) ??
    null;

  const { data: existing } = await supabase
    .from("users")
    .select("id, active, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) {
    const row = existing as { active?: boolean; deleted_at?: string | null };
    if (row.deleted_at) {
      // Should be unreachable — the Supabase Auth user was deleted, so there is
      // nothing left to sign in with. Handled anyway rather than assumed.
      return {
        error: "This Veridan account has been removed.",
        deactivated: true,
      };
    }
    if (row.active === false) {
      // Signal to the login form so it can sign the session back out rather
      // than dropping the user into an admin shell that will bounce them.
      return {
        error:
          "This Veridan account has been deactivated. Ask a founder to reactivate it.",
        deactivated: true,
      };
    }

    const { error } = await supabase
      .from("users")
      .update({ email: user.email ?? "", display_name: displayName })
      .eq("id", user.id);

    return { error: error?.message ?? null };
  }

  // No row, and we do NOT make one. `deactivated: true` reuses the login form's
  // existing "sign this session straight back out" path, which is exactly the
  // right handling: the credentials were valid, the account is not.
  return {
    error:
      "This Supabase account has no Veridan admin profile, so it cannot sign in. " +
      "Access is by invitation only — ask a founder to invite you from the Team page.",
    deactivated: true,
  };
}

/**
 * Returns the current session's user + their `public.users` row, or null if
 * unauthenticated — the contract every caller in this app already relies on
 * (`if (!user) return "You must be signed in"`).
 *
 * Two deliberate tightenings, both of which make every one of those existing
 * checks stronger without touching them:
 *
 *  1. A DEACTIVATED user resolves to null. Deactivation therefore denies access
 *     everywhere at once — the admin layout, every server action, every route
 *     handler — rather than depending on ~90 call sites each remembering to ask.
 *
 *  2. A session with NO `public.users` row resolves to null as well. It briefly
 *     resolved to a staff user instead, which — with Supabase's default of email
 *     sign-ups enabled — meant self-registration into /admin. Rows are created
 *     only by a founder's invite, so "no row" now means "not a Veridan user".
 */
export async function getCurrentUser(): Promise<UserRow | null> {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    // Supabase env vars not configured (e.g. local build without
    // .env.local) — treat as unauthenticated rather than crashing.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("id, email, display_name, role, active, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  // The judgement itself lives in lib/roles/session.ts so it can be unit-tested
  // (inactive → null, removed → null, unsynced → least privilege).
  return resolveSessionUser(
    { id: user.id, email: user.email },
    (data as RawUserRow | null) ?? null
  );
}

/** Signs the current session out and redirects to /login. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
