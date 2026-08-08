import type { UserRow } from "@/lib/supabase/types";

/**
 * The decision `getCurrentUser()` makes, extracted so it can be unit-tested
 * without a Supabase session (session.test.ts). lib/auth.ts does the I/O and
 * delegates the judgement here.
 *
 * This is the single most important function in the access-control boundary:
 * every one of the ~90 pre-existing `const user = await getCurrentUser(); if
 * (!user) …` checks in this app inherits whatever it decides.
 */

export interface RawUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  /** Optional so a pre-migration row (no column) is still accepted as active. */
  active?: boolean | null;
  deleted_at?: string | null;
}

export interface AuthUserFacts {
  id: string;
  email: string | null | undefined;
}

/**
 * Resolves the authenticated Supabase user + their `public.users` row into the
 * app's current user, or null for "treat as not signed in".
 *
 * Null (denied) when:
 *   - there is no authenticated Supabase user at all;
 *   - the row is locked out (`active === false`);
 *   - the row belongs to a removed account (`deleted_at` set) — that row exists
 *     only to keep audit attribution readable, never to grant access;
 *   - THERE IS NO `public.users` ROW AT ALL.
 *
 * That last one is the fix from the security review of 2026-08-08 (MAJOR-1).
 * This function used to resolve a row-less session to `{role:"staff",
 * active:true}` on the reasoning that staff is the least-privileged role. But
 * least-privileged is not the same as no privilege: staff is a real account with
 * real access to enquiries, companies, projects, quotes and orders. Combined
 * with Supabase's default of email sign-ups being ENABLED, that meant anybody
 * who could reach the project's auth endpoint — the anon key is public by
 * definition — could register themselves and walk into /admin as staff.
 *
 * An unknown session is now REFUSED. Access to this admin is invite-only: a
 * founder inviting someone from /admin/team creates their `public.users` row in
 * the same action (app/admin/team/actions.ts), so by the time they follow the
 * emailed link their row already exists and they sign in normally. Nothing
 * legitimate depends on the old fallback.
 *
 * (The migration header also spells out that email sign-ups must be turned OFF
 * in the Supabase dashboard. That is defence in depth, not the fix: this
 * function denies regardless of what the auth provider is configured to allow.)
 */
export function resolveSessionUser(
  authUser: AuthUserFacts | null | undefined,
  row: RawUserRow | null | undefined
): UserRow | null {
  if (!authUser) return null;

  if (row) {
    if (row.deleted_at) return null;
    if (row.active === false) return null;
    return {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      role: row.role,
      // Narrowed to true/null/undefined by the guard above; a row with no
      // `active` column at all (pre-migration) counts as active.
      active: row.active ?? true,
    };
  }

  // No row → not a Veridan user. Deny.
  return null;
}
