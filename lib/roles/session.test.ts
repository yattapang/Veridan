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

  // --- MAJOR-1, security review 2026-08-08 -----------------------------------
  // A valid Supabase Auth session with NO public.users row is DENIED, not
  // admitted as staff. It used to resolve to {role:"staff", active:true}, which
  // — with Supabase's default of email sign-ups being enabled — meant anyone who
  // could reach the project's auth endpoint could self-register into /admin.
  // Rows are created only by a founder's invite, so "no row" means "not a
  // Veridan user".
  it("DENIES an authenticated session that has no public.users row", () => {
    expect(resolveSessionUser(AUTH, null)).toBeNull();
    expect(resolveSessionUser(AUTH, undefined)).toBeNull();
  });

  it("denies a row-less session regardless of what the auth user looks like", () => {
    expect(resolveSessionUser({ id: "u2", email: null }, null)).toBeNull();
    expect(resolveSessionUser({ id: "u3", email: "stranger@example.com" }, null)).toBeNull();
  });

  it("grants nothing on the deny path — not even the least-privileged role", () => {
    const user = resolveSessionUser({ id: "u4", email: "stranger@example.com" }, null);
    // isFounder/normalizeRole are the two things every call site derives access
    // from; both must be safe when handed the denial.
    expect(isFounder(user)).toBe(false);
    expect(normalizeRole(user?.role)).toBe("staff");
    expect(user?.active).toBeUndefined();
  });

  it("still admits an INVITED user, whose row the invite already created", () => {
    const invited = resolveSessionUser(AUTH, { ...ROW, role: "staff" });
    expect(invited).not.toBeNull();
    expect(invited?.role).toBe("staff");
    expect(isFounder(invited)).toBe(false);
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
