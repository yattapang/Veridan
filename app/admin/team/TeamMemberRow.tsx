"use client";

import { useState, useTransition } from "react";
import type { UserRole } from "@/lib/roles/matrix";
import { DELETE_CONFIRMATION_WORD } from "@/lib/roles/lockout";
import { teamMemberDisplayName } from "@/lib/roles/display";
import {
  deleteTeamMember,
  sendTeamMemberPasswordReset,
  setTeamMemberActive,
  setTeamMemberRole,
  type TeamActionResult,
} from "./actions";

export interface TeamMemberView {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  active: boolean;
  invitedAt: string | null;
  deactivatedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  isSelf: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const linkClass =
  "text-xs font-medium underline underline-offset-2 disabled:opacity-40 disabled:no-underline";

/**
 * One team member, with the founder's controls.
 *
 * Every disabled button here is a COURTESY, not a control: the same rule is
 * re-evaluated server-side against a fresh read of the user table in
 * ./actions.ts, so editing the DOM or POSTing the action by hand changes
 * nothing. `lib/roles/lockout.ts` holds the rules; these are the same
 * conditions restated for the UI.
 */
export function TeamMemberRow({
  member,
  activeFounderCount,
}: {
  member: TeamMemberView & { display_name?: string | null; deleted_at?: string | null };
  activeFounderCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TeamActionResult | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const isLastActiveFounder =
    member.role === "founder" && member.active && activeFounderCount <= 1;

  const cannotDemote = member.isSelf || isLastActiveFounder;
  const cannotLockOut = member.isSelf || isLastActiveFounder;
  const cannotDelete = member.isSelf || isLastActiveFounder || member.active;

  function run(action: () => Promise<TeamActionResult>) {
    setResult(null);
    startTransition(async () => {
      setResult(await action());
    });
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 border-b border-veridan-warm-gray-light py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-veridan-ink">
            {teamMemberDisplayName({
              display_name: member.displayName,
              email: member.email,
              active: member.active,
              deleted_at: member.deletedAt,
            })}
          </p>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              member.role === "founder"
                ? "bg-veridan-ink text-veridan-paper"
                : "bg-veridan-warm-gray-pale text-veridan-warm-gray"
            }`}
          >
            {member.role === "founder" ? "Founder" : "Staff"}
          </span>
          {!member.active && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
              Locked out
            </span>
          )}
          {member.isSelf && (
            <span className="text-[10px] uppercase tracking-wide text-veridan-warm-gray">You</span>
          )}
        </div>
        <p className="mt-1 text-xs text-veridan-warm-gray">{member.email}</p>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          Last signed in {formatDateTime(member.lastSignInAt)}
          {member.invitedAt ? ` · invited ${formatDate(member.invitedAt)}` : ""}
          {!member.active && member.deactivatedAt
            ? ` · locked out ${formatDate(member.deactivatedAt)}`
            : ""}
        </p>

        {result?.ok === false && (
          <p role="alert" className="mt-2 max-w-xl text-xs text-red-600">
            {result.error}
          </p>
        )}
        {result?.ok && result.message && (
          <p role="status" className="mt-2 max-w-xl text-xs text-green-700">
            {result.message}
          </p>
        )}

        {confirmingDelete && (
          <div className="mt-3 max-w-xl rounded-md border border-red-300 bg-red-50 px-4 py-3">
            <p className="text-xs font-semibold text-red-800">
              Permanently delete {member.email}&apos;s sign-in?
            </p>
            <p className="mt-1 text-xs text-red-800">
              This cannot be undone. Their login is destroyed and the email address becomes free to
              use again. Their <strong>record is kept</strong> and shown as
              &ldquo;removed&rdquo;, because past entries — who approved a below-floor margin, who
              changed a rate, who recorded an expense — must keep showing a name instead of
              &ldquo;unknown&rdquo;.
            </p>
            <label
              className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-red-800"
              htmlFor={`confirm-${member.id}`}
            >
              Type {DELETE_CONFIRMATION_WORD} to confirm
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                id={`confirm-${member.id}`}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                className="w-40 rounded-md border border-red-300 bg-white px-2 py-1.5 text-sm text-veridan-ink focus:border-red-500 focus:outline-none"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteTeamMember(member.id, confirmation))}
                className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  setConfirmation("");
                }}
                className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <button
          type="button"
          disabled={pending || (member.role === "founder" && cannotDemote)}
          title={
            member.role === "founder" && member.isSelf
              ? "You cannot change your own role — ask the other founder."
              : member.role === "founder" && isLastActiveFounder
                ? "The last active founder cannot be demoted."
                : undefined
          }
          onClick={() =>
            run(() => setTeamMemberRole(member.id, member.role === "founder" ? "staff" : "founder"))
          }
          className={`${linkClass} text-veridan-accent hover:text-veridan-accent-soft`}
        >
          {member.role === "founder" ? "Make Staff" : "Make Founder"}
        </button>

        <button
          type="button"
          disabled={pending || (member.active && cannotLockOut)}
          title={
            member.active && member.isSelf
              ? "You cannot lock yourself out."
              : member.active && isLastActiveFounder
                ? "The last active founder cannot be locked out."
                : undefined
          }
          onClick={() => run(() => setTeamMemberActive(member.id, !member.active))}
          className={`${linkClass} text-veridan-warm-gray hover:text-veridan-ink`}
        >
          {member.active ? "Lock out" : "Restore access"}
        </button>

        <button
          type="button"
          disabled={pending || !member.active}
          title={!member.active ? "Restore their access first." : "Emails them a reset link — you never see their password."}
          onClick={() => run(() => sendTeamMemberPasswordReset(member.id))}
          className={`${linkClass} text-veridan-warm-gray hover:text-veridan-ink`}
        >
          Send password reset
        </button>

        {!confirmingDelete && (
          <button
            type="button"
            disabled={pending || cannotDelete}
            title={
              member.isSelf
                ? "You cannot delete your own account."
                : isLastActiveFounder
                  ? "The last active founder cannot be deleted."
                  : member.active
                    ? "Lock them out first — deleting is permanent."
                    : "Permanently deletes their sign-in; their record is kept for the audit trail."
            }
            onClick={() => setConfirmingDelete(true)}
            className={`${linkClass} text-red-600 hover:text-red-700`}
          >
            Delete account
          </button>
        )}
      </div>
    </li>
  );
}
