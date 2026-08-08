import "server-only";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { UserRow } from "@/lib/supabase/types";
import {
  canAccessAdminArea,
  canViewCosts,
  isFounder,
  normalizeRole,
  type AdminArea,
  type UserRole,
} from "./matrix";

/**
 * Server-side enforcement wrappers around lib/roles/matrix.ts.
 *
 * THREE independent layers, none of which trusts another (see the header of
 * app/admin/layout.tsx — there is no middleware in this app, deliberately):
 *
 *   (a) PAGES / LAYOUTS — `requireAdminArea` / `requireFounderPage` /
 *       `requireCostDetailPage`. A founder-only area gets a `layout.tsx` that
 *       calls one of these, so every nested route under it is covered by
 *       construction and a new sub-page cannot forget the check.
 *
 *   (b) SERVER ACTIONS and API ROUTES — `requireFounderAction` /
 *       `requireFounderRoute`. A page guard is not an authorization boundary:
 *       a Server Action is a POST endpoint that anyone with a session can call
 *       directly, so every founder-only action re-derives the role itself.
 *
 *   (c) The sidebar hides what the role cannot reach. UX only — never a control.
 *
 * `getCurrentUser()` already returns null for a deactivated user, so every one
 * of these (and every pre-existing `if (!user)` check in the app) denies a
 * deactivated account without further work.
 */

export interface RoleSession {
  user: UserRow;
  role: UserRole;
  /** True only for an active founder. */
  founder: boolean;
  /** True only for a role permitted to see supplier costs / margins. */
  showCosts: boolean;
}

/** Reads the session and its role without redirecting. */
export async function getRoleSession(): Promise<RoleSession | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const role = normalizeRole(user.role);
  return {
    user,
    role,
    founder: isFounder(user),
    showCosts: canViewCosts(role),
  };
}

/**
 * Role for rendering decisions where "signed out" is already handled elsewhere
 * (e.g. inside the admin layout, after its own null check). Falls back to the
 * least-privileged role rather than throwing.
 */
export async function getRoleForDisplay(): Promise<UserRole> {
  const session = await getRoleSession();
  return session?.role ?? "staff";
}

async function requireSession(): Promise<RoleSession> {
  const session = await getRoleSession();
  if (!session) redirect("/login");
  return session;
}

/** Page/layout guard: the signed-in role must be allowed into `area`. */
export async function requireAdminArea(area: AdminArea): Promise<RoleSession> {
  const session = await requireSession();
  if (!canAccessAdminArea(session.role, area)) {
    redirect(`/admin/forbidden?area=${encodeURIComponent(area)}`);
  }
  return session;
}

/** Page/layout guard: founder only. */
export async function requireFounderPage(area?: AdminArea): Promise<RoleSession> {
  const session = await requireSession();
  if (!session.founder) {
    redirect(area ? `/admin/forbidden?area=${encodeURIComponent(area)}` : "/admin/forbidden");
  }
  return session;
}

/**
 * Page guard for a cost-only sub-view inside an area staff CAN otherwise reach
 * (product cost comparison, hardware-set line items, price-file review).
 */
export async function requireCostDetailPage(): Promise<RoleSession> {
  const session = await requireSession();
  if (!session.showCosts) {
    redirect("/admin/forbidden?reason=costs");
  }
  return session;
}

export type FounderActionGate =
  | { ok: true; session: RoleSession; error?: undefined }
  | { ok: false; error: string; session?: undefined };

/**
 * Server Action guard. Returns the app's standard `{ ok, error }` result shape
 * so callers can surface it in the existing error slots rather than throwing an
 * unhandled digest at the client.
 */
export async function requireFounderAction(
  what = "do this"
): Promise<FounderActionGate> {
  const session = await getRoleSession();
  if (!session) {
    return { ok: false, error: "You must be signed in." };
  }
  if (!session.founder) {
    return {
      ok: false,
      error: `Founder access is required to ${what}. Ask a founder if you need this.`,
    };
  }
  return { ok: true, session };
}

export type RouteGate =
  | { ok: true; session: RoleSession; response?: undefined }
  | { ok: false; response: NextResponse; session?: undefined };

/**
 * API Route Handler guard. 401 when signed out (or deactivated), 403 when the
 * session is a staff session — never the data, and never a redirect that a
 * `fetch` would silently follow into HTML.
 */
export async function requireFounderRoute(): Promise<RouteGate> {
  const session = await getRoleSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }),
    };
  }
  if (!session.founder) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Founder access is required for this export." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, session };
}
