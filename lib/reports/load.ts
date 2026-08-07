/**
 * Report data loaders (Task 55/56) — the single place each financial report's
 * rows are fetched and mapped into the pure-function inputs in this folder.
 * Both the on-screen report pages and the CSV/Excel export route handlers call
 * these, so a report and its export can never diverge on what "revenue" or
 * "cost" means. Keeping the queries here (not inlined per page) is what
 * enforces the PRD §9.2 rule in one auditable spot: revenue always comes from
 * `invoice_payments`, cost always from `actual_costs`, and a quote number is
 * only ever a label — except in the margin audit, the one report whose job is
 * to compare the quoted projection against reality (see marginAudit.ts).
 *
 * Not a server-action module (no "use server"): these are plain async helpers
 * imported by Server Components and Route Handlers alike.
 */

import type { createClient } from "@/lib/supabase/server";
import type {
  ActualCostCategory,
  BusinessParameterRow,
  InvoiceStatus,
  InvoiceType,
  OrderStatus,
} from "@/lib/supabase/types";
import { ACTUAL_COST_CATEGORY_LABELS } from "../orders/format";
import { buildCurrentFxRate, expenseAmountJmd, type CurrentFxRate } from "../expenses/expense";
import type { CashInEntry, CashOutEntry } from "./cashflow";
import { invoiceRevenueShare, roundJmd } from "./incomeStatement";
import { jamaicaDateFromTimestamp, shiftIsoDate } from "./period";
import type {
  LedgerCostInput,
  LedgerExpenseInput,
  LedgerInvoiceInput,
  LedgerPaymentInput,
} from "./transactions";
import {
  quotedCategoriesFromOrigins,
  type MarginAuditCostInput,
  type MarginAuditInvoiceInput,
  type MarginAuditOrderInput,
  type MarginAuditPaymentInput,
  type QuoteOriginCostRow,
} from "./marginAudit";
import { isWithinReportRange, type ReportDateRange } from "./period";
import { costAmountJmd, type OrderRateLookup } from "./pnl";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Shared: order → locked FX rate lookup
// ---------------------------------------------------------------------------

interface PnlOrderJoinRow {
  id: string;
  quote_id: string;
  quotes: { fx_snapshot: { effective_rate: number } } | null;
}

/**
 * PostgREST caps a response at `db-max-rows` (1000 by default) and returns
 * the truncated page WITHOUT an error, so an unbounded `.select()` that
 * outgrows the cap silently under-reports. Every unbounded fetch in this
 * module goes through here instead: it pages with `.range()` until a short
 * page comes back, so the caller always gets the complete set or an error.
 */
const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: T[] | null; error: string | null }> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1);
    if (error) return { data: null, error: error.message };
    const rows = (data as T[] | null) ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return { data: all, error: null };
  }
}

/**
 * Every order's quote-locked `fx_snapshot.effective_rate`, plus the
 * quote-id → order-id map the reports join on.
 *
 * Deliberately NOT range-filtered: a cost incurred inside the range can
 * belong to an order created outside it (and can even be backdated before
 * its own order's `created_at`), so any date filter here would drop the rate
 * a converted figure depends on and turn a real cost into an "unconverted"
 * one. Paged instead, so the row cap cannot truncate it either.
 */
async function loadOrderRates(
  supabase: SupabaseServerClient,
): Promise<{ quoteIdToOrderId: Map<string, string>; rateByOrderId: OrderRateLookup } | { error: string }> {
  const { data, error } = await fetchAllPages<PnlOrderJoinRow>((from, to) =>
    supabase.from("orders").select("id, quote_id, quotes(fx_snapshot)").order("id", { ascending: true }).range(from, to),
  );
  if (error || !data) return { error: error ?? "Could not load orders." };

  const quoteIdToOrderId = new Map(data.map((o) => [o.quote_id, o.id]));
  const rateByOrderId: OrderRateLookup = {};
  for (const o of data) {
    const rate = o.quotes?.fx_snapshot?.effective_rate;
    if (rate != null) rateByOrderId[o.id] = rate;
  }
  return { quoteIdToOrderId, rateByOrderId };
}

