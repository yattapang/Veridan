"use client";

import { useState, useTransition } from "react";
import type { UserRole } from "@/lib/roles/matrix";
import {
  DELETE_CONFIRMATION_WORD,
  TRANSFER_OWNERSHIP_CONFIRMATION_WORD,
} from "@/lib/roles/lockout";
import { teamMemberDisplayName } from "@/lib/roles/display";
import {
  deleteTeamMember,
  sendTeamMemberPasswordReset,
  setTeamMemberActive,
  setTeamMemberRole,
  transferOwnership,
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
  /** public.users.is_owner — protection only, never access. */
  isOwner: boolean;
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
 *
 * The OWNER's row goes one step further than disabling: the three controls that
 * cannot apply to them (demote, lock out, delete) are replaced by a sentence
 * saying why, rather than left present-but-greyed. A greyed button with a
 * tooltip still reads as "this is a thing you might do to this person"; the
 * point of owner protection is that it is not. `viewerIsOwner` decides which
 * sentence, because "you own this" and "someone else owns this" need different
 * next steps, and it is a rendering decision only — the server re-derives it.
 */
export function TeamMemberRow({
  member,
  activeFounderCount,
  viewerIsOwner,
  ownerEmail,
}: {
  member: TeamMemberView & { display_name?: string | null; deleted_at?: string | null };
  activeFounderCount: number;
  /** True when the person READING the page holds the ownership flag. */
  viewerIsOwner: boolean;
  /** The owner's email, for explaining who to ask. Null if no owner is set. */
  ownerEmail: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TeamActionResult | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const [transferConfirmation, setTransferConfirmation] = useState("");

  const isLastActiveFounder =
    member.role === "founder" && member.active && activeFounderCount <= 1;

  const cannotDemote = member.isSelf || isLastActiveFounder;
  const cannotLockOut = member.isSelf || isLastActiveFounder;
  const cannotDelete = member.isSelf || isLastActiveFounder || member.active;

  /**
   * May the reader hand ownership to THIS person? Mirrors checkOwnershipTransfer
   * in lib/roles/lockout.ts, which is what actually decides.
   */
  const canReceiveOwnership =
    viewerIsOwner &&
    !member.isOwner &&
    !member.isSelf &&
    member.role === "founder" &&
    member.active &&
    !member.deletedAt;

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
          {member.isOwner && (
            <span
              title="Owner — a Founder whose account cannot be demoted, locked out or deleted by anyone else. It grants no extra access."
              /* accent-soft tint + accent-TEXT foreground: globals.css records
                 that --color-accent measures ~3.1:1 on paper and is below the
                 AA floor for text this small, and that accent-text is the
                 shade to use when the accent lands on type rather than on a
                 background. Same tint the contact-role pill already uses. */
              className="rounded-full bg-veridan-accent-soft/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-accent-text"
            >
              Owner
            </span>
          )}
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

        {confirmingTransfer && (
          <div className="mt-3 max-w-xl rounded-md border border-veridan-accent bg-veridan-accent-soft/20 px-4 py-3">
            <p className="text-xs font-semibold text-veridan-ink">
              Hand ownership of this admin to {member.email}?
            </p>
            <p className="mt-1 text-xs text-veridan-ink">
              Ownership moves in a single step and{" "}
              <strong>you will not be able to take it back</strong> — from that moment only{" "}
              {member.email} can transfer it, including back to you. You stay a Founder with exactly
              the access you have now; what you give up is the protection on your own account, so
              another founder could then demote, lock out or delete you. This is recorded in the
              team log.
            </p>
            <label
              className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray"
              htmlFor={`transfer-${member.id}`}
            >
              Type {TRANSFER_OWNERSHIP_CONFIRMATION_WORD} to confirm
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                id={`transfer-${member.id}`}
                value={transferConfirmation}
                onChange={(e) => setTransferConfirmation(e.target.value)}
                autoComplete="off"
                className="w-40 rounded-md border border-veridan-warm-gray-light bg-white px-2 py-1.5 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={pending}
                /*
                 * Collapses the panel once the transfer actually succeeds —
                 * `run` still surfaces the returned message in the row's status
                 * slot. Without this the "Hand ownership to X?" prompt would sit
                 * there after the answer was already yes: revalidation removes
                 * the BUTTON (the reader is no longer the owner) but the panel
                 * is driven by local state and would survive it. The delete
                 * panel needs no equivalent because its row moves to "Removed
                 * accounts" and unmounts.
                 */
                onClick={() =>
                  run(async () => {
                    const outcome = await transferOwnership(member.id, transferConfirmation);
                    if (outcome.ok) {
                      setConfirmingTransfer(false);
                      setTransferConfirmation("");
                    }
                    return outcome;
                  })
                }
                className="rounded-md bg-veridan-ink px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Transferring…" : "Transfer ownership"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingTransfer(false);
                  setTransferConfirmation("");
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
        {member.isOwner ? (
          /*
           * The owner's row. Demote / lock out / delete are GONE, not greyed:
           * they are not things that can be done to this account by anyone, so
           * showing them as almost-available would misdescribe the rule. The
           * replacement text says what the protection is and what the way
           * around it is, which is the only useful thing to say here.
           */
          <p className="max-w-[16rem] text-right text-xs text-veridan-warm-gray">
            {member.isSelf
              ? "You own this admin. Your account cannot be demoted, locked out or deleted — not by another founder, and not from the database either. To hand it over, use “Transfer ownership” on another active founder’s row."
              : `Protected as the owner. This account cannot be demoted, locked out or deleted, and no founder can override that — the database refuses it, not just this page. Only ${
                  ownerEmail ?? "the owner"
                } can pass ownership on.`}
          </p>
        ) : (
          <>
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
                run(() =>
                  setTeamMemberRole(member.id, member.role === "founder" ? "staff" : "founder")
                )
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
          </>
        )}

        <button
          type="button"
          disabled={pending || !member.active}
          title={!member.active ? "Restore their access first." : "Emails them a reset link — you never see their password."}
          onClick={() => run(() => sendTeamMemberPasswordReset(member.id))}
          className={`${linkClass} text-veridan-warm-gray hover:text-veridan-ink`}
        >
          Send password reset
        </button>

        {!member.isOwner && !confirmingDelete && (
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

        {canReceiveOwnership && !confirmingTransfer && (
          <button
            type="button"
            disabled={pending}
            title="Hands ownership of this admin to them. You cannot take it back — only they will be able to move it afterwards."
            onClick={() => setConfirmingTransfer(true)}
            className={`${linkClass} text-veridan-accent hover:text-veridan-accent-soft`}
          >
            Transfer ownership
          </button>
        )}
      </div>
    </li>
  );
}
