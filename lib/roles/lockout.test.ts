import { describe, expect, it } from "vitest";
import {
  DELETE_CONFIRMATION_WORD,
  TRANSFER_OWNERSHIP_CONFIRMATION_WORD,
  checkActiveChange,
  checkDelete,
  checkDeleteConfirmation,
  checkInvite,
  checkOwnershipTransfer,
  checkPasswordReset,
  checkRoleChange,
  checkTransferOwnershipConfirmation,
  countActiveFounders,
  findOwner,
  isLastActiveFounder,
  isOwner,
  type TeamMemberSnapshot,
} from "./lockout";

const KEN: TeamMemberSnapshot = { id: "ken", email: "ken@veridan.com", role: "founder", active: true };
const KAY: TeamMemberSnapshot = { id: "kay", email: "kay@veridan.com", role: "founder", active: true };
const SAM: TeamMemberSnapshot = { id: "sam", email: "sam@veridan.com", role: "staff", active: true };
const OLD: TeamMemberSnapshot = { id: "old", email: "old@veridan.com", role: "staff", active: false };
const EX_FOUNDER: TeamMemberSnapshot = {
  id: "ex",
  email: "ex@veridan.com",
  role: "founder",
  active: false,
};

const REMOVED: TeamMemberSnapshot = {
  id: "gone",
  email: "gone@veridan.com",
  role: "staff",
  active: false,
  deleted_at: "2026-08-01T00:00:00Z",
};
const REMOVED_FOUNDER: TeamMemberSnapshot = {
  id: "gonef",
  email: "gonef@veridan.com",
  role: "founder",
  active: false,
  deleted_at: "2026-08-01T00:00:00Z",
};
/** Locked out but not deleted — the only state from which deletion is allowed. */
const LOCKED_OUT: TeamMemberSnapshot = {
  id: "lock",
  email: "lock@veridan.com",
  role: "staff",
  active: false,
};

const TWO_FOUNDERS = [KEN, KAY, SAM];
const ONE_FOUNDER = [KEN, SAM, OLD];

describe("countActiveFounders / isLastActiveFounder", () => {
  it("counts only founders who are active", () => {
    expect(countActiveFounders(TWO_FOUNDERS)).toBe(2);
    expect(countActiveFounders(ONE_FOUNDER)).toBe(1);
    expect(countActiveFounders([KEN, EX_FOUNDER])).toBe(1);
    expect(countActiveFounders([SAM, OLD])).toBe(0);
    expect(countActiveFounders([])).toBe(0);
  });

  it("identifies the last active founder", () => {
    expect(isLastActiveFounder(ONE_FOUNDER, "ken")).toBe(true);
    expect(isLastActiveFounder(TWO_FOUNDERS, "ken")).toBe(false);
    expect(isLastActiveFounder(ONE_FOUNDER, "sam")).toBe(false);
    expect(isLastActiveFounder(ONE_FOUNDER, "nobody")).toBe(false);
    expect(isLastActiveFounder([KEN, EX_FOUNDER], "ex")).toBe(false);
  });
});

describe("checkRoleChange", () => {
  it("rejects an unknown target", () => {
    const result = checkRoleChange(TWO_FOUNDERS, "ken", "ghost", "founder");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no longer exists/i);
  });

  it("allows promoting staff to founder", () => {
    expect(checkRoleChange(TWO_FOUNDERS, "ken", "sam", "founder")).toEqual({ ok: true });
  });

  it("allows promoting staff to founder even when there is only one founder left", () => {
    expect(checkRoleChange(ONE_FOUNDER, "ken", "sam", "founder")).toEqual({ ok: true });
  });

  it("refuses to promote a DEACTIVATED user", () => {
    const result = checkRoleChange(ONE_FOUNDER, "ken", "old", "founder");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reactivate/i);
  });

  it("treats a no-op change as fine, even for the last founder demoting themselves to what they already are", () => {
    expect(checkRoleChange(ONE_FOUNDER, "ken", "ken", "founder")).toEqual({ ok: true });
    expect(checkRoleChange(TWO_FOUNDERS, "ken", "sam", "staff")).toEqual({ ok: true });
  });

  it("BLOCKS a founder demoting themselves, even with another founder present", () => {
    const result = checkRoleChange(TWO_FOUNDERS, "ken", "ken", "staff");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/your own role/i);
  });

  it("BLOCKS demoting the last active founder", () => {
    const result = checkRoleChange([KEN, KAY, SAM].map((u) => (u.id === "kay" ? { ...u, active: false } : u)), "sam", "ken", "staff");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/last active founder/i);
  });

  it("ALLOWS demoting a founder while another active founder remains", () => {
    expect(checkRoleChange(TWO_FOUNDERS, "ken", "kay", "staff")).toEqual({ ok: true });
  });

  it("BLOCKS demoting a deactivated founder (reactivate first)", () => {
    const users = [KEN, EX_FOUNDER, SAM];
    const result = checkRoleChange(users, "ken", "ex", "staff");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/deactivated/i);
  });

  it("cannot be worked around by a staff member asking (the rule is about the END STATE, the caller's own founder-ness is checked separately)", () => {
    // sam is staff; the action layer rejects them before this is even called,
    // but the rule must still hold if it ever is.
    const result = checkRoleChange(ONE_FOUNDER, "sam", "ken", "staff");
    expect(result.ok).toBe(false);
  });
});

