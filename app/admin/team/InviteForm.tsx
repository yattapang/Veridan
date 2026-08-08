"use client";

import { useActionState } from "react";
import { inviteTeamMember, type TeamActionResult } from "./actions";

const initialState: TeamActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass =
  "block text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Invite-by-email form.
 *
 * There is deliberately NO password field here and nowhere else in this app that
 * would accept, generate, or display a password for another person. The invitee
 * receives a one-time link and chooses their own.
 */
export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteTeamMember, initialState);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-[2fr_1.5fr_1fr_auto] sm:items-end">
      <div>
        <label className={labelClass} htmlFor="invite-email">
          Email
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="kaydean@veridan.com"
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="invite-name">
          Name (optional)
        </label>
        <input
          id="invite-name"
          name="display_name"
          type="text"
          autoComplete="off"
          placeholder="Kay-Dean"
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="invite-role">
          Role
        </label>
        <select id="invite-role" name="role" defaultValue="staff" className={`${inputClass} mt-1`}>
          <option value="staff">Staff</option>
          <option value="founder">Founder</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="h-[38px] shrink-0 rounded-md bg-veridan-ink px-4 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send invite"}
      </button>

      {state.ok === false && (
        <p role="alert" className="text-xs text-red-600 sm:col-span-4">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="text-xs text-green-700 sm:col-span-4">
          {state.message}
        </p>
      )}
    </form>
  );
}
