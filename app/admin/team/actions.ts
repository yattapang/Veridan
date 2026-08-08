"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFounderAction } from "@/lib/roles/guards";
import { writeUserAdminAudit } from "@/lib/roles/teamAudit";
import { normalizeRole, type UserRole } from "@/lib/roles/matrix";
import {
  checkActiveChange,
  checkDelete,
  checkDeleteConfirmation,
  checkInvite,
  checkPasswordReset,
  checkRoleChange,
  type TeamMemberSnapshot,
} from "@/lib/roles/lockout";

/**
 * Team administration — founder-only, service-role, server-only.
 *
 * EVERY export here re-derives the caller's role with `requireFounderAction()`.
 * The page guard in app/admin/team/layout.tsx is NOT what protects these: a
 * Server Action is a POST endpoint that any signed-in session can invoke
 * directly, so a page guard alone would be decoration. The same applies to the
 * lockout rules — the UI disables buttons, but the authority is the re-read of
 * the live user list plus the pure checks in lib/roles/lockout.ts below.
 *
 * WHY THE SERVICE-ROLE CLIENT: three things genuinely cannot be done with the
 * caller's own authenticated client, by design.
 *   1. Writing someone else's `role` / `active` — the 20260807000004 migration
 *      revokes those columns from `authenticated` outright, so nobody can
 *      escalate themselves even with a hand-crafted PostgREST call.
 *   2. Supabase Auth admin operations — invite, ban/unban, delete, and reading
 *      last_sign_in_at all live behind the admin API.
 *   3. Writing the audit row for a change that is about to end the target's
 *      access.
 * It is imported only in this file and never reaches a client component
 * (lib/supabase/admin.ts is `server-only`).
 *
 * PASSWORDS: nothing here accepts, generates, displays, or transmits a password
 * for another person. Invites and resets send the USER an email; they choose
 * their own password on /auth/set-password. There is deliberately no code path
 * that could do otherwise.
 */

export type TeamActionResult =
  | { ok: true; message?: string; error?: undefined }
  | { ok: false; error: string; message?: undefined };

function fail(error: string): TeamActionResult {
  return { ok: false, error };
}

/**
 * The app's own origin, for the links in invite / reset emails.
 * NEXT_PUBLIC_SITE_URL is the source of truth; it must also be allow-listed in
 * Supabase → Authentication → URL Configuration, or Supabase will refuse the
 * redirect and fall back to the project's Site URL.
 */
function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    "http://localhost:3000";
  const withScheme = raw.startsWith("http") ? raw : `https://${raw}`;
  return withScheme.replace(/\/$/, "");
}

const SET_PASSWORD_URL = () => `${siteUrl()}/auth/set-password`;

/**
 * Re-reads the live team from the database. Every rule below is evaluated
 * against THIS, never against anything the browser sent.
 */
async function loadTeamSnapshot(
  admin: ReturnType<typeof createAdminClient>
): Promise<{ users: TeamMemberSnapshot[]; error: string | null }> {
  const { data, error } = await admin
    .from("users")
    .select("id, email, role, active, deleted_at");

  if (error) return { users: [], error: error.message };

  const users: TeamMemberSnapshot[] = (
    (data as
      | { id: string; email: string; role: string; active: boolean; deleted_at: string | null }[]
      | null) ?? []
  ).map((u) => ({
    id: u.id,
    email: u.email,
    role: normalizeRole(u.role),
    active: u.active,
    deleted_at: u.deleted_at,
  }));

  return { users, error: null };
}

