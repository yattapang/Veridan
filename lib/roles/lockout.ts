/**
 * Self-lockout rules for team administration.
 *
 * Pure and unit-tested (lockout.test.ts). The server actions in
 * app/admin/team/actions.ts call these AFTER re-reading the full user list from
 * the database, so the decision is never made against client-supplied state —
 * the UI merely disables buttons, these functions are the actual rule.
 *
 * The database carries the same last-founder invariant as a statement trigger
 * (supabase/migrations/20260807000004_user_roles.sql), so even a direct SQL
 * mistake cannot leave the company with no way back in. These functions exist so
 * the founder gets a readable sentence instead of a Postgres exception.
 */

import type { UserRole } from "./matrix";

export interface TeamMemberSnapshot {
  id: string;
  email: string;
  role: UserRole;
  active: boolean;
  /** Set once the Supabase Auth account has been permanently deleted. */
  deleted_at?: string | null;
}

export type LockoutCheck = { ok: true } | { ok: false; error: string };

const OK: LockoutCheck = { ok: true };

function deny(error: string): LockoutCheck {
  return { ok: false, error };
}

export function countActiveFounders(users: readonly TeamMemberSnapshot[]): number {
  return users.filter((u) => u.role === "founder" && u.active && !u.deleted_at).length;
}

function isRemoved(user: TeamMemberSnapshot): boolean {
  return Boolean(user.deleted_at);
}

/** The only founder left who can still sign in and administer the team. */
export function isLastActiveFounder(
  users: readonly TeamMemberSnapshot[],
  userId: string
): boolean {
  const target = users.find((u) => u.id === userId);
  if (!target || target.role !== "founder" || !target.active || isRemoved(target)) return false;
  return countActiveFounders(users) === 1;
}

function findTarget(
  users: readonly TeamMemberSnapshot[],
  targetId: string
): TeamMemberSnapshot | undefined {
  return users.find((u) => u.id === targetId);
}

/**
 * May `actorId` set `targetId`'s role to `nextRole`?
 *
 * Blocked:
 *  - target not in the list (stale page, deleted row)
 *  - a founder demoting THEMSELVES (they would lose the ability to undo it)
 *  - demoting the last active founder, whoever is asking
 *  - changing the role of a deactivated user (reactivate first — keeps the
 *    audit trail one-change-per-row and avoids "active staff or inactive
 *    founder?" ambiguity)
 *
 * Promotion to founder is always allowed; it never reduces the founder count.
 */
export function checkRoleChange(
  users: readonly TeamMemberSnapshot[],
  actorId: string,
  targetId: string,
  nextRole: UserRole
): LockoutCheck {
  const target = findTarget(users, targetId);
  if (!target) {
    return deny("That user no longer exists. Reload the team page and try again.");
  }
  if (isRemoved(target)) {
    return deny(
      `${target.email} has been removed. Their record is kept only so past audit entries still show who did what — invite them again if they are rejoining.`
    );
  }

  if (target.role === nextRole) return OK;

  if (nextRole === "founder") {
    if (!target.active) {
      return deny(
        `${target.email} is deactivated. Reactivate them first, then change their role.`
      );
    }
    return OK;
  }

  // nextRole === "staff" — a demotion from founder.
  if (actorId === targetId) {
    return deny(
      "You cannot change your own role from Founder to Staff. Ask the other founder to do it, so you are never locked out of your own admin by accident."
    );
  }

  if (!target.active) {
    return deny(
      `${target.email} is deactivated. Reactivate them first, then change their role.`
    );
  }

  if (countActiveFounders(users) <= 1) {
    return deny(
      `${target.email} is the last active founder. Promote someone else to Founder first — otherwise nobody could manage the team, parameters, or finances.`
    );
  }

  return OK;
}

/**
 * May `actorId` set `targetId`'s active flag to `nextActive`?
 *
 * Blocked:
 *  - target not in the list
 *  - deactivating YOURSELF (an instant self-lockout, founder or not)
 *  - deactivating the last active founder
 *
 * Reactivation is always allowed; it never reduces access.
 */
export function checkActiveChange(
  users: readonly TeamMemberSnapshot[],
  actorId: string,
  targetId: string,
  nextActive: boolean
): LockoutCheck {
  const target = findTarget(users, targetId);
  if (!target) {
    return deny("That user no longer exists. Reload the team page and try again.");
  }
  if (isRemoved(target)) {
    return deny(
      `${target.email} has been removed — their sign-in was permanently deleted and cannot be restored. Invite them again if they are rejoining.`
    );
  }

  if (target.active === nextActive) return OK;
  if (nextActive) return OK;

  if (actorId === targetId) {
    return deny(
      "You cannot deactivate your own account — that would sign you out of the admin with no way back in."
    );
  }

  if (target.role === "founder" && countActiveFounders(users) <= 1) {
    return deny(
      `${target.email} is the last active founder. Promote or reactivate another founder first.`
    );
  }

  return OK;
}