// ---------------------------------------------------------------------------
// Margin audit
// ---------------------------------------------------------------------------

interface MarginAuditOrderJoinRow {
  id: string;
  quote_id: string;
  status: OrderStatus;
  created_at: string;
  quotes: {
    quote_ref: string;
    total_landed_usd: number | null;
    total_client_usd: number | null;
    total_client_jmd: number | null;
    parameters_snapshot: { margin_floor_pct: number } | null;
    fx_snapshot: { effective_rate: number } | null;
    quote_origins: QuoteOriginCostRow[] | null;
    invoices: {
      amount_jmd: number;
      status: InvoiceStatus;
      invoice_payments: { amount_jmd: number }[] | null;
    }[] | null;
  } | null;
  actual_costs: { category: ActualCostCategory; amount_usd: number | null; amount_jmd: number | null }[] | null;
}

export interface MarginAuditData {
  orders: MarginAuditOrderInput[];
  costs: MarginAuditCostInput[];
  payments: MarginAuditPaymentInput[];
  invoices: MarginAuditInvoiceInput[];
}

/**
 * Loads every order (filtered in-memory to those created within `range`, so
 * the coarse timestamptz-vs-date-range comparison stays timezone-safe) with
 * its quote's cached totals + snapshot floor + origin cost components, its
 * actual costs, and its invoices/payments joined through the quote. Each
 * order aggregates its FULL lifetime of costs and payments regardless of the
 * range — the range only selects which orders appear.
 */
export async function loadMarginAuditData(
  supabase: SupabaseServerClient,
  range: ReportDateRange,
): Promise<{ data: MarginAuditData | null; error: string | null }> {
  const { data, error } = await supabase.from("orders").select(
    `id, quote_id, status, created_at,
     quotes(quote_ref, total_landed_usd, total_client_usd, total_client_jmd, parameters_snapshot, fx_snapshot,
       quote_origins(supplier_invoice_total, freight_export_fees_usd, ocean_freight_usd, marine_insurance_usd, port_handling_usd, brokerage_usd, cif_basis_usd, duty_gct_pct),
       invoices(amount_jmd, status, invoice_payments(amount_jmd))),
     actual_costs(category, amount_usd, amount_jmd)`,
  );

  if (error) return { data: null, error: error.message };

  const rows = ((data as unknown as MarginAuditOrderJoinRow[]) ?? []).filter((o) =>
    isWithinReportRange(o.created_at, range),
  );

  const orders: MarginAuditOrderInput[] = [];
  const costs: MarginAuditCostInput[] = [];
  const payments: MarginAuditPaymentInput[] = [];
  const invoices: MarginAuditInvoiceInput[] = [];

  for (const o of rows) {
    const q = o.quotes;
    const effectiveRate = q?.fx_snapshot?.effective_rate ?? 0;
    orders.push({
      orderId: o.id,
      quoteRef: q?.quote_ref ?? "—",
      orderStatus: o.status,
      quotedLandedUsd: q?.total_landed_usd ?? null,
      quotedClientUsd: q?.total_client_usd ?? null,
      quotedClientJmd: q?.total_client_jmd ?? null,
      marginFloorPct: q?.parameters_snapshot?.margin_floor_pct ?? 20,
      effectiveRate,
      quotedCategoriesUsd: quotedCategoriesFromOrigins(q?.quote_origins ?? []),
    });

    for (const c of o.actual_costs ?? []) {
      costs.push({ orderId: o.id, category: c.category, amountUsd: c.amount_usd, amountJmd: c.amount_jmd });
    }
    for (const inv of q?.invoices ?? []) {
      invoices.push({ orderId: o.id, amountJmd: inv.amount_jmd, status: inv.status });
      for (const pay of inv.invoice_payments ?? []) {
        payments.push({ orderId: o.id, amountJmd: pay.amount_jmd });
      }
    }
  }

  return { data: { orders, costs, payments, invoices }, error: null };
}

// ---------------------------------------------------------------------------
// Orders + actuals raw (export only)
// ---------------------------------------------------------------------------