function revalidateTeam() {
  revalidatePath("/admin/team");
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

/**
 * Invites a colleague by email with a pre-assigned role.
 *
 * Supabase Auth sends THEM a one-time link; they land on /auth/set-password and
 * choose a password nobody else ever sees. The founder never types, receives,
 * or relays a password — there is no field in this app that would accept one for
 * another person, and no generated-password path to display.
 *
 * The `public.users` row is created here, with the chosen role, BEFORE the
 * invitee's first login. lib/auth.ts syncUserRecord then updates only
 * email/display_name on that row, so the pre-assigned role and active flag
 * survive first login untouched.
 */
export async function inviteTeamMember(
  _prevState: TeamActionResult,
  formData: FormData
): Promise<TeamActionResult> {
  const gate = await requireFounderAction("invite someone to the team");
  if (!gate.ok) return fail(gate.error);

  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const roleInput = String(formData.get("role") ?? "staff");
  const role: UserRole = roleInput === "founder" ? "founder" : "staff";

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Supabase admin is not configured.");
  }

  const snapshot = await loadTeamSnapshot(admin);
  if (snapshot.error) return fail(`Could not read the current team (${snapshot.error}).`);

  const allowed = checkInvite(snapshot.users, email);
  if (!allowed.ok) return fail(allowed.error);

  const normalizedEmail = email.toLowerCase();

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    normalizedEmail,
    {
      redirectTo: SET_PASSWORD_URL(),
      data: displayName ? { display_name: displayName } : undefined,
    }
  );

  if (inviteError || !invited?.user) {
    return fail(
      `Could not send the invite: ${inviteError?.message ?? "Supabase returned no user."} ` +
        `If this mentions a redirect URL, add ${SET_PASSWORD_URL()} to Supabase → Authentication → URL Configuration.`
    );
  }

  const { error: rowError } = await admin.from("users").insert({
    id: invited.user.id,
    email: normalizedEmail,
    display_name: displayName || null,
    role,
    active: true,
    invited_at: new Date().toISOString(),
  });

  if (rowError) {
    // The auth user exists but has no profile row. Say so precisely rather than
    // reporting a clean success — the founder needs to know the invite WAS sent.
    return fail(
      `The invite email to ${normalizedEmail} was sent, but their profile row could not be created (${rowError.message}). ` +
        `They would sign in with the lowest access level. Delete the user in the Supabase dashboard and invite again, or add the row by hand.`
    );
  }

  await writeUserAdminAudit(admin, {
    targetUserId: invited.user.id,
    targetEmail: normalizedEmail,
    action: "invite",
    newValue: { role, active: true },
    changedBy: gate.session.user.id,
  });

  revalidateTeam();
  return {
    ok: true,
    message: `Invite sent to ${normalizedEmail} as ${role === "founder" ? "Founder" : "Staff"}. They set their own password from the emailed link.`,
  };
}

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

/** Sets any user's role. Founder ⇄ Staff, one click, per the founder's design. */
export async function setTeamMemberRole(
  userId: string,
  nextRoleInput: string
): Promise<TeamActionResult> {
  const gate = await requireFounderAction("change someone's role");
  if (!gate.ok) return fail(gate.error);

  const nextRole: UserRole = nextRoleInput === "founder" ? "founder" : "staff";

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Supabase admin is not configured.");
  }

  const snapshot = await loadTeamSnapshot(admin);
  if (snapshot.error) return fail(`Could not read the current team (${snapshot.error}).`);

  const target = snapshot.users.find((u) => u.id === userId);
  const allowed = checkRoleChange(snapshot.users, gate.session.user.id, userId, nextRole);
  if (!allowed.ok) return fail(allowed.error);
  if (!target) return fail("That user no longer exists.");

  if (target.role === nextRole) {
    return { ok: true, message: `${target.email} is already ${nextRole}.` };
  }

  const { error } = await admin.from("users").update({ role: nextRole }).eq("id", userId);
  if (error) return fail(`Could not change the role: ${error.message}`);

  await writeUserAdminAudit(admin, {
    targetUserId: userId,
    targetEmail: target.email,
    action: "role_change",
    oldValue: { role: target.role },
    newValue: { role: nextRole },
    changedBy: gate.session.user.id,
  });

  revalidateTeam();
  return {
    ok: true,
    message: `${target.email} is now ${nextRole === "founder" ? "a Founder" : "Staff"}.`,
  };
}