/**
 * May `actorId` permanently delete `targetId`'s sign-in?
 *
 * Deletion destroys the Supabase Auth user (irreversible — they can never sign
 * in again and the address is freed) while the `public.users` row is retained,
 * stamped `deleted_at`, so audit attribution survives. That makes it strictly
 * more severe than a lock-out, so it carries every lock-out rule plus one more:
 * a founder must lock the person out first. Two deliberate steps, no single
 * click that ends someone's access forever.
 */
export function checkDelete(
  users: readonly TeamMemberSnapshot[],
  actorId: string,
  targetId: string
): LockoutCheck {
  const target = findTarget(users, targetId);
  if (!target) {
    return deny("That user no longer exists. Reload the team page and try again.");
  }

  if (isRemoved(target)) {
    return deny(`${target.email} has already been removed.`);
  }

  if (actorId === targetId) {
    return deny(
      "You cannot delete your own account. Ask the other founder to do it if you really mean to leave."
    );
  }

  if (target.role === "founder") {
    if (target.active && countActiveFounders(users) <= 1) {
      return deny(
        `${target.email} is the last active founder and cannot be deleted. Promote another founder first.`
      );
    }
    // Also refuse to delete the only remaining founder RECORD, active or not —
    // a locked-out sole founder is still the way back in once restored.
    const otherFounders = users.filter(
      (u) => u.id !== targetId && u.role === "founder" && !isRemoved(u)
    ).length;
    if (otherFounders === 0) {
      return deny(
        `${target.email} is the only founder account left and cannot be deleted. Promote someone else to Founder first.`
      );
    }
  }

  if (target.active) {
    return deny(
      `Lock ${target.email} out first. Deleting is permanent — their sign-in is destroyed and cannot be restored — so it is deliberately a second, separate step.`
    );
  }

  return OK;
}

/**
 * May `actorId` trigger a password-reset email to `targetId`?
 *
 * The email goes to the USER, never to the founder — nothing about this shows,
 * sets, or relays a password. It is refused only when there is no working
 * sign-in to reset.
 */
export function checkPasswordReset(
  users: readonly TeamMemberSnapshot[],
  targetId: string
): LockoutCheck {
  const target = findTarget(users, targetId);
  if (!target) {
    return deny("That user no longer exists. Reload the team page and try again.");
  }
  if (isRemoved(target)) {
    return deny(`${target.email} has been removed and has no sign-in to reset.`);
  }
  if (!target.active) {
    return deny(
      `${target.email} is locked out. Restore their access first — a reset link would not let them in.`
    );
  }
  return OK;
}

/** The exact word a founder must type to confirm a permanent deletion. */
export const DELETE_CONFIRMATION_WORD = "DELETE";

export function checkDeleteConfirmation(typed: string): LockoutCheck {
  return typed.trim().toUpperCase() === DELETE_CONFIRMATION_WORD
    ? OK
    : deny(`Type ${DELETE_CONFIRMATION_WORD} in the confirmation box to permanently delete this sign-in.`);
}

/**
 * May `actorId` invite `email` with `role`?
 *
 * Blocked: an address that already has a user row. Inviting again would either
 * fail at the auth layer or silently reset an existing colleague's state — the
 * founder should change that person's role or reactivate them instead.
 */
export function checkInvite(
  users: readonly TeamMemberSnapshot[],
  email: string
): LockoutCheck {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return deny("Enter an email address to invite.");
  // Deliberately simple: one @, something either side, a dot in the domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return deny(`"${email.trim()}" does not look like an email address.`);
  }

  // A removed account's address is genuinely free again — deleting the Supabase
  // Auth user releases it — so a returning colleague can be re-invited. They get
  // a brand-new sign-in and a brand-new row; the old row stays put, marked
  // "(removed)", holding their historical attribution.
  const existing = users.find(
    (u) => !u.deleted_at && u.email.trim().toLowerCase() === normalized
  );
  if (existing) {
    return existing.active
      ? deny(`${existing.email} is already on the team. Change their role instead of re-inviting them.`)
      : deny(`${existing.email} already has an account that is deactivated. Reactivate it instead of re-inviting them.`);
  }

  return OK;
}
