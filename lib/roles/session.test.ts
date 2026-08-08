import { describe, expect, it } from "vitest";
import { resolveSessionUser, type RawUserRow } from "./session";
import { isFounder, normalizeRole } from "./matrix";

const AUTH = { id: "u1", email: "ken@veridan.com" };

const ROW: RawUserRow = {
  id: "u1",
  email: "ken@veridan.com",
  display_name: "Ken",
  role: "founder",
  active: true,
  deleted_at: null,
};

describe("resolveSessionUser", () => {
  it("returns null when there is no authenticated Supabase user", () => {
    expect(resolveSessionUser(null, ROW)).toBeNull();
    expect(resolveSessionUser(undefined, null)).toBeNull();
  });

  it("returns the row for an active user", () => {
    expect(resolveSessionUser(AUTH, ROW)).toEqual({
      id: "u1",
      email: "ken@veridan.com",
      display_name: "Ken",
      role: "founder",
      active: true,
    });
  });

  it("REJECTS an inactive (locked-out) user — this is what makes lock-out immediate", () => {
    expect(resolveSessionUser(AUTH, { ...ROW, active: false })).toBeNull();
  });

  it("REJECTS an inactive STAFF user too", () => {
    expect(resolveSessionUser(AUTH, { ...ROW, role: "staff", active: false })).toBeNull();
  });

  it("REJECTS a removed account even if its active flag says otherwise", () => {
    expect(
      resolveSessionUser(AUTH, { ...ROW, active: true, deleted_at: "2026-08-01T00:00:00Z" })
    ).toBeNull();
  });

  it("falls back to the LEAST-privileged role when the row has not synced yet", () => {
    const user = resolveSessionUser(AUTH, null);
    expect(user).not.toBeNull();
    expect(user?.role).toBe("staff");
    expect(normalizeRole(user?.role)).toBe("staff");
    expect(isFounder(user)).toBe(false);
  });

  it("does not invent an email for an unsynced row", () => {
    expect(resolveSessionUser({ id: "u2", email: null }, null)?.email).toBe("");
  });

  it("treats a row with no active column (pre-migration) as active", () => {
    const noActive: RawUserRow = {
      id: ROW.id,
      email: ROW.email,
      display_name: ROW.display_name,
      role: ROW.role,
    };
    const user = resolveSessionUser(AUTH, noActive);
    expect(user?.active).toBe(true);
    expect(isFounder(user)).toBe(true);
  });

  it("passes an unknown role through so normalizeRole can demote it", () => {
    const user = resolveSessionUser(AUTH, { ...ROW, role: "superuser" });
    expect(isFounder(user)).toBe(false);
    expect(normalizeRole(user?.role)).toBe("staff");
  });
});