// ---------------------------------------------------------------------------
// Lock out / restore access
// ---------------------------------------------------------------------------

/**
 * Locks a user out, or restores their access. Never a delete — override_log,
 * parameter_audit_log, site_content_audit_log, expenses.recorded_by and friends
 * all attribute real decisions to this user id.
 *
 * Lock-out is IMMEDIATE, not "from their next login", via two independent
 * mechanisms:
 *   1. `active = false` → getCurrentUser() returns null → every page, every
 *      server action, and every route in the app refuses them on their very
 *      next request. This is the real enforcement.
 *   2. The Supabase Auth user is banned via the admin API, which stops token
 *      refresh and makes the auth server itself reject the session. Belt and
 *      braces, and it also blocks anything that talks to Supabase directly.
 */
export async function setTeamMemberActive(
  userId: string,
  nextActive: boolean
): Promise<TeamActionResult> {
  const gate = await requireFounderAction(
    nextActive ? "restore someone's access" : "lock someone out"
  );
  if (!gate.ok) return fail(gate.error);

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Supabase admin is not configured.");
  }

  const snapshot = await loadTeamSnapshot(admin);
  if (snapshot.error) return fail(`Could not read the current team (${snapshot.error}).`);

  const target = snapshot.users.find((u) => u.id === userId);
  const allowed = checkActiveChange(snapshot.users, gate.session.user.id, userId, nextActive);
  if (!allowed.ok) return fail(allowed.error);
  if (!target) return fail("That user no longer exists.");

  if (target.active === nextActive) {
    return {
      ok: true,
      message: `${target.email} is already ${nextActive ? "active" : "locked out"}.`,
    };
  }

  const { error } = await admin
    .from("users")
    .update({
      active: nextActive,
      deactivated_at: nextActive ? null : new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) return fail(`Could not update their access: ${error.message}`);

  // Ban / unban the auth user so an in-flight session dies now rather than
  // lasting out its access token. `ban_duration: 'none'` clears it.
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: nextActive ? "none" : "876000h", // ~100 years
  });

  await writeUserAdminAudit(admin, {
    targetUserId: userId,
    targetEmail: target.email,
    action: nextActive ? "reactivate" : "deactivate",
    oldValue: { active: target.active },
    newValue: { active: nextActive },
    changedBy: gate.session.user.id,
  });

  revalidateTeam();

  if (banError) {
    // The profile flag is what the app enforces on, so access IS already gone.
    // Report the partial failure precisely instead of claiming a clean result.
    return {
      ok: false,
      error: nextActive
        ? `${target.email} is marked active again, but clearing their Supabase Auth ban failed (${banError.message}). They may still be unable to sign in — clear the ban in the Supabase dashboard.`
        : `${target.email} is locked out of this app immediately, but the Supabase Auth ban could not be applied (${banError.message}). App access is already blocked; ban them in the Supabase dashboard for completeness.`,
    };
  }

  return {
    ok: true,
    message: nextActive
      ? `${target.email} can sign in again.`
      : `${target.email} is locked out. Any session they had stops working on their next request.`,
  };
}

// ---------------------------------------------------------------------------
// Permanent deletion
// ---------------------------------------------------------------------------

/**
 * Permanently deletes a user's SIGN-IN while keeping their record.
 *
 * What is destroyed: the Supabase Auth user. Irreversible — they can never sign
 * in again, and the email address is freed for reuse.
 *
 * What is kept: the `public.users` row, stamped `deleted_at` and rendered
 * everywhere as "Name (removed)". This is not a hedge — override_log,
 * parameter_audit_log, site_content_audit_log, user_admin_audit_log,
 * expenses.recorded_by, invoices/quotes/projects created_by and others all
 * attribute business decisions to this id. Purging the row would either fail
 * outright (several of those FKs are `on delete restrict`) or turn "who approved
 * this below-floor margin" into "unknown". The 20260807000004 migration drops
 * the auth.users cascade specifically so this row survives the auth delete.
 */