describe("checkActiveChange", () => {
  it("rejects an unknown target", () => {
    const result = checkActiveChange(TWO_FOUNDERS, "ken", "ghost", false);
    expect(result.ok).toBe(false);
  });

  it("allows reactivating anyone", () => {
    expect(checkActiveChange(ONE_FOUNDER, "ken", "old", true)).toEqual({ ok: true });
    expect(checkActiveChange([KEN, EX_FOUNDER], "ken", "ex", true)).toEqual({ ok: true });
  });

  it("treats a no-op as fine", () => {
    expect(checkActiveChange(ONE_FOUNDER, "ken", "sam", true)).toEqual({ ok: true });
    expect(checkActiveChange(ONE_FOUNDER, "ken", "old", false)).toEqual({ ok: true });
  });

  it("BLOCKS self-deactivation for a founder", () => {
    const result = checkActiveChange(TWO_FOUNDERS, "ken", "ken", false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/your own account/i);
  });

  it("BLOCKS self-deactivation for staff too", () => {
    const result = checkActiveChange(TWO_FOUNDERS, "sam", "sam", false);
    expect(result.ok).toBe(false);
  });

  it("BLOCKS deactivating the last active founder", () => {
    const result = checkActiveChange(ONE_FOUNDER, "sam", "ken", false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/last active founder/i);
  });

  it("ALLOWS deactivating a founder while another active founder remains", () => {
    expect(checkActiveChange(TWO_FOUNDERS, "ken", "kay", false)).toEqual({ ok: true });
  });

  it("ALLOWS deactivating staff", () => {
    expect(checkActiveChange(ONE_FOUNDER, "ken", "sam", false)).toEqual({ ok: true });
  });

  it("never lets the founder count reach zero across a sequence of legal changes", () => {
    let users: TeamMemberSnapshot[] = [KEN, KAY, SAM];
    // Demote kay — legal, two founders.
    expect(checkRoleChange(users, "ken", "kay", "staff").ok).toBe(true);
    users = users.map((u) => (u.id === "kay" ? { ...u, role: "staff" as const } : u));
    // Now ken is the last founder: neither demotion nor deactivation is legal.
    expect(checkRoleChange(users, "kay", "ken", "staff").ok).toBe(false);
    expect(checkActiveChange(users, "kay", "ken", false).ok).toBe(false);
    expect(checkActiveChange(users, "ken", "ken", false).ok).toBe(false);
    expect(countActiveFounders(users)).toBe(1);
  });
});

describe("removed accounts are inert", () => {
  const users = [KEN, KAY, REMOVED, REMOVED_FOUNDER];

  it("does not count a removed founder towards the active-founder total", () => {
    expect(countActiveFounders([KEN, REMOVED_FOUNDER])).toBe(1);
    expect(isLastActiveFounder([KEN, REMOVED_FOUNDER], "ken")).toBe(true);
    expect(isLastActiveFounder([KEN, REMOVED_FOUNDER], "gonef")).toBe(false);
  });

  it("refuses to change a removed user's role", () => {
    const result = checkRoleChange(users, "ken", "gone", "founder");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/removed/i);
  });

  it("refuses to reactivate a removed user", () => {
    const result = checkActiveChange(users, "ken", "gone", true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/permanently deleted|removed/i);
  });

  it("refuses a password reset for a removed user", () => {
    const result = checkPasswordReset(users, "gone");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/removed/i);
  });
});

