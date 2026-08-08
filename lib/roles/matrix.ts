/**
 * Role → admin-area access matrix.
 *
 * Pure, dependency-free, and unit-tested (matrix.test.ts) so the boundary can be
 * reasoned about in one place instead of being re-derived at every call site.
 * Nothing here touches Supabase, cookies, or `next/navigation` — the enforcement
 * wrappers live in lib/roles/guards.ts.
 *
 * Two roles only (founder-approved design):
 *   founder — everything, including costs, margins, finance and team management.
 *   staff   — operational areas only, with every supplier-cost and margin field
 *             stripped out of the areas they CAN reach.
 *
 * Design rules this file follows:
 *   1. DENY BY DEFAULT. `AREA_ACCESS` is a `Record<AdminArea, ...>`, so adding a
 *      new area to `ADMIN_AREAS` fails to compile until its access is declared
 *      deliberately. An unrecognised area string resolves to no access.
 *   2. An area allowance never overrides the cost rule. Staff may reach
 *      /admin/products and /admin/quotes, but `canViewCosts` is false for them,
 *      and the cost-only sub-views (see COST_DETAIL_ROUTES) are founder-only
 *      regardless of the area they sit under.
 */

export const USER_ROLES = ["founder", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** The least-privileged role — what an unknown/absent role falls back to. */
export const DEFAULT_ROLE: UserRole = "staff";

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Coerces whatever is stored in `public.users.role` (a text column) to a known
 * role. Anything unrecognised — null, "", a typo, a future role this build does
 * not know about — becomes `staff`, never `founder`: an unreadable role must
 * never grant more access than it should.
 */
export function normalizeRole(value: unknown): UserRole {
  return isUserRole(value) ? value : DEFAULT_ROLE;
}

/** True only for an ACTIVE founder. An inactive founder is not a founder. */
export function isFounder(
  user: { role?: unknown; active?: unknown } | null | undefined
): boolean {
  if (!user) return false;
  if (user.active === false) return false;
  return normalizeRole(user.role) === "founder";
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/**
 * One entry per top-level /admin section. `dashboard` is `/admin` itself.
 * Keep this in sync with components/admin/AdminSidebar.tsx (the sidebar derives
 * its visible links from this matrix, so a new link cannot silently skip it).
 */
export const ADMIN_AREAS = [
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
  "suppliers",
  "parameters",
  "invoices",
  "expenses",
  "reports",
  "overrides",
  "team",
  "account",
] as const;

export type AdminArea = (typeof ADMIN_AREAS)[number];

const BOTH: readonly UserRole[] = ["founder", "staff"];
const FOUNDER_ONLY: readonly UserRole[] = ["founder"];

/**
 * THE MATRIX. Every area must appear (the Record type enforces it).
 *
 * Founder-only, and why:
 *   parameters — margin tiers, duty rates, FX buffers: the pricing model itself.
 *   invoices   — client billing and payments.
 *   expenses   — company spend (and the natural home of payroll later).
 *   reports    — P&L, cash flow, margin audit, transaction ledger + exports.
 *   overrides  — the margin/floor override log; every row is a margin figure.
 *   suppliers  — NOT in the founder's staff-allowed list, and deny-by-default
 *                applies: supplier terms/currencies sit directly against cost.
 *   team       — user administration itself.
 *
 * `account` is everyone's own profile page (change YOUR OWN password). It is
 * deliberately not founder-gated: staff must be able to manage their own
 * credentials without a founder ever touching them.
 */
const AREA_ACCESS: Record<AdminArea, readonly UserRole[]> = {
  dashboard: BOTH,
  pipeline: BOTH,
  enquiries: BOTH,
  companies: BOTH,
  projects: BOTH,
  quotes: BOTH,
  orders: BOTH,
  products: BOTH,
  "item-groups": BOTH,
  "price-files": BOTH,
  articles: BOTH,
  catalogue: BOTH,
  content: BOTH,
  suppliers: FOUNDER_ONLY,
  parameters: FOUNDER_ONLY,
  invoices: FOUNDER_ONLY,
  expenses: FOUNDER_ONLY,
  reports: FOUNDER_ONLY,
  overrides: FOUNDER_ONLY,
  team: FOUNDER_ONLY,
  account: BOTH,
};

/** The single access decision. Unknown areas deny. */
export function canAccessAdminArea(role: UserRole, area: AdminArea | string): boolean {
  const allowed = (AREA_ACCESS as Record<string, readonly UserRole[] | undefined>)[area];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function isFounderOnlyArea(area: AdminArea): boolean {
  return !canAccessAdminArea("staff", area);
}

export function areasForRole(role: UserRole): AdminArea[] {
  return ADMIN_AREAS.filter((area) => canAccessAdminArea(role, area));
}

// ---------------------------------------------------------------------------
// Cost / margin visibility
// ---------------------------------------------------------------------------

/**
 * Supplier costs, landed-cost build-ups, margin percentages, order actuals and
 * money-value KPI tiles. Founder-only, everywhere, with no per-area exceptions —
 * this is the rule that outranks the area allowances above.
 */
export function canViewCosts(role: UserRole): boolean {
  return role === "founder";
}

/**
 * Sub-routes that sit inside a staff-allowed AREA but whose entire purpose is to
 * display or edit supplier cost. There is nothing left of these pages once the
 * cost columns are removed, so they are gated whole rather than field-by-field.
 *
 * Matched as a prefix against the pathname (see `isCostDetailRoute`).
 */
export const COST_DETAIL_ROUTES = [
  // A side-by-side unit-cost comparison of every product in an item group.
  "/admin/products/compare",
  // Per-door hardware-set line items: product unit costs + cost overrides.
  "/admin/projects/:id/hardware-sets",
  // The extracted supplier price-list review table (unit cost per row).
  "/admin/price-files/:id/review",
] as const;

/**
 * True when `pathname` is one of the cost-only sub-views above. Dynamic segments
 * in the patterns are written as `:id` and match a single path segment.
 */
export function isCostDetailRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  return COST_DETAIL_ROUTES.some((pattern) => {
    const patternSegments = pattern.split("/").filter(Boolean);
    if (segments.length < patternSegments.length) return false;
    return patternSegments.every(
      (part, i) => part.startsWith(":") || part === segments[i]
    );
  });
}

// ---------------------------------------------------------------------------
// Pathname → area
// ---------------------------------------------------------------------------

/**
 * Maps any /admin pathname to its area. Used by the sidebar (UX) and by the
 * guard tests. Returns null for a path outside /admin or for an /admin
 * sub-path with no declared area (which then denies, per rule 1).
 */
export function adminAreaFromPathname(pathname: string): AdminArea | null {
  const segments = pathname.split("?")[0].split("/").filter(Boolean);
  if (segments[0] !== "admin") return null;
  if (segments.length === 1) return "dashboard";
  const candidate = segments[1];
  return (ADMIN_AREAS as readonly string[]).includes(candidate)
    ? (candidate as AdminArea)
    : null;
}

/**
 * Full decision for a pathname: the area must be allowed AND, if it is one of
 * the cost-only sub-views, the role must be allowed to see costs.
 */
export function canAccessAdminPath(role: UserRole, pathname: string): boolean {
  const area = adminAreaFromPathname(pathname);
  if (!area) return false;
  if (!canAccessAdminArea(role, area)) return false;
  if (isCostDetailRoute(pathname) && !canViewCosts(role)) return false;
  return true;
}