export async function deleteTeamMember(
  userId: string,
  confirmation: string
): Promise<TeamActionResult> {
  const gate = await requireFounderAction("delete an account");
  if (!gate.ok) return fail(gate.error);

  const typed = checkDeleteConfirmation(confirmation);
  if (!typed.ok) return fail(typed.error);

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Supabase admin is not configured.");
  }

  const snapshot = await loadTeamSnapshot(admin);
  if (snapshot.error) return fail(`Could not read the current team (${snapshot.error}).`);

  const target = snapshot.users.find((u) => u.id === userId);
  const allowed = checkDelete(snapshot.users, gate.session.user.id, userId);
  if (!allowed.ok) return fail(allowed.error);
  if (!target) return fail("That user no longer exists.");

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    return fail(
      `Nothing was deleted. Removing the Supabase Auth sign-in failed (${authError.message}), so their record was left exactly as it was.`
    );
  }

  const { error: rowError } = await admin
    .from("users")
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq("id", userId);

  // Audit first-class, whatever happened to the row update.
  await writeUserAdminAudit(admin, {
    targetUserId: rowError ? null : userId,
    targetEmail: target.email,
    action: "delete",
    oldValue: { role: target.role, active: target.active },
    newValue: { deleted_at: new Date().toISOString(), active: false },
    changedBy: gate.session.user.id,
    reason: rowError ? `Profile row update failed: ${rowError.message}` : null,
  });

  revalidateTeam();

  if (rowError) {
    return {
      ok: false,
      error:
        `${target.email}'s sign-in WAS permanently deleted — they can no longer log in — but marking their record as removed failed (${rowError.message}). ` +
        `Their row still shows as a normal team member; set deleted_at and active = false on it by hand so the team list is accurate.`,
    };
  }

  return {
    ok: true,
    message: `${target.email}'s sign-in is permanently deleted. Their record is kept as "removed" so past audit entries still show who did what.`,
  };
}

// ---------------------------------------------------------------------------
// Password reset (founder-triggered — emails the USER)
// ---------------------------------------------------------------------------

/**
 * Emails a password-reset link to the user themselves.
 *
 * Uses the ordinary (anon-key) client's `resetPasswordForEmail`, which asks
 * Supabase to SEND the email. It deliberately does NOT use the admin
 * `generateLink`, which would hand the reset URL back to this server — and
 * therefore potentially to the founder's screen. The founder learns only that
 * an email went out.
 */
export async function sendTeamMemberPasswordReset(
  userId: string
): Promise<TeamActionResult> {
  const gate = await requireFounderAction("send a password reset");
  if (!gate.ok) return fail(gate.error);

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Supabase admin is not configured.");
  }

  const snapshot = await loadTeamSnapshot(admin);
  if (snapshot.error) return fail(`Could not read the current team (${snapshot.error}).`);

  const target = snapshot.users.find((u) => u.id === userId);
  const allowed = checkPasswordReset(snapshot.users, userId);
  if (!allowed.ok) return fail(allowed.error);
  if (!target) return fail("That user no longer exists.");

  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Supabase is not configured.");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(target.email, {
    redirectTo: SET_PASSWORD_URL(),
  });

  if (error) {
    return fail(
      `Could not send the reset email: ${error.message}. ` +
        `If this mentions a redirect URL, add ${SET_PASSWORD_URL()} to Supabase → Authentication → URL Configuration.`
    );
  }

  await writeUserAdminAudit(admin, {
    targetUserId: userId,
    targetEmail: target.email,
    action: "password_reset",
    newValue: { emailed: true },
    changedBy: gate.session.user.id,
  });

  revalidateTeam();
  return {
    ok: true,
    message: `A reset link was emailed to ${target.email}. Only they can see it — you never handle their password.`,
  };
}