describe("checkDelete", () => {
  it("rejects an unknown target", () => {
    expect(checkDelete(TWO_FOUNDERS, "ken", "ghost").ok).toBe(false);
  });

  it("BLOCKS deleting yourself", () => {
    const users = [{ ...KEN, active: false }, KAY, SAM];
    const result = checkDelete(users, "ken", "ken");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/your own account/i);
  });

  it("BLOCKS deleting the last active founder", () => {
    const result = checkDelete(ONE_FOUNDER, "sam", "ken");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/last active founder/i);
  });

  it("BLOCKS deleting someone who is still active — lock out first", () => {
    const result = checkDelete(TWO_FOUNDERS, "ken", "sam");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/lock .* out first/i);
  });

  it("ALLOWS deleting a locked-out user", () => {
    expect(checkDelete([KEN, KAY, LOCKED_OUT], "ken", "lock")).toEqual({ ok: true });
  });

  it("ALLOWS deleting a locked-out founder while another active founder remains", () => {
    const users = [KEN, { ...KAY, active: false }, SAM];
    expect(checkDelete(users, "ken", "kay")).toEqual({ ok: true });
  });

  it("BLOCKS deleting the only founder RECORD, even when it is already locked out", () => {
    // A locked-out sole founder is still the way back in once restored.
    const users = [{ ...KEN, active: false }, SAM];
    const result = checkDelete(users, "sam", "ken");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/only founder account/i);
  });

  it("BLOCKS deleting an already-removed account", () => {
    const result = checkDelete([KEN, KAY, REMOVED], "ken", "gone");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already been removed/i);
  });

  it("requires the typed confirmation word", () => {
    expect(checkDeleteConfirmation(DELETE_CONFIRMATION_WORD)).toEqual({ ok: true });
    expect(checkDeleteConfirmation(" delete ")).toEqual({ ok: true });
    expect(checkDeleteConfirmation("")).toEqual({ ok: false, error: expect.any(String) });
    expect(checkDeleteConfirmation("yes").ok).toBe(false);
    expect(checkDeleteConfirmation("DELET").ok).toBe(false);
  });
});

describe("checkPasswordReset", () => {
  it("allows a reset for an active user", () => {
    expect(checkPasswordReset(TWO_FOUNDERS, "sam")).toEqual({ ok: true });
  });

  it("refuses a reset for a locked-out user", () => {
    const result = checkPasswordReset([KEN, KAY, LOCKED_OUT], "lock");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/locked out/i);
  });

  it("refuses a reset for an unknown user", () => {
    expect(checkPasswordReset(TWO_FOUNDERS, "ghost").ok).toBe(false);
  });
});

