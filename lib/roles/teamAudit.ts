import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserAdminAuditAction } from "@/lib/supabase/types";

/**
 * Writes one `public.user_admin_audit_log` row per team-administration change.
 *
 * Shape and semantics deliberately mirror the app's two existing audit logs
 * (parameter_audit_log, site_content_audit_log): old_value / new_value jsonb,
 * changed_by, changed_at, reason. Reusing that idiom rather than inventing a
 * third one means anyone who has read those pages already knows how to read
 * this one. A separate TABLE was necessary because both existing logs are keyed
 * by a text subject (`parameter_key` / `content_key`) that a user id cannot
 * meaningfully occupy without breaking their queries and their admin pages.
 *
 * Called with the SERVICE-ROLE client, because the row it writes must land even
 * when the change it records is about to remove the target's own access, and
 * because the invite path writes an audit row for a user that may have no
 * session at all. Never called from anywhere but app/admin/team/actions.ts.
 */
export async function writeUserAdminAudit(
  admin: SupabaseClient,
  entry: {
    targetUserId: string | null;
    targetEmail: string;
    action: UserAdminAuditAction;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
    changedBy: string;
    reason?: string | null;
  }
): Promise<{ error: string | null }> {
  const { error } = await admin.from("user_admin_audit_log").insert({
    target_user_id: entry.targetUserId,
    target_email: entry.targetEmail,
    action: entry.action,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    changed_by: entry.changedBy,
    reason: entry.reason ?? null,
  });

  return { error: error?.message ?? null };
}
