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
 *     only to keep audit attribution readable, never to grant access.
 *
 * When the row has not been created yet (a genuine race: the first-login sync
 * can lose to this read), the fallback carries the LEAST-privileged role. The
 * previous fallback said 'founder', which would have handed a brand-new,
 * unsynced session full founder access the moment a second role existed.
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
      active: row.active !== false,
    };
  }

  return {
    id: authUser.id,
    email: authUser.email ?? "",
    display_name: null,
    role: "staff",
    active: true,
  };
}
