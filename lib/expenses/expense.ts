/**
 * Pure operating-expense logic — no Supabase client, no I/O.
 *
 * FX: THE ONE PLACE VERIDAN CONVERTS AT A LIVE RATE, AND WHY.
 * Everywhere else in this codebase a USD figure is converted to JMD at a
 * quote's FROZEN `fx_snapshot.effective_rate` (lib/orders/format.ts's
 * convertAtQuoteRate, lib/reports/pnl.ts's costAmountJmd). That is possible
 * because those amounts belong to an order, and an order has a quote, and a
 * quote has a locked rate.
 *
 * An operating expense belongs to no order. There is no locked rate to use
 * — none exists, and inventing one (e.g. "the rate on the day it was
 * incurred") would require FX history this system does not keep. So a
 * USD-only expense is converted for DISPLAY ONLY at the CURRENT
 * `fx_bank_sell_rate_usd_jmd` x (1 + `fx_risk_buffer_pct`/100), read at
 * REPORT RENDER TIME.
 *
 * THE HONEST CONSEQUENCE, WHICH THE UI MUST STATE: a USD-only expense's JMD
 * figure can differ between two renders of the same historical period,
 * because the parameter moved in between. A founder who needs a frozen JMD
 * figure should enter the JMD amount they were actually billed — a row that
 * carries its own `amount_jmd` is NEVER converted, and its JMD sibling is
 * never re-derived from a USD value on the same row (that would double-count
 * one bill recorded in both currencies).
 *
 * The converted value is never written back to the database.
 */

/** JMD per 1 USD, already including the risk buffer. */
export interface CurrentFxRate {
  bankSellRate: number;
  bufferPct: number;
  /** bankSellRate x (1 + bufferPct/100) — the rate actually applied. */
  effectiveRate: number;
  /**
   * True when the rate came from live `business_parameters` rows. False
   * means the parameters could not be read and the report must say so
   * rather than quietly converting at a guess.
   */
  available: boolean;
}

/**
 * Builds the current-rate descriptor from the two live business parameters.
 * A missing or nonsensical (non-finite, non-positive) bank rate yields
 * `available: false` with a zero effective rate, so `expenseAmountJmd`
 * refuses to convert instead of producing an invented figure.
 */
export function buildCurrentFxRate(
  bankSellRate: number | null | undefined,
  bufferPct: number | null | undefined,
): CurrentFxRate {
  const rate = typeof bankSellRate === "number" && Number.isFinite(bankSellRate) && bankSellRate > 0 ? bankSellRate : 0;
  const buffer = typeof bufferPct === "number" && Number.isFinite(bufferPct) ? bufferPct : 0;
  return {
    bankSellRate: rate,
    bufferPct: buffer,
    effectiveRate: rate > 0 ? rate * (1 + buffer / 100) : 0,
    available: rate > 0,
  };
}

/** Human-readable provenance for the UI, e.g. "162.00 x 1.03 = 166.86 (current rate, today)". */
export function describeCurrentFxRate(fx: CurrentFxRate): string {
  if (!fx.available) {
    return "No current USD-JMD rate is configured, so USD-only expenses cannot be converted.";
  }
  return `${fx.bankSellRate.toFixed(2)} x ${(1 + fx.bufferPct / 100).toFixed(2)} = ${fx.effectiveRate.toFixed(2)} JMD per USD`;
}

/** The minimum an expense row must carry to be summed into a report. */
export interface ExpenseAmountInput {
  amountJmd: number | null;
  amountUsd: number | null;
}

/**
 * Resolves one expense to JMD: its own JMD value if present, otherwise its
 * USD value converted at the CURRENT rate. Returns null when neither is
 * possible (USD-only with no configured rate) — callers surface that as an
 * explicitly flagged unconverted amount rather than dropping it silently.
 */