describe("checkInvite", () => {
  it("accepts a new address", () => {
    expect(checkInvite(TWO_FOUNDERS, "new@veridan.com")).toEqual({ ok: true });
  });

  it("rejects a blank address", () => {
    expect(checkInvite(TWO_FOUNDERS, "   ").ok).toBe(false);
  });

  it("rejects a malformed address", () => {
    expect(checkInvite(TWO_FOUNDERS, "not-an-email").ok).toBe(false);
    expect(checkInvite(TWO_FOUNDERS, "a@b").ok).toBe(false);
    expect(checkInvite(TWO_FOUNDERS, "a b@c.com").ok).toBe(false);
  });

  it("rejects an address that is already on the team, case- and space-insensitively", () => {
    const result = checkInvite(TWO_FOUNDERS, "  KAY@Veridan.com ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already on the team/i);
  });

  it("frees a REMOVED account's address for re-invitation", () => {
    expect(checkInvite([KEN, KAY, REMOVED], "gone@veridan.com")).toEqual({ ok: true });
  });

  it("points at reactivation when the address belongs to a deactivated user", () => {
    const result = checkInvite(ONE_FOUNDER, "old@veridan.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reactivate/i);
  });
});

// ---------------------------------------------------------------------------
// Owner protection (supabase/migrations/20260808000001_owner_protection.sql)
//
// These cover the PURE half of the rule, which is what this suite can cover.
// The same rules are ALSO enforced in the database by the
// users_owner_protection BEFORE ROW trigger and by public.transfer_ownership(),
// and those are deliberately not exercised here: this repo's tests are
// pure-function tests with no Supabase client, real or mocked, anywhere in
// them, and inventing one for this feature would test the mock rather than the
// database. What is genuinely NOT testable without a live database, and is
// covered by the UAT script instead:
//   * that the trigger refuses the same operations when they arrive as raw SQL
//     or through the service-role key rather than through these functions;
//   * that transfer_ownership() is atomic, and that the partial unique index
//     never permits two owners;
//   * that the two triggers fire in the BEFORE-ROW-then-AFTER-STATEMENT order
//     the migration header depends on.
// ---------------------------------------------------------------------------

/** KEN is the owner in these fixtures; KAY is the co-founder. */
const OWNER: TeamMemberSnapshot = { ...KEN, is_owner: true };
const OWNED_TEAM = [OWNER, KAY, SAM];

describe("findOwner / isOwner", () => {
  it("finds the flagged row", () => {
    expect(findOwner(OWNED_TEAM)?.id).toBe("ken");
    expect(isOwner(OWNED_TEAM, "ken")).toBe(true);
    expect(isOwner(OWNED_TEAM, "kay")).toBe(false);
  });

  it("returns undefined when no row holds the flag", () => {
    expect(findOwner(TWO_FOUNDERS)).toBeUndefined();
    expect(isOwner(TWO_FOUNDERS, "ken")).toBe(false);
    expect(findOwner([])).toBeUndefined();
  });

  it("treats a missing or null flag as 'not the owner'", () => {
    // A pre-migration row, or a null column, must never read as truthy.
    expect(isOwner([{ ...KEN, is_owner: null }, KAY], "ken")).toBe(false);
    expect(isOwner([{ ...KEN, is_owner: false }, KAY], "ken")).toBe(false);
  });
});

describe("owner protection inside the existing checks", () => {
  it("BLOCKS another founder demoting the owner", () => {
    const result = checkRoleChange(OWNED_TEAM, "kay", "ken", "staff");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/owner/i);
      expect(result.error).toMatch(/transferred/i);
    }
  });

  it("BLOCKS another founder locking the owner out", () => {
    const result = checkActiveChange(OWNED_TEAM, "kay", "ken", false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/owner/i);
  });

  it("BLOCKS another founder deleting the owner, even once locked out", () => {
    // The owner cannot actually reach the locked-out state, but the delete rule
    // must not depend on that: it runs before deleteTeamMember() destroys the
    // Supabase Auth user, which no database trigger can undo afterwards.
    const lockedOwner = { ...OWNER, active: false };
    const result = checkDelete([lockedOwner, KAY, SAM], "kay", "ken");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/owner/i);
  });

  it("BLOCKS the owner demoting, locking out or deleting THEMSELVES too", () => {
    // Not a special case for the owner — self-demotion, self-lockout and
    // self-deletion were already refused for everyone. What matters is that the
    // owner rule is the one that answers, because it is the one with a way
    // forward, and because it is the message the database trigger raises.
    expect(checkRoleChange(OWNED_TEAM, "ken", "ken", "staff").ok).toBe(false);
    expect(checkActiveChange(OWNED_TEAM, "ken", "ken", false).ok).toBe(false);
    expect(checkDelete(OWNED_TEAM, "ken", "ken").ok).toBe(false);
  });

  it("leaves every NON-owner unaffected", () => {
    expect(checkRoleChange(OWNED_TEAM, "ken", "kay", "staff")).toEqual({ ok: true });
    expect(checkActiveChange(OWNED_TEAM, "ken", "kay", false)).toEqual({ ok: true });
    expect(checkRoleChange(OWNED_TEAM, "ken", "sam", "founder")).toEqual({ ok: true });
  });

  it("never blocks PROMOTING the owner to founder (the repair path)", () => {
    // The trigger guarantees owner implies founder, so this is a no-op in
    // practice. It must not be refused, or a corrupted row could never be put
    // right without disabling the protection.
    expect(checkRoleChange(OWNED_TEAM, "kay", "ken", "founder")).toEqual({ ok: true });
    const staffOwner: TeamMemberSnapshot = { ...KEN, role: "staff", is_owner: true };
    expect(checkRoleChange([staffOwner, KAY], "kay", "ken", "founder")).toEqual({ ok: true });
  });

  it("never blocks REACTIVATING the owner", () => {
    const lockedOwner = { ...OWNER, active: false };
    expect(checkActiveChange([lockedOwner, KAY], "kay", "ken", true)).toEqual({ ok: true });
  });

  it("changes nothing at all when no owner is set", () => {
    // Every pre-owner-protection behaviour must survive byte for byte on a
    // database where this migration has not been applied.
    expect(checkRoleChange(TWO_FOUNDERS, "kay", "ken", "staff")).toEqual({ ok: true });
    expect(checkActiveChange(TWO_FOUNDERS, "kay", "ken", false)).toEqual({ ok: true });
  });
});

