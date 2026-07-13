"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRow } from "@/lib/supabase/types";

/**
 * Upserts the signed-in user's `public.users` row (id/email/display name).
 * Called right after a successful sign-in from the login form (Task 5 —
 * "users table sync on first login"). Safe to call repeatedly; it's a
 * no-op-ish upsert on every login, keeping email/display_name current if
 * they change in Supabase Auth.
 */
export async function syncUserRecord(): Promise<{ error: string | null }> {
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

  const { error } = await supabase.from("users").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      display_name: displayName,
    },
    { onConflict: "id" }
  );

  return { error: error?.message ?? null };
}

/**
 * Returns the current session's user + their `public.users` row, or null
 * if unauthenticated. Used by `app/admin/layout.tsx` for the server-side
 * auth check and current-user display.
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
    .select("id, email, display_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (data) return data as UserRow;

  // Row not synced yet (e.g. first login raced the sync call) — fall back
  // to auth.users data so the shell still renders something sensible.
  return {
    id: user.id,
    email: user.email ?? "",
    display_name: null,
    role: "founder",
  };
}

/** Signs the current session out and redirects to /login. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
