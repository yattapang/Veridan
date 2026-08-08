import { describe, expect, it } from "vitest";
import {
  ADMIN_AREAS,
  DEFAULT_ROLE,
  USER_ROLES,
  adminAreaFromPathname,
  areasForRole,
  canAccessAdminArea,
  canAccessAdminPath,
  canViewCosts,
  isCostDetailRoute,
  isFounder,
  isFounderOnlyArea,
  isUserRole,
  normalizeRole,
  type AdminArea,
} from "./matrix";

// The founder-approved boundary, restated here independently of the
// implementation. If someone widens the matrix by accident, these two lists
// are what fails.
const STAFF_ALLOWED: AdminArea[] = [
  "dashboard",
  "pipeline",
  "enquiries",
  "companies",
  "projects",
  "quotes",
  "orders",
  "products",
  "item-groups",
  "price-files",
  "articles",
  "catalogue",
  "content",
  // Your own profile / password. Staff must be able to manage their own
  // credentials without a founder ever handling them.
  "account",
];

const STAFF_DENIED: AdminArea[] = [
  "parameters",
  "invoices",
  "expenses",
  "reports",
  "overrides",
  "suppliers",
  "team",
];

describe("role vocabulary", () => {
  it("has exactly two roles", () => {
    expect([...USER_ROLES]).toEqual(["founder", "staff"]);
  });

  it("defaults to the least-privileged role", () => {
    expect(DEFAULT_ROLE).toBe("staff");
  });

  it("recognises only the two known roles", () => {
    expect(isUserRole("founder")).toBe(true);
    expect(isUserRole("staff")).toBe(true);
    expect(isUserRole("admin")).toBe(false);
    expect(isUserRole("")).toBe(false);
    expect(isUserRole(null)).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
    expect(isUserRole(1)).toBe(false);
  });

  it("normalises anything unrecognised DOWN to staff, never up to founder", () => {
    expect(normalizeRole("founder")).toBe("founder");
    expect(normalizeRole("staff")).toBe("staff");
    expect(normalizeRole("FOUNDER")).toBe("staff");
    expect(normalizeRole("owner")).toBe("staff");
    expect(normalizeRole("")).toBe("staff");
    expect(normalizeRole(null)).toBe("staff");
    expect(normalizeRole(undefined)).toBe("staff");
    expect(normalizeRole({ role: "founder" })).toBe("staff");
  });
});

describe("isFounder", () => {
  it("is true for an active founder", () => {
    expect(isFounder({ role: "founder", active: true })).toBe(true);
  });

  it("treats a missing active flag as active (pre-migration rows)", () => {
    expect(isFounder({ role: "founder" })).toBe(true);
  });

  it("is false for a DEACTIVATED founder", () => {
    expect(isFounder({ role: "founder", active: false })).toBe(false);
  });

  it("is false for staff, null, and undefined", () => {
    expect(isFounder({ role: "staff", active: true })).toBe(false);
    expect(isFounder(null)).toBe(false);
    expect(isFounder(undefined)).toBe(false);
  });

  it("is false for an unrecognised role string", () => {
    expect(isFounder({ role: "superuser", active: true })).toBe(false);
  });
});

describe("canAccessAdminArea", () => {
  it("gives a founder every declared area", () => {
    for (const area of ADMIN_AREAS) {
      expect(canAccessAdminArea("founder", area), area).toBe(true);
    }
  });

  it.each(STAFF_ALLOWED)("lets staff into %s", (area) => {
    expect(canAccessAdminArea("staff", area)).toBe(true);
  });

  it.each(STAFF_DENIED)("keeps staff out of %s", (area) => {
    expect(canAccessAdminArea("staff", area)).toBe(false);
  });

  it("covers every declared area in exactly one of the two lists", () => {
    expect([...STAFF_ALLOWED, ...STAFF_DENIED].sort()).toEqual([...ADMIN_AREAS].sort());
  });

  it("denies areas it does not know about (deny by default)", () => {
    expect(canAccessAdminArea("staff", "payroll")).toBe(false);
    expect(canAccessAdminArea("founder", "payroll")).toBe(false);
    expect(canAccessAdminArea("founder", "")).toBe(false);
    expect(canAccessAdminArea("founder", "__proto__")).toBe(false);
    expect(canAccessAdminArea("founder", "constructor")).toBe(false);
  });

  it("agrees with isFounderOnlyArea", () => {
    for (const area of STAFF_DENIED) expect(isFounderOnlyArea(area)).toBe(true);
    for (const area of STAFF_ALLOWED) expect(isFounderOnlyArea(area)).toBe(false);
  });

  it("lists the right areas per role", () => {
    expect(areasForRole("founder")).toEqual([...ADMIN_AREAS]);
    expect(areasForRole("staff").sort()).toEqual([...STAFF_ALLOWED].sort());
  });
});

