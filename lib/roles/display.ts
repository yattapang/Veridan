/**
 * How a user is named and labelled once they may no longer be a current
 * colleague. Pure and unit-tested (display.test.ts).
 *
 * A removed account keeps its `public.users` row on purpose — the audit trail
 * attributes real business decisions to it (who approved a below-floor margin,
 * who changed a duty rate, who recorded an expense). So a user id can still
 * resolve to a name long after the person's access is gone, and every place
 * that prints a name has to say so rather than implying they are still on the
 * team.
 */

export interface DisplayableUser {
  display_name?: string | null;
  email?: string | null;
  active?: boolean | null;
  deleted_at?: string | null;
}

export type AccountState = "active" | "locked_out" | "removed";

/** Removed beats locked out: a removed account is also inactive. */
export function accountState(user: DisplayableUser | null | undefined): AccountState {
  if (!user) return "removed";
  if (user.deleted_at) return "removed";
  if (user.active === false) return "locked_out";
  return "active";
}

/** The bare name, with no state suffix. Falls back email → "Unknown user". */
export function baseUserName(user: DisplayableUser | null | undefined): string {
  const name = user?.display_name?.trim();
  if (name) return name;
  const email = user?.email?.trim();
  if (email) return email;
  return "Unknown user";
}

/**
 * The name as it should appear ANYWHERE a user is displayed — audit rows,
 * override logs, the team list, "recorded by" lines.
 *
 *   active     → "Kay-Dean"
 *   locked out → "Kay-Dean (locked out)"
 *   removed    → "Kay-Dean (removed)"
 */
export function teamMemberDisplayName(user: DisplayableUser | null | undefined): string {
  const base = baseUserName(user);
  switch (accountState(user)) {
    case "removed":
      return user ? `${base} (removed)` : base;
    case "locked_out":
      return `${base} (locked out)`;
    default:
      return base;
  }
}

export const ACCOUNT_STATE_LABELS: Record<AccountState, string> = {
  active: "Active",
  locked_out: "Locked out",
  removed: "Removed",
};

/** Only currently-usable accounts belong in the main team list. */
export function isCurrentTeamMember(user: DisplayableUser): boolean {
  return accountState(user) !== "removed";
}

/**
 * Splits a user list into the working team and the collapsed
 * "Removed accounts" section.
 */
export function partitionTeam<T extends DisplayableUser>(
  users: readonly T[]
): { current: T[]; removed: T[] } {
  const current: T[] = [];
  const removed: T[] = [];
  for (const user of users) {
    if (isCurrentTeamMember(user)) current.push(user);
    else removed.push(user);
  }
  return { current, removed };
}
