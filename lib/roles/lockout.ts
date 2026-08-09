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
 *
 * The same is true of the OWNER rules below: supabase/migrations/
 * 20260808000001_owner_protection.sql enforces them with a BEFORE ROW trigger on
 * public.users, which is the actual boundary. What these functions add is (a) a
 * sentence that names the fix instead of a check_violation, and (b) a refusal
 * that lands BEFORE any irreversible side effect — deleteTeamMember() destroys
 * the Supabase Auth user before it ever touches public.users, so for that path
 * the trigger would fire too late to prevent the damage. checkDelete() is what
 * actually stops the owner's sign-in being destroyed.
 */

import type { UserRole } from "./matrix";

export interface TeamMemberSnapshot {
  id: string;
  email: string;
  role: UserRole;
  active: boolean;
  /** Set once the Supabase Auth account has been permanently deleted. */
  deleted_at?: string | null;
  /**
   * The ownership flag from public.users.is_owner. Optional so every existing
   * caller and fixture keeps working: absent/undefined means "not the owner",
   * which is the safe reading — it can only ever ADD a refusal, never remove one.
   */
  is_owner?: boolean | null;
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

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

/**
 * The owner row, if there is one. At most one row can hold the flag (partial
 * unique index in 20260808000001_owner_protection.sql), so `find` is exact
 * rather than a first-match approximation.
 */
export function findOwner(
  users: readonly TeamMemberSnapshot[]
): TeamMemberSnapshot | undefined {
  return users.find((u) => Boolean(u.is_owner));
}

export function isOwner(users: readonly TeamMemberSnapshot[], userId: string): boolean {
  return findOwner(users)?.id === userId;
}

/**
 * The one sentence every owner-protection refusal ends with. Kept in one place
 * so the UI tooltip, the server action's error and this module cannot drift into
 * saying three different things about the same rule.
 */
function ownerProtected(owner: TeamMemberSnapshot, what: string): LockoutCheck {
  return deny(
    `${owner.email} is the owner of this Veridan admin and cannot be ${what} — not by another founder, and not from the database either. ` +
      `Ownership has to be transferred to another active founder first; after that they are an ordinary founder and the usual rules apply.`
  );
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

  // Checked BEFORE the self-demotion rule on purpose. Both would refuse an owner
  // demoting themselves, but "transfer ownership first" is the sentence that
  // names the actual fix, and it is also the message the database trigger
  // raises — so the app and the backstop say the same thing rather than two
  // different things about one rule. A promotion TO founder is never blocked
  // here: it cannot reduce anyone's authority, and if an owner row were ever
  // found sitting at 'staff' this is the statement that repairs it.
  if (target.is_owner && nextRole !== "founder") {
    return ownerProtected(target, "demoted");
  }

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

  // Same ordering rationale as checkRoleChange: the owner rule is the one that
  // says what to do about it, so it is raised ahead of the generic self-lockout
  // and last-founder rules that would otherwise swallow it.
  if (target.is_owner) {
    return ownerProtected(target, "locked out");
  }

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

  // THIS ONE IS NOT A COURTESY. deleteTeamMember() destroys the Supabase Auth
  // user FIRST and only then stamps public.users.deleted_at, so the database
  // trigger — which can only see the second half — would refuse the soft-delete
  // after the sign-in had already been destroyed irreversibly. This check is
  // what actually prevents that, which is why it sits ahead of every other rule
  // here and is re-run server-side against a fresh read of the user table.
  if (target.is_owner) {
    return ownerProtected(target, "deleted");
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
 * The exact word the owner must type to confirm handing ownership over. Same
 * typed-confirmation pattern as deletion (checkDeleteConfirmation above) rather
 * than a second, differently-shaped confirmation idiom — this admin should have
 * one way of asking "are you certain", not two.
 */
export const TRANSFER_OWNERSHIP_CONFIRMATION_WORD = "TRANSFER";

export function checkTransferOwnershipConfirmation(typed: string): LockoutCheck {
  return typed.trim().toUpperCase() === TRANSFER_OWNERSHIP_CONFIRMATION_WORD
    ? OK
    : deny(
        `Type ${TRANSFER_OWNERSHIP_CONFIRMATION_WORD} in the confirmation box to hand ownership over.`
      );
}

/**
 * May `actorId` transfer ownership to `targetId`?
 *
 * Ownership is the one thing on this page that cannot be undone by the person
 * who does it: the moment the flag moves, the old owner is an ordinary founder
 * and the NEW owner is the only account that can move it again. So the rule is
 * narrow — only the current owner may initiate, and only an active founder may
 * receive.
 *
 * `actorId` must be the id the SERVER derived from the session, never anything
 * the browser sent; app/admin/team/actions.ts passes `gate.session.user.id`.
 * public.transfer_ownership() independently re-checks that its `p_from` really
 * holds the flag, but it is a service-role function on a connection where
 * auth.uid() is null — it can verify the id it was handed is the owner, not that
 * the person driving the request IS that id. This function, run against a fresh
 * read of the user table, is where those two facts are joined.
 */
export function checkOwnershipTransfer(
  users: readonly TeamMemberSnapshot[],
  actorId: string,
  targetId: string
): LockoutCheck {
  const owner = findOwner(users);
  if (!owner) {
    return deny(
      "No account is marked as the owner of this admin, so there is nothing to transfer. " +
        "Check that supabase/migrations/20260808000001_owner_protection.sql has been applied."
    );
  }

  if (owner.id !== actorId) {
    return deny(
      `Only ${owner.email} can transfer ownership, because only the owner can give it away. ` +
        `Being a founder is not enough — that is the entire point of the owner flag.`
    );
  }

  const target = findTarget(users, targetId);
  if (!target) {
    return deny("That user no longer exists. Reload the team page and try again.");
  }

  if (target.id === owner.id) {
    return deny(`${owner.email} already owns this admin.`);
  }

  if (isRemoved(target)) {
    return deny(
      `${target.email} has been removed — their sign-in was permanently deleted, so they could never use the ownership.`
    );
  }

  if (target.role !== "founder") {
    return deny(
      `Ownership can only go to a founder. Make ${target.email} a Founder first, then transfer — ownership carries no access of its own, so handing it to a staff account would protect a row that cannot administer anything.`
    );
  }

  if (!target.active) {
    return deny(
      `${target.email} is locked out. Restore their access first — transferring ownership to an account that cannot sign in would leave nobody able to move it again.`
    );
  }

  return OK;
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