export interface OrdersRawRow {
  quoteRef: string;
  orderStatus: OrderStatus;
  category: ActualCostCategory;
  description: string | null;
  amountUsd: number | null;
  amountJmd: number | null;
  incurredDateIso: string;
  supplierName: string | null;
}

interface OrdersRawJoinRow {
  category: ActualCostCategory;
  description: string | null;
  amount_usd: number | null;
  amount_jmd: number | null;
  incurred_date: string;
  suppliers: { name: string } | null;
  orders: {
    status: OrderStatus;
    quotes: { quote_ref: string } | null;
  } | null;
}

/** One row per actual-cost entry (with its order/quote context), filtered by incurred_date within `range`. */
export async function loadOrdersRawData(
  supabase: SupabaseServerClient,
  range: ReportDateRange,
): Promise<{ data: OrdersRawRow[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from("actual_costs")
    .select(
      "category, description, amount_usd, amount_jmd, incurred_date, suppliers(name), orders(status, quotes(quote_ref))",
    )
    .gte("incurred_date", range.startIso)
    .lte("incurred_date", range.endIso)
    .order("incurred_date", { ascending: true });

  if (error) return { data: null, error: error.message };

  const rows: OrdersRawRow[] = ((data as unknown as OrdersRawJoinRow[]) ?? []).map((r) => ({
    quoteRef: r.orders?.quotes?.quote_ref ?? "—",
    orderStatus: r.orders?.status ?? "confirmed",
    category: r.category,
    description: r.description,
    amountUsd: r.amount_usd,
    amountJmd: r.amount_jmd,
    incurredDateIso: r.incurred_date,
    supplierName: r.suppliers?.name ?? null,
  }));

  return { data: rows, error: null };
}

// ---------------------------------------------------------------------------
// Financial statements (2026-08-07 restructure) — income statement, cash
// flow with real outflows, and the transaction ledger.
//
// ONE LOADER, THREE REPORTS. The income statement, the cash-flow statement
// and the transaction ledger all read the same four real-data sources
// (issued invoices, invoice_payments, actual_costs, expenses) and differ
// only in which dates they select on and how they present the rows. Loading
// them together here is what makes it impossible for the three pages to
// disagree about what a period contains — which was the founder's actual
// complaint about the old reports.
//
// RANGE FILTERING IS DELIBERATELY WIDE AT THE QUERY LAYER. Every cost and
// expense carries TWO dates (incurred / paid) and the basis decides which
// one applies, so the query fetches a row when EITHER date falls in range
// and the pure functions in incomeStatement.ts do the precise selection. A
// narrow query would silently drop a December bill paid in January out of
// the cash-basis January column.
// ---------------------------------------------------------------------------

/**
 * The CURRENT USD->JMD rate from live business parameters, for converting
 * USD-only OPERATING EXPENSES at render time (see lib/expenses/expense.ts
 * for why a non-order expense has no locked rate to use). Order-linked
 * `actual_costs` are unaffected — they keep converting at their own order's
 * quote-locked rate.
 *
 * A failed read yields `available: false` rather than a fabricated default,
 * so the report states that USD-only expenses could not be converted instead
 * of quietly converting at the seed value.
 */
export async function loadCurrentFxRate(supabase: SupabaseServerClient): Promise<CurrentFxRate> {
  const { data, error } = await supabase
    .from("business_parameters")
    .select("key, value")
    .in("key", ["fx_bank_sell_rate_usd_jmd", "fx_risk_buffer_pct"]);

  if (error || !data) return buildCurrentFxRate(null, null);

  const rows = data as Pick<BusinessParameterRow, "key" | "value">[];
  const valueFor = (key: string): number | null => {
    const raw = rows.find((r) => r.key === key)?.value?.value;
    const n = typeof raw === "string" ? Number(raw) : raw;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };

  return buildCurrentFxRate(valueFor("fx_bank_sell_rate_usd_jmd"), valueFor("fx_risk_buffer_pct"));
}

interface IssuedInvoiceJoinRow {
  invoice_number: string;
  quote_id: string;
  /** subtotal + GCT — what the client owes. NOT revenue. */
  amount_jmd: number;
  /** GCT-exclusive. THIS is revenue (see lib/reports/incomeStatement.ts). */
  subtotal_jmd: number | null;
  gct_amount_jmd: number | null;
  issued_at: string | null;
  status: InvoiceStatus;
  quotes: { quote_ref: string } | null;
  companies: { name: string } | null;
}

interface FinancialCostJoinRow {
  order_id: string;
  category: ActualCostCategory;
  description: string | null;
  amount_usd: number | null;
  amount_jmd: number | null;
  incurred_date: string;
  paid_date: string | null;
  suppliers: { name: string } | null;
  orders: {
    quotes: { quote_ref: string } | null;
    companies: { name: string } | null;
  } | null;
}

interface ExpenseJoinRow {
  description: string;
  vendor: string | null;
  amount_jmd: number | null;
  amount_usd: number | null;
  incurred_date: string;
  paid_date: string | null;
  payment_method: string | null;
  reference: string | null;
  expense_categories: { name: string; label: string } | null;
}

interface FinancialPaymentJoinRow {
  amount_jmd: number;
  paid_at: string;
  method: string | null;
  reference: string | null;
  invoices: {
    invoice_number: string;
    invoice_type: InvoiceType;
    quote_id: string;
    /** Carried so the payment can be pro-rated into its revenue and GCT shares. */
    subtotal_jmd: number | null;
    amount_jmd: number | null;
    quotes: { quote_ref: string } | null;
    companies: { name: string } | null;
  } | null;
}

export interface FinancialStatementData {
  /** Accrual-basis revenue events — invoices issued (non-void) within the range. */
  issuedInvoices: LedgerInvoiceInput[];
  /** Cash-basis revenue events, in the ledger shape (a superset of the income statement's). */
  payments: LedgerPaymentInput[];
  /** The same payments in the cash-flow statement's inflow shape. */
  cashIn: CashInEntry[];
  costs: LedgerCostInput[];
  expenses: LedgerExpenseInput[];
  rateByOrderId: OrderRateLookup;
  fx: CurrentFxRate;
}

export async function loadFinancialStatementData(
  supabase: SupabaseServerClient,
  range: ReportDateRange,
): Promise<{ data: FinancialStatementData | null; error: string | null }> {
  // Safe to interpolate: `range` reaches this function only via
  // parseReportDateRange / parseExportRange, which reject anything that is
  // not `\d{4}-\d{2}-\d{2}` — so neither value can contain a comma,
  // parenthesis or dot and restructure the filter expression.
  const eitherDateInRange =
    `and(incurred_date.gte.${range.startIso},incurred_date.lte.${range.endIso}),` +
    `and(paid_date.gte.${range.startIso},paid_date.lte.${range.endIso})`;

  // A WIDE server-side window on issued_at, then the precise Jamaica-local
  // narrowing in memory below. `issued_at` is a timestamptz while the range
  // is a pair of Jamaica-local calendar dates, so a tight gte/lte on the
  // instant would misfile an invoice issued late in the evening (and, at a
  // month boundary, into the wrong column). A day of slack on each side
  // covers the 5-hour offset with room to spare, while still bounding the
  // query so a growing invoices table cannot hit PostgREST's row cap and
  // silently under-report revenue.
  const issuedFromIso = `${shiftIsoDate(range.startIso, -1)}T00:00:00Z`;
  const issuedToIso = `${shiftIsoDate(range.endIso, 1)}T23:59:59.999Z`;

  const [invoicesResult, paymentsResult, costsResult, expensesResult, orderRates, fx] = await Promise.all([
    fetchAllPages<IssuedInvoiceJoinRow>((from, to) =>
      supabase
        .from("invoices")
        .select(
          "invoice_number, quote_id, amount_jmd, subtotal_jmd, gct_amount_jmd, issued_at, status, quotes(quote_ref), companies(name)",
        )
        .neq("status", "void")
        .not("issued_at", "is", null)
        .gte("issued_at", issuedFromIso)
        .lte("issued_at", issuedToIso)
        .order("invoice_number", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("invoice_payments")
      .select(
        "amount_jmd, paid_at, method, reference, invoices(invoice_number, invoice_type, quote_id, subtotal_jmd, amount_jmd, quotes(quote_ref), companies(name))",
      )
      .gte("paid_at", range.startIso)
      .lte("paid_at", range.endIso),
    supabase
      .from("actual_costs")
      .select(
        "order_id, category, description, amount_usd, amount_jmd, incurred_date, paid_date, suppliers(name), orders(quotes(quote_ref), companies(name))",
      )
      .or(eitherDateInRange),
    supabase
      .from("expenses")
      .select(
        "description, vendor, amount_jmd, amount_usd, incurred_date, paid_date, payment_method, reference, expense_categories(name, label)",
      )
      .or(eitherDateInRange),
    loadOrderRates(supabase),
    loadCurrentFxRate(supabase),
  ]);

  if ("error" in orderRates) return { data: null, error: orderRates.error };
  const loadError =
    invoicesResult.error ??
    paymentsResult.error?.message ??
    costsResult.error?.message ??
    expensesResult.error?.message;
  if (loadError) return { data: null, error: loadError };

  const { quoteIdToOrderId, rateByOrderId } = orderRates;

  const issuedInvoices: LedgerInvoiceInput[] = (invoicesResult.data ?? []).flatMap((inv) => {
    if (!inv.issued_at) return [];
    const issuedDateIso = jamaicaDateFromTimestamp(inv.issued_at);
    if (!isWithinReportRange(issuedDateIso, range)) return [];
    // Revenue is the GCT-EXCLUSIVE subtotal. `gct_amount_jmd` is NOT NULL
    // with a 0 default, so the fallbacks below only ever fire for a row
    // predating the column — in which case the whole amount is revenue and
    // no GCT is claimed, which is the honest reading of "no split recorded".
    const revenueJmd = inv.subtotal_jmd ?? inv.amount_jmd;
    return [
      {
        grossAmountJmd: inv.amount_jmd,
        revenueJmd,
        gctJmd: inv.gct_amount_jmd ?? roundJmd(inv.amount_jmd - revenueJmd),
        issuedDateIso,
        orderId: quoteIdToOrderId.get(inv.quote_id) ?? null,
        quoteRef: inv.quotes?.quote_ref ?? "—",
        invoiceNumber: inv.invoice_number,
        companyName: inv.companies?.name ?? null,
      },
    ];
  });

  const paymentRows = (paymentsResult.data as unknown as FinancialPaymentJoinRow[]) ?? [];
  const payments: LedgerPaymentInput[] = paymentRows.map((p) => {
    // A part payment settles the GCT and the net in the proportion the
    // invoice was raised in, so the payment is pro-rated by the invoice's
    // subtotal/gross ratio rather than having GCT assigned to it in full or
    // not at all.
    const revenueJmd = roundJmd(p.amount_jmd * invoiceRevenueShare(p.invoices?.subtotal_jmd, p.invoices?.amount_jmd));
    return {
      amountJmd: p.amount_jmd,
      revenueJmd,
      gctJmd: roundJmd(p.amount_jmd - revenueJmd),
      paidAtIso: p.paid_at,
      orderId: p.invoices?.quote_id ? (quoteIdToOrderId.get(p.invoices.quote_id) ?? null) : null,
      quoteRef: p.invoices?.quotes?.quote_ref ?? "—",
      invoiceNumber: p.invoices?.invoice_number ?? "—",
      companyName: p.invoices?.companies?.name ?? null,
      method: p.method,
      reference: p.reference,
    };
  });

  const cashIn: CashInEntry[] = paymentRows.map((p) => ({
    amountJmd: p.amount_jmd,
    paidAtIso: p.paid_at,
    invoiceNumber: p.invoices?.invoice_number ?? "—",
    invoiceType: p.invoices?.invoice_type ?? "deposit",
    quoteRef: p.invoices?.quotes?.quote_ref ?? "—",
    method: p.method,
    reference: p.reference,
  }));

  const costs: LedgerCostInput[] = ((costsResult.data as unknown as FinancialCostJoinRow[]) ?? []).map((c) => ({
    orderId: c.order_id,
    category: c.category,
    amountUsd: c.amount_usd,
    amountJmd: c.amount_jmd,
    incurredDateIso: c.incurred_date,
    paidDateIso: c.paid_date,
    description: c.description,
    supplierName: c.suppliers?.name ?? null,
    quoteRef: c.orders?.quotes?.quote_ref ?? "—",
    companyName: c.orders?.companies?.name ?? null,
  }));

  const expenses: LedgerExpenseInput[] = ((expensesResult.data as unknown as ExpenseJoinRow[]) ?? []).map((e) => ({
    // expense_category_id is NOT NULL behind an ON DELETE RESTRICT FK, so
    // this embed can only be null if the join itself failed — the fallback
    // keeps the statement rendering, and is visibly a fallback rather than a
    // silently-dropped row.
    categoryName: e.expense_categories?.name ?? "uncategorized",
    categoryLabel: e.expense_categories?.label ?? "Uncategorized",
    amountJmd: e.amount_jmd,
    amountUsd: e.amount_usd,
    incurredDateIso: e.incurred_date,
    paidDateIso: e.paid_date,
    description: e.description,
    vendor: e.vendor,
    reference: e.reference,
  }));

  return { data: { issuedInvoices, payments, cashIn, costs, expenses, rateByOrderId, fx }, error: null };
}

/**
 * Cash OUT entries for the cash-flow statement, derived from the already
 * loaded rows. Only rows carrying a `paid_date` appear — an unpaid bill is
 * not a cash movement (see lib/reports/cashflow.ts's header). A row whose
 * amount cannot be resolved to JMD is reported in `unconvertedUsd` rather
 * than counted as zero.
 *
 * `range` IS REQUIRED, AND IS APPLIED HERE. The loader's cost/expense query
 * is deliberately wide (it fetches a row when EITHER of its two dates falls
 * in range), so a December bill paid in January arrives in a January-only
 * load. `computeCashFlowByMonth` drops such a row from the monthly buckets,
 * but the `unconvertedUsd` tally computed here does not go through it — so
 * without this check the amber "could not be converted" warning counted
 * out-of-range rows and overstated the shortfall.
 *
 * `usedCurrentRateConversion` reports whether any outflow above is a
 * USD-only OPERATING EXPENSE converted at the live parameter rate, so the
 * page discloses the live-rate caveat exactly when it applies (a historical
 * USD outflow otherwise changes value whenever the founder edits the rate).
 */
export function buildCashOutEntries(
  data: FinancialStatementData,
  range: ReportDateRange,
): {
  entries: CashOutEntry[];
  unconvertedUsd: number;
  usedCurrentRateConversion: boolean;
} {
  const entries: CashOutEntry[] = [];
  let unconvertedUsd = 0;
  let usedCurrentRateConversion = false;

  for (const c of data.costs) {
    if (c.paidDateIso == null) continue;
    if (!isWithinReportRange(c.paidDateIso, range)) continue;
    const amountJmd = costAmountJmd(c, data.rateByOrderId);
    if (amountJmd == null) {
      unconvertedUsd += c.amountUsd ?? 0;
      continue;
    }
    entries.push({
      amountJmd,
      paidAtIso: c.paidDateIso,
      kind: "cost_of_sales",
      categoryLabel: ACTUAL_COST_CATEGORY_LABELS[c.category],
      description: c.description,
      party: c.supplierName ?? c.companyName,
      reference: c.quoteRef,
    });
  }

  for (const e of data.expenses) {
    if (e.paidDateIso == null) continue;
    if (!isWithinReportRange(e.paidDateIso, range)) continue;
    const amountJmd = expenseAmountJmd(e, data.fx);
    if (amountJmd == null) {
      unconvertedUsd += e.amountUsd ?? 0;
      continue;
    }
    // A USD-only expense has no order and therefore no locked rate: this
    // figure came from the CURRENT parameter rate and is not stable over
    // time. Only such a row triggers the page's FX disclosure.
    if (e.amountJmd == null && e.amountUsd != null) usedCurrentRateConversion = true;
    entries.push({
      amountJmd,
      paidAtIso: e.paidDateIso,
      kind: "operating_expense",
      categoryLabel: e.categoryLabel,
      description: e.description,
      party: e.vendor,
      reference: e.reference,
    });
  }

  return { entries, unconvertedUsd, usedCurrentRateConversion };
}
