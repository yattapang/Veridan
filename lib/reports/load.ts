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
  InvoiceStatus,
  InvoiceType,
  OrderStatus,
} from "@/lib/supabase/types";
import type { CashInEntry } from "./cashflow";
import {
  quotedCategoriesFromOrigins,
  type MarginAuditCostInput,
  type MarginAuditInvoiceInput,
  type MarginAuditOrderInput,
  type MarginAuditPaymentInput,
  type QuoteOriginCostRow,
} from "./marginAudit";
import { isWithinReportRange, type ReportDateRange } from "./period";
import type { OrderRateLookup, PnlCostInput, PnlPaymentInput } from "./pnl";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// P&L
// ---------------------------------------------------------------------------

interface PnlPaymentJoinRow {
  amount_jmd: number;
  paid_at: string;
  invoices: {
    invoice_number: string;
    quote_id: string;
    quotes: { quote_ref: string } | null;
  } | null;
}

interface PnlCostJoinRow {
  order_id: string;
  category: ActualCostCategory;
  amount_usd: number | null;
  amount_jmd: number | null;
  incurred_date: string;
}

interface PnlOrderJoinRow {
  id: string;
  quote_id: string;
  quotes: { fx_snapshot: { effective_rate: number } } | null;
}

export interface PnlData {
  payments: PnlPaymentInput[];
  costs: PnlCostInput[];
  rateByOrderId: OrderRateLookup;
}

export async function loadPnlData(
  supabase: SupabaseServerClient,
  range: ReportDateRange,
): Promise<{ data: PnlData | null; error: string | null }> {
  const [paymentsResult, costsResult, ordersResult] = await Promise.all([
    supabase
      .from("invoice_payments")
      .select("amount_jmd, paid_at, invoices(invoice_number, quote_id, quotes(quote_ref))")
      .gte("paid_at", range.startIso)
      .lte("paid_at", range.endIso),
    supabase
      .from("actual_costs")
      .select("order_id, category, amount_usd, amount_jmd, incurred_date")
      .gte("incurred_date", range.startIso)
      .lte("incurred_date", range.endIso),
    supabase.from("orders").select("id, quote_id, quotes(fx_snapshot)"),
  ]);

  const loadError = paymentsResult.error ?? costsResult.error ?? ordersResult.error;
  if (loadError) return { data: null, error: loadError.message };

  const orders = (ordersResult.data as unknown as PnlOrderJoinRow[]) ?? [];
  const quoteIdToOrderId = new Map(orders.map((o) => [o.quote_id, o.id]));
  const rateByOrderId: OrderRateLookup = {};
  for (const o of orders) {
    const rate = o.quotes?.fx_snapshot?.effective_rate;
    if (rate != null) rateByOrderId[o.id] = rate;
  }

  const payments: PnlPaymentInput[] = ((paymentsResult.data as unknown as PnlPaymentJoinRow[]) ?? []).map((p) => ({
    amountJmd: p.amount_jmd,
    paidAtIso: p.paid_at,
    orderId: p.invoices?.quote_id ? (quoteIdToOrderId.get(p.invoices.quote_id) ?? null) : null,
    quoteRef: p.invoices?.quotes?.quote_ref ?? "—",
    invoiceNumber: p.invoices?.invoice_number ?? "—",
  }));

  const costs: PnlCostInput[] = ((costsResult.data as unknown as PnlCostJoinRow[]) ?? []).map((c) => ({
    orderId: c.order_id,
    amountUsd: c.amount_usd,
    amountJmd: c.amount_jmd,
    incurredDateIso: c.incurred_date,
    category: c.category,
  }));

  return { data: { payments, costs, rateByOrderId }, error: null };
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

interface CashFlowJoinRow {
  amount_jmd: number;
  paid_at: string;
  method: string | null;
  reference: string | null;
  invoices: {
    invoice_number: string;
    invoice_type: InvoiceType;
    quotes: { quote_ref: string } | null;
  } | null;
}

export async function loadCashFlowData(
  supabase: SupabaseServerClient,
  range: ReportDateRange,
): Promise<{ data: CashInEntry[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from("invoice_payments")
    .select("amount_jmd, paid_at, method, reference, invoices(invoice_number, invoice_type, quotes(quote_ref))")
    .gte("paid_at", range.startIso)
    .lte("paid_at", range.endIso);

  if (error) return { data: null, error: error.message };

  const entries: CashInEntry[] = ((data as unknown as CashFlowJoinRow[]) ?? []).map((p) => ({
    amountJmd: p.amount_jmd,
    paidAtIso: p.paid_at,
    invoiceNumber: p.invoices?.invoice_number ?? "—",
    invoiceType: p.invoices?.invoice_type ?? "deposit",
    quoteRef: p.invoices?.quotes?.quote_ref ?? "—",
    method: p.method,
    reference: p.reference,
  }));

  return { data: entries, error: null };
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