describe("checkOwnershipTransfer", () => {
  it("ALLOWS the owner handing over to another active founder", () => {
    expect(checkOwnershipTransfer(OWNED_TEAM, "ken", "kay")).toEqual({ ok: true });
  });

  it("BLOCKS a founder who is not the owner from moving it", () => {
    const result = checkOwnershipTransfer(OWNED_TEAM, "kay", "sam");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/only ken@veridan\.com/i);
      expect(result.error).toMatch(/being a founder is not enough/i);
    }
  });

  it("BLOCKS a founder trying to take ownership for themselves", () => {
    // The shape of the attack this rule exists to stop: Kay, a full founder,
    // naming Kay as the recipient.
    expect(checkOwnershipTransfer(OWNED_TEAM, "kay", "kay").ok).toBe(false);
  });

  it("BLOCKS transferring to the owner themselves", () => {
    const result = checkOwnershipTransfer(OWNED_TEAM, "ken", "ken");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already owns/i);
  });

  it("BLOCKS transferring to a staff account, and says to promote first", () => {
    const result = checkOwnershipTransfer(OWNED_TEAM, "ken", "sam");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/founder first/i);
  });

  it("BLOCKS transferring to a locked-out founder", () => {
    const result = checkOwnershipTransfer([OWNER, EX_FOUNDER, SAM], "ken", "ex");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/locked out/i);
  });

  it("BLOCKS transferring to a removed account", () => {
    const result = checkOwnershipTransfer([OWNER, REMOVED_FOUNDER, SAM], "ken", "gonef");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/removed/i);
  });

  it("BLOCKS transferring to someone who is not on the team", () => {
    expect(checkOwnershipTransfer(OWNED_TEAM, "ken", "ghost").ok).toBe(false);
  });

  it("refuses, naming the migration, when no owner is set at all", () => {
    const result = checkOwnershipTransfer(TWO_FOUNDERS, "ken", "kay");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/20260808000001_owner_protection\.sql/);
  });

  it("requires the typed confirmation word", () => {
    expect(checkTransferOwnershipConfirmation(TRANSFER_OWNERSHIP_CONFIRMATION_WORD)).toEqual({
      ok: true,
    });
    expect(checkTransferOwnershipConfirmation(" transfer ")).toEqual({ ok: true });
    expect(checkTransferOwnershipConfirmation("").ok).toBe(false);
    expect(checkTransferOwnershipConfirmation("TRANSFE").ok).toBe(false);
    expect(checkTransferOwnershipConfirmation(DELETE_CONFIRMATION_WORD).ok).toBe(false);
  });
});

describe("the founder-count invariant still holds around an owner", () => {
  it("counts the owner as an ordinary founder", () => {
    expect(countActiveFounders(OWNED_TEAM)).toBe(2);
    expect(isLastActiveFounder([OWNER, SAM], "ken")).toBe(true);
  });

  it("still refuses to demote the last active founder when they are NOT the owner", () => {
    // Owner protection must not accidentally become the only rule left standing:
    // with a locked-out owner, KAY is the sole ACTIVE founder and the original
    // last-founder rule must still be the thing that refuses.
    const sole = checkRoleChange(
      [{ ...KEN, active: false, is_owner: true }, KAY, SAM],
      "kay",
      "kay",
      "staff"
    );
    expect(sole.ok).toBe(false);
    if (!sole.ok) expect(sole.error).toMatch(/your own role/i);

    const byOther = checkRoleChange(
      [{ ...KEN, active: false, is_owner: true }, KAY, { ...SAM, role: "founder", active: false }],
      "sam",
      "kay",
      "staff"
    );
    expect(byOther.ok).toBe(false);
    if (!byOther.ok) expect(byOther.error).toMatch(/last active founder/i);
  });
});