export function expenseAmountJmd(row: ExpenseAmountInput, fx: CurrentFxRate): number | null {
  if (row.amountJmd != null) return row.amountJmd;
  if (row.amountUsd != null) {
    if (!fx.available) return null;
    const value = row.amountUsd * fx.effectiveRate;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Form parsing / validation (shared by create and edit, so the two paths
// cannot drift). Mirrors app/admin/orders/[id]/actions.ts's
// parseActualCostForm, extended with the paid_date / vendor / reference
// fields expenses add.
// ---------------------------------------------------------------------------

export interface ExpenseFields {
  expense_category_id: string;
  description: string;
  vendor: string | null;
  amount_jmd: number | null;
  amount_usd: number | null;
  incurred_date: string;
  paid_date: string | null;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
}

export interface ExpenseInputRaw {
  expenseCategoryId: string;
  description: string;
  vendor: string;
  amountJmd: string;
  amountUsd: string;
  incurredDate: string;
  paidDate: string;
  paymentMethod: string;
  reference: string;
  notes: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates raw string input into the exact column shape. Enforces, in
 * application code, the same "at least one amount" rule the DB's
 * chk_expenses_amount_present enforces as a backstop — so the founder gets a
 * sentence instead of a constraint-violation string.
 */
export function parseExpenseInput(
  raw: ExpenseInputRaw,
  today: string,
): { ok: true; fields: ExpenseFields } | { ok: false; error: string } {
  const categoryId = raw.expenseCategoryId.trim();
  if (!categoryId) return { ok: false, error: "Choose an expense category." };

  const description = raw.description.trim();
  if (!description) return { ok: false, error: "Enter a description — the accountant's report reads this column." };

  const jmdRaw = raw.amountJmd.trim();
  const usdRaw = raw.amountUsd.trim();
  const amountJmd = jmdRaw === "" ? null : Number(jmdRaw);
  const amountUsd = usdRaw === "" ? null : Number(usdRaw);
  if (amountJmd == null && amountUsd == null) {
    return { ok: false, error: "Enter an amount in JMD, USD, or both." };
  }
  if (amountJmd != null && (!Number.isFinite(amountJmd) || amountJmd < 0)) {
    return { ok: false, error: "JMD amount must be a non-negative number." };
  }
  if (amountUsd != null && (!Number.isFinite(amountUsd) || amountUsd < 0)) {
    return { ok: false, error: "USD amount must be a non-negative number." };
  }

  const incurredDate = raw.incurredDate.trim() || today;
  if (!ISO_DATE.test(incurredDate)) {
    return { ok: false, error: "Date incurred must be a valid date." };
  }

  const paidDateRaw = raw.paidDate.trim();
  if (paidDateRaw && !ISO_DATE.test(paidDateRaw)) {
    return { ok: false, error: "Date paid must be a valid date, or left blank if the expense is unpaid." };
  }
  // Deliberately NOT rejected: paid_date earlier than incurred_date. A
  // prepaid annual subscription or a deposit genuinely pays before the
  // expense is incurred, and blocking it would force founders to falsify a
  // date. The two bases each use their own column, so an out-of-order pair
  // is reported correctly on both.

  return {
    ok: true,
    fields: {
      expense_category_id: categoryId,
      description,
      vendor: raw.vendor.trim() || null,
      amount_jmd: amountJmd,
      amount_usd: amountUsd,
      incurred_date: incurredDate,
      paid_date: paidDateRaw || null,
      payment_method: raw.paymentMethod.trim() || null,
      reference: raw.reference.trim() || null,
      notes: raw.notes.trim() || null,
    },
  };
}

// ---------------------------------------------------------------------------
// List filtering (the /admin/expenses list). Pure so the filter semantics are
// tested rather than trusted to a PostgREST query nobody can unit-test.
// ---------------------------------------------------------------------------

export type ExpensePaymentFilter = "all" | "paid" | "unpaid";

export const EXPENSE_PAYMENT_FILTERS: ExpensePaymentFilter[] = ["all", "paid", "unpaid"];

export function parseExpensePaymentFilter(value: string | null | undefined): ExpensePaymentFilter {
  return value === "paid" || value === "unpaid" ? value : "all";
}

export interface FilterableExpense {
  expense_category_id: string;
  incurred_date: string;
  paid_date: string | null;
}

/**
 * Applies the list filters. The date range is matched against
 * `incurred_date` — the date the expense BELONGS to regardless of basis —
 * so an unpaid January bill still appears when a founder filters to
 * January, which is exactly what they need in order to go and pay it.
 */
export function filterExpenses<T extends FilterableExpense>(
  expenses: T[],
  filters: {
    startIso?: string | null;
    endIso?: string | null;
    categoryId?: string | null;
    payment?: ExpensePaymentFilter;
  },
): T[] {
  const { startIso, endIso, categoryId, payment = "all" } = filters;
  return expenses.filter((e) => {
    if (startIso && e.incurred_date < startIso) return false;
    if (endIso && e.incurred_date > endIso) return false;
    if (categoryId && e.expense_category_id !== categoryId) return false;
    if (payment === "paid" && e.paid_date == null) return false;
    if (payment === "unpaid" && e.paid_date != null) return false;
    return true;
  });
}