describe("canViewCosts", () => {
  it("is founder-only", () => {
    expect(canViewCosts("founder")).toBe(true);
    expect(canViewCosts("staff")).toBe(false);
  });
});

describe("adminAreaFromPathname", () => {
  it("maps /admin to the dashboard", () => {
    expect(adminAreaFromPathname("/admin")).toBe("dashboard");
    expect(adminAreaFromPathname("/admin/")).toBe("dashboard");
  });

  it("maps nested paths to their top-level area", () => {
    expect(adminAreaFromPathname("/admin/reports/transactions")).toBe("reports");
    expect(adminAreaFromPathname("/admin/quotes/abc-123")).toBe("quotes");
    expect(adminAreaFromPathname("/admin/companies/xyz/contacts")).toBe("companies");
    expect(adminAreaFromPathname("/admin/team")).toBe("team");
  });

  it("ignores a query string", () => {
    expect(adminAreaFromPathname("/admin/pipeline?expand=Sent")).toBe("pipeline");
  });

  it("returns null outside /admin and for undeclared areas", () => {
    expect(adminAreaFromPathname("/login")).toBeNull();
    expect(adminAreaFromPathname("/")).toBeNull();
    expect(adminAreaFromPathname("/admin/payroll")).toBeNull();
  });
});

describe("isCostDetailRoute", () => {
  it("matches the cost-only sub-views", () => {
    expect(isCostDetailRoute("/admin/products/compare/group-1")).toBe(true);
    expect(isCostDetailRoute("/admin/projects/p1/hardware-sets/s1")).toBe(true);
    expect(isCostDetailRoute("/admin/price-files/f1")).toBe(true);
    expect(isCostDetailRoute("/admin/price-files/f1/review")).toBe(true);
  });

  it("does not match their parent pages", () => {
    expect(isCostDetailRoute("/admin/products")).toBe(false);
    expect(isCostDetailRoute("/admin/projects/p1")).toBe(false);
    expect(isCostDetailRoute("/admin/projects/p1/doors")).toBe(false);
    expect(isCostDetailRoute("/admin/price-files")).toBe(false);
  });
});

describe("canAccessAdminPath", () => {
  it("lets staff into an allowed area but not its cost-only sub-view", () => {
    expect(canAccessAdminPath("staff", "/admin/products")).toBe(true);
    expect(canAccessAdminPath("staff", "/admin/products/compare/g1")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/projects/p1")).toBe(true);
    expect(canAccessAdminPath("staff", "/admin/projects/p1/hardware-sets/s1")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/price-files")).toBe(true);
    expect(canAccessAdminPath("staff", "/admin/price-files/f1")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/price-files/f1/review")).toBe(false);
  });

  it("keeps staff out of every founder-only area, nested paths included", () => {
    expect(canAccessAdminPath("staff", "/admin/reports")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/reports/transactions")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/invoices/inv-1")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/expenses/categories")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/parameters")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/overrides")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/suppliers")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/team")).toBe(false);
  });

  it("gives a founder every one of those paths", () => {
    for (const path of [
      "/admin",
      "/admin/reports/transactions",
      "/admin/products/compare/g1",
      "/admin/projects/p1/hardware-sets/s1",
      "/admin/price-files/f1/review",
      "/admin/team",
    ]) {
      expect(canAccessAdminPath("founder", path), path).toBe(true);
    }
  });

  it("denies unknown /admin paths for both roles", () => {
    expect(canAccessAdminPath("founder", "/admin/payroll")).toBe(false);
    expect(canAccessAdminPath("staff", "/admin/payroll")).toBe(false);
  });
});
