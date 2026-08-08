import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRoleSession } from "@/lib/roles/guards";
import { normalizeRole } from "@/lib/roles/matrix";
import { partitionTeam, teamMemberDisplayName } from "@/lib/roles/display";
import { countActiveFounders, type TeamMemberSnapshot } from "@/lib/roles/lockout";
import type { UserAdminAuditLogRow } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { InviteForm } from "./InviteForm";
import { TeamMemberRow, type TeamMemberView } from "./TeamMemberRow";

export const metadata = {
  title: "Team",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  invite: "Invited",
  role_change: "Role changed",
  deactivate: "Locked out",
  reactivate: "Access restored",
  delete: "Account deleted",
  password_reset: "Password reset sent",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Team management (founder-only — see ./layout.tsx).
 *
 * Reads with the service-role client because `last_sign_in_at` lives in
 * auth.users, which only the admin API exposes. Everything this page renders is
 * founder-appropriate by construction: nobody else can reach it, and every
 * mutation re-checks the role for itself in ./actions.ts.
 */
export default async function TeamPage() {
  const session = await getRoleSession();

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return (
      <div className="max-w-3xl">
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Team</h1>
        <InstructiveMessage
          title="Supabase admin is not configured"
          body={`Team management needs the service-role key (${
            err instanceof Error ? err.message : "SUPABASE_SERVICE_ROLE_KEY is missing"
          }). Add SUPABASE_SERVICE_ROLE_KEY to the server environment — never to a NEXT_PUBLIC_ variable — then reload.`}
        />
      </div>
    );
  }

  const [usersResult, authListResult, auditResult] = await Promise.all([
    admin
      .from("users")
      .select("id, email, display_name, role, active, invited_at, deactivated_at, deleted_at, created_at")
      .order("created_at", { ascending: true }),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    admin
      .from("user_admin_audit_log")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(25),
  ]);

  if (usersResult.error) {
    return (
      <div className="max-w-3xl">
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Team</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The users table couldn't be loaded (${usersResult.error.message}). Check that every migration in supabase/migrations has been applied — this page needs 20260807000004_user_roles.sql — then reload.`}
        />
      </div>
    );
  }

  const rows =
    (usersResult.data as
      | {
          id: string;
          email: string;
          display_name: string | null;
          role: string;
          active: boolean;
          invited_at: string | null;
          deactivated_at: string | null;
          deleted_at: string | null;
          created_at: string;
        }[]
      | null) ?? [];

  const lastSignInById = new Map<string, string | null>(
    (authListResult.data?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null])
  );

  const members: TeamMemberView[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: normalizeRole(row.role),
    active: row.active,
    invitedAt: row.invited_at,
    deactivatedAt: row.deactivated_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    lastSignInAt: row.deleted_at ? null : lastSignInById.get(row.id) ?? null,
    isSelf: row.id === session?.user.id,
  }));

  const snapshot: TeamMemberSnapshot[] = members.map((m) => ({
    id: m.id,
    email: m.email,
    role: m.role,
    active: m.active,
    deleted_at: m.deletedAt,
  }));
  const activeFounders = countActiveFounders(snapshot);

  const { current, removed } = partitionTeam(
    members.map((m) => ({ ...m, deleted_at: m.deletedAt, display_name: m.displayName }))
  );

  const audit = (auditResult.data as UserAdminAuditLogRow[] | null) ?? [];
  const nameById = new Map(members.map((m) => [m.id, m]));

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Team</h1>
      <p className="mt-2 max-w-3xl text-sm text-veridan-warm-gray">
        Who can sign in to this admin, and what they can reach. A{" "}
        <strong>Founder</strong> sees everything, including supplier costs, margins, invoices,
        expenses, reports, and this page. <strong>Staff</strong> work the day-to-day — enquiries,
        companies, projects, quotes, orders, products, content — with every cost and margin figure
        hidden. You can move anyone between the two at any time.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-veridan-warm-gray">
        You never handle anyone else&apos;s password. Invites and resets email{" "}
        <em>them</em> a one-time link, and they choose a password you never see.
      </p>

      {authListResult.error && (
        <div className="mt-6">
          <InstructiveMessage
            title="Sign-in history unavailable"
            body={`Last-signed-in times couldn't be read from Supabase Auth (${authListResult.error.message}). Everything else on this page still works.`}
          />
        </div>
      )}

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Invite someone
        </h2>
        <p className="mb-4 text-xs text-veridan-warm-gray">
          They get an email with a one-time link and set their own password. You can change their
          role later in one click.
        </p>
        <InviteForm />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Current team
        </h2>
        <p className="mb-3 text-xs text-veridan-warm-gray">
          {activeFounders === 1
            ? "There is one active founder. They cannot be locked out, demoted, or deleted until another founder exists — otherwise nobody could manage the team, parameters, or finances."
            : `${activeFounders} active founders.`}
        </p>
        <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
          {current.map((member) => (
            <TeamMemberRow
              key={member.id}
              member={member}
              activeFounderCount={activeFounders}
            />
          ))}
        </ul>
      </section>

      {removed.length > 0 && (
        <section className="mt-10">
          <details className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
              Removed accounts ({removed.length})
            </summary>
            <p className="mt-2 text-xs text-veridan-warm-gray">
              These sign-ins were permanently deleted — these people cannot log in, and their email
              addresses are free to use again. Their records are kept only so that past audit
              entries (who approved a margin, who changed a rate, who recorded an expense) still
              show a name instead of &ldquo;unknown&rdquo;.
            </p>
            <ul className="mt-3 space-y-2">
              {removed.map((member) => (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-veridan-warm-gray-light py-2 text-sm last:border-b-0"
                >
                  <span className="text-veridan-warm-gray">
                    {teamMemberDisplayName(member)}{" "}
                    <span className="text-xs">· {member.email}</span>
                  </span>
                  <span className="text-xs text-veridan-warm-gray">
                    Removed {formatDate(member.deletedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Recent changes
        </h2>
        <p className="mb-3 text-xs text-veridan-warm-gray">
          Every invite, role change, lock-out, restore, reset and deletion is recorded with who did
          it and when.
        </p>
        {audit.length === 0 ? (
          <InstructiveMessage
            title="No team changes recorded yet"
            body="Invites, role changes, lock-outs and deletions will appear here as you make them."
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {audit.map((entry) => {
              const actor = nameById.get(entry.changed_by);
              const oldRole = (entry.old_value as { role?: string } | null)?.role;
              const newRole = (entry.new_value as { role?: string } | null)?.role;
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-veridan-warm-gray-light py-3 text-sm last:border-b-0"
                >
                  <span className="text-veridan-ink">
                    <span className="font-medium">
                      {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                    </span>{" "}
                    · {entry.target_email}
                    {entry.action === "role_change" && oldRole && newRole && (
                      <span className="text-veridan-warm-gray">
                        {" "}
                        ({oldRole} → {newRole})
                      </span>
                    )}
                    {entry.reason && (
                      <span className="block text-xs text-amber-700">{entry.reason}</span>
                    )}
                  </span>
                  <span className="text-xs text-veridan-warm-gray">
                    {actor ? teamMemberDisplayName({ ...actor, display_name: actor.displayName, deleted_at: actor.deletedAt }) : "Unknown user"} ·{" "}
                    {formatDateTime(entry.changed_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-10 text-xs text-veridan-warm-gray">
        Changing your own password?{" "}
        <Link
          href="/admin/account"
          className="text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
        >
          Your account
        </Link>
        .
      </p>
    </div>
  );
}
