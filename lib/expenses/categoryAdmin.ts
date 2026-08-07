/**
 * Pure helpers for the admin-managed operating-expense taxonomy — no
 * Supabase client, no I/O, so every rule here is unit-testable in isolation
 * (same split as lib/articles/categoryAdmin.ts, whose shape this follows).
 * The actual reads/writes/revalidation live in
 * app/admin/expenses/categories/actions.ts.
 *
 * THE ONE STRUCTURAL DIFFERENCE FROM ARTICLE CATEGORIES, AND WHY:
 * `articles.category` is free text with no FK, so deleting an article
 * category is always safe and a rename simply stops affecting future
 * pickers. `expenses.expense_category_id` is a real FK with ON DELETE
 * RESTRICT (supabase/migrations/20260807000002_expenses.sql), because an
 * expense's category is part of the financial record. That forces two rules
 * this module encodes:
 *   1. A RENAME edits `label` (display) only and never `name` (the stable
 *      snake_case machine key). Historical CSV/Excel exports key on `name`,
 *      so a relabel must not make last quarter's export unreconcilable.
 *   2. A DELETE of a category that is in use is IMPOSSIBLE, not merely
 *      discouraged. `describeCategoryDeletion` produces the plain-English
 *      block message the UI shows instead of letting a raw Postgres
 *      foreign-key violation reach the founder.
 */

import { swapSortOrder, type SortableCategory } from "../articles/categoryAdmin";

// `swapSortOrder` is a generic "swap this row with its neighbour in an
// already-sorted list" helper with no article-specific behaviour and its own
// test coverage; re-exported rather than duplicated so both managed
// taxonomies reorder identically.
export { swapSortOrder };
export type { SortableCategory };

export interface ExpenseCategoryCandidate {
  id: string;
  name: string;
  label: string;
}

/**
 * A display label → stable snake_case machine key ("Rent & Utilities" →
 * "rent_utilities"). Underscores rather than the hyphens
 * lib/articles/slug.ts produces: this key is never a URL segment, it is a
 * column-ish identifier an accountant may see in an export header, and
 * snake_case matches the `actual_costs.category` vocabulary already in use
 * ('port_handling').
 *
 * An ampersand is treated as a plain separator and dropped rather than
 * spelled out as "and". That is what makes this function agree exactly with
 * the hand-authored seed keys in the migration ("Salaries & Wages" →
 * `salaries_wages`, not `salaries_and_wages`), so a category a founder adds
 * later is keyed by the same rule as the ones shipped with the system.
 */
export function deriveExpenseCategoryName(label: string): string {
  return label
    .normalize("NFKD")
    // Drop combining marks so "Café" → "cafe" rather than "caf".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export type ExpenseCategoryValidationResult =
  | { ok: true; name: string; label: string }
  | { ok: false; error: string };

/**
 * Validates a NEW category's label, returning the trimmed label + derived
 * machine key. Collisions on either the label or the derived key are
 * surfaced as a friendly error naming exactly what collided, rather than
 * silently suffixing a number — a founder can just pick a clearer name.
 */
export function validateNewExpenseCategory(
  label: string,
  existing: ExpenseCategoryCandidate[],
): ExpenseCategoryValidationResult {
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };

  const normalized = trimmed.toLowerCase();
  const labelCollision = existing.find((c) => c.label.trim().toLowerCase() === normalized);
  if (labelCollision) {
    return { ok: false, error: `A category named "${labelCollision.label}" already exists.` };
  }

  const name = deriveExpenseCategoryName(trimmed);
  if (!name) {
    return { ok: false, error: "Use at least one letter or number in the category name." };
  }

  const nameCollision = existing.find((c) => c.name === name);
  if (nameCollision) {
    return {
      ok: false,
      error: `"${trimmed}" produces the same internal key ("${name}") as "${nameCollision.label}". Choose a slightly different name.`,
    };
  }

  return { ok: true, name, label: trimmed };
}

/**
 * Validates a RENAME. Only the label changes — `name` is deliberately absent
 * from the result, because renaming must never rewrite the machine key
 * historical exports are reconciled against (see this module's header).
 */
export function validateExpenseCategoryRename(
  label: string,
  existing: ExpenseCategoryCandidate[],
  id: string,
): { ok: true; label: string } | { ok: false; error: string } {
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };

  const others = existing.filter((c) => c.id !== id);
  const normalized = trimmed.toLowerCase();
  const labelCollision = others.find((c) => c.label.trim().toLowerCase() === normalized);
  if (labelCollision) {
    return { ok: false, error: `A category named "${labelCollision.label}" already exists.` };
  }

  return { ok: true, label: trimmed };
}

/**
 * Usage counts keyed by `expense_category_id`. A real FK, so this is an
 * exact join-side count rather than the string matching article categories
 * have to do.
 */
export function computeExpenseCategoryUsageCounts(
  expenses: { expense_category_id: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of expenses) {
    counts.set(e.expense_category_id, (counts.get(e.expense_category_id) ?? 0) + 1);
  }
  return counts;
}

export function expenseCategoryUsageCountFor(id: string, counts: Map<string, number>): number {
  return counts.get(id) ?? 0;
}

export interface CategoryDeletionVerdict {
  /** False when the FK's ON DELETE RESTRICT would reject the delete. */
  allowed: boolean;
  /** Plain-English confirm prompt (allowed) or block message (not allowed). */
  message: string;
}

/**
 * The exact wording the UI shows for a delete attempt. Produced here rather
 * than in the component so the "in use ⇒ cannot delete" rule is one tested
 * function instead of a string duplicated between the confirm dialog and the
 * server action's guard.
 */
export function describeCategoryDeletion(label: string, usageCount: number): CategoryDeletionVerdict {
  if (usageCount > 0) {
    const noun = usageCount === 1 ? "expense uses" : "expenses use";
    return {
      allowed: false,
      message:
        `"${label}" cannot be deleted — ${usageCount} ${noun} it. ` +
        `Deleting a category that is in use would change past financial statements, so it is blocked. ` +
        `Move those expenses to another category first, or rename this one instead.`,
    };
  }
  return {
    allowed: true,
    message: `Delete "${label}"? No expenses use it, so nothing in your financial statements changes.`,
  };
}
