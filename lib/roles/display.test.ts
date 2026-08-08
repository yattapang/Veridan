import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STATE_LABELS,
  accountState,
  baseUserName,
  isCurrentTeamMember,
  partitionTeam,
  teamMemberDisplayName,
} from "./display";

const ACTIVE = { display_name: "Kay-Dean", email: "kay@veridan.com", active: true, deleted_at: null };
const LOCKED = { display_name: "Kay-Dean", email: "kay@veridan.com", active: false, deleted_at: null };
const REMOVED = {
  display_name: "Kay-Dean",
  email: "kay@veridan.com",
  active: false,
  deleted_at: "2026-08-01T00:00:00Z",
};

describe("accountState", () => {
  it("classifies the three states", () => {
    expect(accountState(ACTIVE)).toBe("active");
    expect(accountState(LOCKED)).toBe("locked_out");
    expect(accountState(REMOVED)).toBe("removed");
  });

  it("treats removed as terminal even if active were somehow true", () => {
    expect(accountState({ ...REMOVED, active: true })).toBe("removed");
  });

  it("treats a missing user as removed, never active", () => {
    expect(accountState(null)).toBe("removed");
    expect(accountState(undefined)).toBe("removed");
  });

  it("treats an unstamped row with no active flag as active (pre-migration rows)", () => {
    expect(accountState({ email: "x@y.com" })).toBe("active");
  });

  it("has a label for every state", () => {
    expect(ACCOUNT_STATE_LABELS.active).toBe("Active");
    expect(ACCOUNT_STATE_LABELS.locked_out).toBe("Locked out");
    expect(ACCOUNT_STATE_LABELS.removed).toBe("Removed");
  });
});

describe("baseUserName", () => {
  it("prefers the display name", () => {
    expect(baseUserName(ACTIVE)).toBe("Kay-Dean");
  });

  it("falls back to email, then to Unknown user", () => {
    expect(baseUserName({ display_name: null, email: "a@b.com" })).toBe("a@b.com");
    expect(baseUserName({ display_name: "   ", email: "a@b.com" })).toBe("a@b.com");
    expect(baseUserName({ display_name: null, email: null })).toBe("Unknown user");
    expect(baseUserName(null)).toBe("Unknown user");
  });
});

describe("teamMemberDisplayName", () => {
  it("prints an active user plainly", () => {
    expect(teamMemberDisplayName(ACTIVE)).toBe("Kay-Dean");
  });

  it("marks a locked-out user", () => {
    expect(teamMemberDisplayName(LOCKED)).toBe("Kay-Dean (locked out)");
  });

  it("marks a removed user — the audit-trail display path", () => {
    expect(teamMemberDisplayName(REMOVED)).toBe("Kay-Dean (removed)");
  });

  it("marks a removed user identified only by email", () => {
    expect(
      teamMemberDisplayName({ display_name: null, email: "old@veridan.com", deleted_at: "x" })
    ).toBe("old@veridan.com (removed)");
  });

  it("does not append a suffix to an unresolvable user id", () => {
    expect(teamMemberDisplayName(null)).toBe("Unknown user");
  });
});

describe("partitionTeam", () => {
  it("keeps locked-out users in the current list and removed users out of it", () => {
    const users = [
      { id: "a", ...ACTIVE },
      { id: "b", ...LOCKED },
      { id: "c", ...REMOVED },
    ];
    const { current, removed } = partitionTeam(users);
    expect(current.map((u) => u.id)).toEqual(["a", "b"]);
    expect(removed.map((u) => u.id)).toEqual(["c"]);
  });

  it("agrees with isCurrentTeamMember", () => {
    expect(isCurrentTeamMember(ACTIVE)).toBe(true);
    expect(isCurrentTeamMember(LOCKED)).toBe(true);
    expect(isCurrentTeamMember(REMOVED)).toBe(false);
  });

  it("handles an empty list", () => {
    expect(partitionTeam([])).toEqual({ current: [], removed: [] });
  });
});
