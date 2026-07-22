/**
 * Margin-audit computation — PURE, no Supabase client, no I/O (Task 55).
 *
 * This is the ONE report where a quote's own numbers legitimately appear as
 * values, not just labels: they are the QUOTED baseline — the projection that
 * is being audited against reality. Everywhere else in lib/reports/* a quote
 * is a label only (PRD §9.2 / Phase2_Plan §6 Layer 2). Here the quote's
 * cached totals (`quotes.total_landed_usd` / `total_client_usd` /
 * `total_client_jmd`) and its per-origin cost components are the "projection
 * side" of a quoted-vs-actual-vs-realized comparison, and every such number
 * is surfaced under an explicit "Quoted" heading so it can never be mistaken
 * for a real (payment/cost) figure.
 *
 * THREE MARGIN VIEWS PER ORDER (all clearly labeled in the UI):
 *   1. QUOTED   — the projection. Effective margin from the quote's cached
 *                 totals: (total_client_usd − total_landed_usd) / total_client_usd.
 *                 Same definition lib/kpis.ts uses, so the audit's "quoted"
 *                 baseline matches the pipeline early-warning number exactly.
 *   2. ACTUAL   — actual_costs summed and converted to USD at the order's
 *                 quote-locked fx rate (display conversion only, labeled),
 *                 compared component-by-component against the quoted landed
 *                 cost. This produces cost VARIANCES, not a margin per se.
 *   3. REALIZED — cash basis: (payments_received − actual_costs) / payments_
 *                 received, in JMD. This is the only view built from real
 *                 money on both sides (invoice_payments in, actual_costs out).
 *                 When the order isn't fully billed-and-paid, the realized
 *                 figure is partial, so a PROJECTED-realized margin (expected
 *                 full revenue vs costs-to-date) is used for the floor check
 *                 and the row carries a completeness note.
 *
 * FLOOR-DRIFT FLAG (PRD §8 early-warning): an order is flagged red when the
 * margin used for its floor check (realized when complete, projected-realized
 * while in-flight) falls below the quote's SNAPSHOTTED margin floor —
 * `quotes.parameters_snapshot.margin_floor_pct`, read from the frozen
 * snapshot, never from live business_parameters, so a later floor change can't
 * retroactively clear or trip a historical order.
 *
 * FX ASSUMPTION: `effectiveRate` is `fx_snapshot.effective_rate` (JMD per 1
 * USD), always present and > 0 for any created quote (built by
 * lib/quotes/snapshot.ts). Conversions use convertAtQuoteRate; a defensive
 * null (invalid rate) contributes 0 and is surfaced via `hasUnconvertibleCost`
 * so a total is never silently understated.
 */

import { convertAtQuoteRate } from "../orders/format";
import type { ActualCostCategory, InvoiceStatus, OrderStatus } from "@/lib/supabase/types";

const EPS = 0.005;

// ---------------------------------------------------------------------------
// Category mapping (actual_costs.category → audited variance category)
// ---------------------------------------------------------------------------

/**
 * The cost buckets a quoted-vs-actual variance is computed for. `hardware` is
 * the supplier invoice (goods); the rest are the landed-cost shipment
 * components the engine stores on quote_origins. `brokerage_port` merges the
 * two closely-related handling lines (brokerage + port handling) per the Task
 * 55 brief, since the quote engine and real bills routinely lump them.
 */
export type VarianceCategory = "hardware" | "freight" | "insurance" | "brokerage_port" | "duty";

export const VARIANCE_CATEGORIES: VarianceCategory[] = [
  "hardware",
  "freight",
  "insurance",
  "brokerage_port",
  "duty",
];

export const VARIANCE_CATEGORY_LABELS: Record<VarianceCategory, string> = {
  hardware: "Hardware",
  freight: "Freight",
  insurance: "Insurance",
  brokerage_port: "Brokerage + port",
  duty: "Duty",
};

/**
 * Maps an actual cost category to its audited variance category, or
 * "uncategorized" for categories the quote engine has no matching component
 * for (delivery, other) — those actuals still count in the order's total cost
 * and realized margin, but have no quoted line to diff against, so they land
 * in a clearly-separated "uncategorized" bucket rather than being force-fit.
 */
export const ACTUAL_TO_VARIANCE_CATEGORY: Record<ActualCostCategory, VarianceCategory | "uncategorized"> = {
  hardware: "hardware",
  freight: "freight",
  insurance: "insurance",
  brokerage: "brokerage_port",
  port_handling: "brokerage_port",
  duty: "duty",
  delivery: "uncategorized",
  other: "uncategorized",
};

// ---------------------------------------------------------------------------
// Quoted per-category components from quote_origins
// ---------------------------------------------------------------------------

/** The subset of quote_origins columns the audit's quoted-cost breakdown reads (summed across every origin of a quote). */
export interface QuoteOriginCostRow {
  supplier_invoice_total: number | null;
  freight_export_fees_usd: number | null;
  ocean_freight_usd: number | null;
  marine_insurance_usd: number | null;
  port_handling_usd: number | null;
  brokerage_usd: number | null;
  cif_basis_usd: number | null;
  duty_gct_pct: number | null;
}

function zeroCategories(): Record<VarianceCategory, number> {
  return { hardware: 0, freight: 0, insurance: 0, brokerage_port: 0, duty: 0 };
}

/**
 * Reconstructs the quoted per-category landed-cost breakdown (USD) from a
 * quote's origin rows, mirroring lib/landed-cost/engine.ts's own component
 * math so the "quoted" side of the audit lines up with how the quote was
 * priced:
 *   - hardware        = Σ supplier_invoice_total (goods, already USD)
 *   - freight         = Σ (freight_export_fees_usd + ocean_freight_usd)
 *   - insurance       = Σ marine_insurance_usd
 *   - brokerage_port  = Σ (brokerage_usd + port_handling_usd)
 *   - duty            = Σ (cif_basis_usd × duty_gct_pct / 100)
 * Null columns are treated as 0 (an origin that never had that component).
 */
export function quotedCategoriesFromOrigins(origins: QuoteOriginCostRow[]): Record<VarianceCategory, number> {
  const acc = zeroCategories();
  for (const o of origins) {
    acc.hardware += o.supplier_invoice_total ?? 0;
    acc.freight += (o.freight_export_fees_usd ?? 0) + (o.ocean_freight_usd ?? 0);
    acc.insurance += o.marine_insurance_usd ?? 0;
    acc.brokerage_port += (o.brokerage_usd ?? 0) + (o.port_handling_usd ?? 0);
    acc.duty += (o.cif_basis_usd ?? 0) * ((o.duty_gct_pct ?? 0) / 100);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface MarginAuditOrderInput {
  orderId: string;
  quoteRef: string;
  orderStatus: OrderStatus;
  /** quotes.total_landed_usd — quoted landed cost (projection baseline). */
  quotedLandedUsd: number | null;
  /** quotes.total_client_usd — quoted client price in USD (informational). */
  quotedClientUsd: number | null;
  /** quotes.total_client_jmd — quoted client price in JMD (the projected revenue if unbilled). */
  quotedClientJmd: number | null;
  /** parameters_snapshot.margin_floor_pct — SNAPSHOTTED floor, never live params. */
  marginFloorPct: number;
  /** fx_snapshot.effective_rate — JMD per 1 USD, quote-locked. */
  effectiveRate: number;
  /** Per-category quoted landed-cost components (USD), from quotedCategoriesFromOrigins. */
  quotedCategoriesUsd: Record<VarianceCategory, number>;
}

export interface MarginAuditCostInput {
  orderId: string;
  category: ActualCostCategory;
  amountUsd: number | null;
  amountJmd: number | null;
}

export interface MarginAuditPaymentInput {
  orderId: string;
  amountJmd: number;
}

export interface MarginAuditInvoiceInput {
  orderId: string;
  amountJmd: number;
  status: InvoiceStatus;
}

// ---------------------------------------------------------------------------
// Output rows
// ---------------------------------------------------------------------------

export interface MarginAuditCategoryVariance {
  category: VarianceCategory;
  quotedUsd: number;
  actualUsd: number;
  /** actual − quoted (positive = spent more than quoted). */
  varianceUsd: number;
  /** True when there is a quoted figure to compare against (a quoted or actual amount exists). */
  derivable: boolean;
}

export interface MarginAuditOrderRow {
  orderId: string;
  quoteRef: string;
  orderStatus: OrderStatus;

  // ---- Quoted (projection baseline) ----
  quotedLandedUsd: number | null;
  quotedClientUsd: number | null;
  quotedClientJmd: number | null;
  /** Effective margin from the quote's cached totals, %; null when totals absent. */
  quotedMarginPct: number | null;

  // ---- Actual costs ----
  actualCostUsd: number;
  actualCostJmd: number;
  uncategorizedActualUsd: number;
  /** True if any actual cost row could not be currency-converted (invalid rate) and was counted as 0. */
  hasUnconvertibleCost: boolean;
  /** Total quoted-vs-actual cost variance (USD): actualCostUsd − quotedLandedUsd. */
  totalCostVarianceUsd: number | null;
  categories: MarginAuditCategoryVariance[];

  // ---- Realized (cash basis) ----
  paymentsReceivedJmd: number;
  totalInvoicedJmd: number;
  realizedCostJmd: number;
  /** (payments − actuals) / payments, %; null when no payments received yet. */
  realizedMarginPct: number | null;

  // ---- Projected realized (expected full revenue vs costs to date) ----
  projectedRevenueJmd: number;
  projectedRealizedMarginPct: number | null;

  // ---- Floor check ----
  marginFloorPct: number;
  /** Realized margin when the order is complete, else projected-realized — the number compared to the floor. */
  marginForFloorCheckPct: number | null;
  floorDrift: boolean;

  // ---- Completeness ----
  fullyPaid: boolean;
  orderClosed: boolean;
  isComplete: boolean;
  /** Non-null when the realized figure is provisional — tells the founder why. */
  completenessNote: string | null;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

interface Converted {
  value: number;
  ok: boolean;
}

/** A cost row's USD value: USD rows use their own amount; JMD-only rows convert jmdToUsd at the quote rate. */
function costToUsd(cost: MarginAuditCostInput, rate: number): Converted {
  if (cost.amountUsd != null) return { value: cost.amountUsd, ok: true };
  if (cost.amountJmd != null) {
    const v = convertAtQuoteRate(cost.amountJmd, "jmdToUsd", rate);
    return v == null ? { value: 0, ok: false } : { value: v, ok: true };
  }
  return { value: 0, ok: true };
}

/** A cost row's JMD value: JMD rows use their own amount; USD-only rows convert usdToJmd at the quote rate. */
function costToJmd(cost: MarginAuditCostInput, rate: number): Converted {
  if (cost.amountJmd != null) return { value: cost.amountJmd, ok: true };
  if (cost.amountUsd != null) {
    const v = convertAtQuoteRate(cost.amountUsd, "usdToJmd", rate);
    return v == null ? { value: 0, ok: false } : { value: v, ok: true };
  }
  return { value: 0, ok: true };
}

/** (client − landed) / client, as a percent. Null when totals aren't both present and client is positive. */
export function quotedEffectiveMarginPct(clientUsd: number | null, landedUsd: number | null): number | null {
  if (clientUsd == null || landedUsd == null || clientUsd <= 0) return null;
  return ((clientUsd - landedUsd) / clientUsd) * 100;
}

// ---------------------------------------------------------------------------
// Per-order computation
// ---------------------------------------------------------------------------

function computeOrderRow(
  order: MarginAuditOrderInput,
  costs: MarginAuditCostInput[],
  payments: MarginAuditPaymentInput[],
  invoices: MarginAuditInvoiceInput[],
): MarginAuditOrderRow {
  const rate = order.effectiveRate;

  // ---- Actual costs, by category and in both currencies. ----
  const actualByCategory = zeroCategories();
  let uncategorizedActualUsd = 0;
  let actualCostUsd = 0;
  let actualCostJmd = 0;
  let hasUnconvertibleCost = false;

  for (const c of costs) {
    const usd = costToUsd(c, rate);
    const jmd = costToJmd(c, rate);
    if (!usd.ok || !jmd.ok) hasUnconvertibleCost = true;
    actualCostUsd += usd.value;
    actualCostJmd += jmd.value;
    const mapped = ACTUAL_TO_VARIANCE_CATEGORY[c.category];
    if (mapped === "uncategorized") {
      uncategorizedActualUsd += usd.value;
    } else {
      actualByCategory[mapped] += usd.value;
    }
  }

  const categories: MarginAuditCategoryVariance[] = VARIANCE_CATEGORIES.map((category) => {
    const quotedUsd = order.quotedCategoriesUsd[category] ?? 0;
    const actualUsd = actualByCategory[category];
    return {
      category,
      quotedUsd,
      actualUsd,
      varianceUsd: actualUsd - quotedUsd,
      derivable: quotedUsd > 0 || actualUsd > 0,
    };
  });

  const totalCostVarianceUsd = order.quotedLandedUsd == null ? null : actualCostUsd - order.quotedLandedUsd;

  // ---- Realized (cash basis). ----
  const paymentsReceivedJmd = payments.reduce((s, p) => s + p.amountJmd, 0);
  const totalInvoicedJmd = invoices
    .filter((i) => i.status !== "void")
    .reduce((s, i) => s + i.amountJmd, 0);
  const realizedCostJmd = actualCostJmd;
  const realizedMarginPct =
    paymentsReceivedJmd > 0 ? ((paymentsReceivedJmd - realizedCostJmd) / paymentsReceivedJmd) * 100 : null;

  // Expected full revenue: the largest defensible target — whatever has been
  // billed, or the quoted client total, or (as a floor) what's already been
  // received — so a deposit-only order isn't judged as if the deposit were its
  // whole revenue.
  const projectedRevenueJmd = Math.max(
    totalInvoicedJmd,
    order.quotedClientJmd ?? 0,
    paymentsReceivedJmd,
  );
  const projectedRealizedMarginPct =
    projectedRevenueJmd > 0 ? ((projectedRevenueJmd - realizedCostJmd) / projectedRevenueJmd) * 100 : null;

  // ---- Completeness + floor check. ----
  const fullyPaid = totalInvoicedJmd > 0 && paymentsReceivedJmd + EPS >= totalInvoicedJmd;
  const orderClosed = order.orderStatus === "closed";
  const isComplete = fullyPaid && orderClosed;

  const marginForFloorCheckPct = isComplete ? realizedMarginPct : projectedRealizedMarginPct;
  const floorDrift = marginForFloorCheckPct != null && marginForFloorCheckPct < order.marginFloorPct;

  let completenessNote: string | null = null;
  if (!isComplete) {
    const reasons: string[] = [];
    if (!orderClosed) reasons.push("order not yet closed");
    if (!fullyPaid) {
      reasons.push(totalInvoicedJmd === 0 ? "no invoices issued yet" : "invoices not fully paid");
    }
    completenessNote = `Provisional — ${reasons.join(", ")}; figure shown is projected-realized (expected full revenue vs. costs recorded so far).`;
  }

  return {
    orderId: order.orderId,
    quoteRef: order.quoteRef,
    orderStatus: order.orderStatus,
    quotedLandedUsd: order.quotedLandedUsd,
    quotedClientUsd: order.quotedClientUsd,
    quotedClientJmd: order.quotedClientJmd,
    quotedMarginPct: quotedEffectiveMarginPct(order.quotedClientUsd, order.quotedLandedUsd),
    actualCostUsd,
    actualCostJmd,
    uncategorizedActualUsd,
    hasUnconvertibleCost,
    totalCostVarianceUsd,
    categories,
    paymentsReceivedJmd,
    totalInvoicedJmd,
    realizedCostJmd,
    realizedMarginPct,
    projectedRevenueJmd,
    projectedRealizedMarginPct,
    marginFloorPct: order.marginFloorPct,
    marginForFloorCheckPct,
    floorDrift,
    fullyPaid,
    orderClosed,
    isComplete,
    completenessNote,
  };
}

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

export interface MarginAuditRollup {
  orderCount: number;
  flaggedCount: number;
  totalQuotedLandedUsd: number;
  totalActualCostUsd: number;
  totalCostVarianceUsd: number;
  totalPaymentsReceivedJmd: number;
  totalRealizedCostJmd: number;
  /** Portfolio realized margin across every order with payments, %; null when no cash received. */
  realizedMarginPct: number | null;
  /** Per-category quoted vs actual totals across all orders. */
  categories: MarginAuditCategoryVariance[];
}

export interface MarginAuditReport {
  rows: MarginAuditOrderRow[];
  rollup: MarginAuditRollup;
}

function rollupCategories(rows: MarginAuditOrderRow[]): MarginAuditCategoryVariance[] {
  return VARIANCE_CATEGORIES.map((category) => {
    let quotedUsd = 0;
    let actualUsd = 0;
    for (const row of rows) {
      const c = row.categories.find((x) => x.category === category);
      if (c) {
        quotedUsd += c.quotedUsd;
        actualUsd += c.actualUsd;
      }
    }
    return {
      category,
      quotedUsd,
      actualUsd,
      varianceUsd: actualUsd - quotedUsd,
      derivable: quotedUsd > 0 || actualUsd > 0,
    };
  });
}

/**
 * Builds the full margin-audit report from raw per-order inputs. Rows are
 * sorted floor-drift-flagged first, then by the floor-check margin ascending
 * (worst margin at the top — the founder's eye lands on the orders that need
 * attention). Nulls (no margin computable) sort last within their group.
 */
export function buildMarginAudit(
  orders: MarginAuditOrderInput[],
  costs: MarginAuditCostInput[],
  payments: MarginAuditPaymentInput[],
  invoices: MarginAuditInvoiceInput[],
): MarginAuditReport {
  const costsByOrder = new Map<string, MarginAuditCostInput[]>();
  for (const c of costs) {
    const list = costsByOrder.get(c.orderId) ?? [];
    list.push(c);
    costsByOrder.set(c.orderId, list);
  }
  const paymentsByOrder = new Map<string, MarginAuditPaymentInput[]>();
  for (const p of payments) {
    const list = paymentsByOrder.get(p.orderId) ?? [];
    list.push(p);
    paymentsByOrder.set(p.orderId, list);
  }
  const invoicesByOrder = new Map<string, MarginAuditInvoiceInput[]>();
  for (const i of invoices) {
    const list = invoicesByOrder.get(i.orderId) ?? [];
    list.push(i);
    invoicesByOrder.set(i.orderId, list);
  }

  const rows = orders.map((order) =>
    computeOrderRow(
      order,
      costsByOrder.get(order.orderId) ?? [],
      paymentsByOrder.get(order.orderId) ?? [],
      invoicesByOrder.get(order.orderId) ?? [],
    ),
  );

  rows.sort((a, b) => {
    if (a.floorDrift !== b.floorDrift) return a.floorDrift ? -1 : 1;
    const am = a.marginForFloorCheckPct;
    const bm = b.marginForFloorCheckPct;
    if (am == null && bm == null) return a.quoteRef.localeCompare(b.quoteRef);
    if (am == null) return 1;
    if (bm == null) return -1;
    return am - bm;
  });

  const totalPaymentsReceivedJmd = rows.reduce((s, r) => s + r.paymentsReceivedJmd, 0);
  const totalRealizedCostJmd = rows.reduce((s, r) => s + r.realizedCostJmd, 0);
  const totalQuotedLandedUsd = rows.reduce((s, r) => s + (r.quotedLandedUsd ?? 0), 0);
  const totalActualCostUsd = rows.reduce((s, r) => s + r.actualCostUsd, 0);

  const rollup: MarginAuditRollup = {
    orderCount: rows.length,
    flaggedCount: rows.filter((r) => r.floorDrift).length,
    totalQuotedLandedUsd,
    totalActualCostUsd,
    totalCostVarianceUsd: totalActualCostUsd - totalQuotedLandedUsd,
    totalPaymentsReceivedJmd,
    totalRealizedCostJmd,
    realizedMarginPct:
      totalPaymentsReceivedJmd > 0
        ? ((totalPaymentsReceivedJmd - totalRealizedCostJmd) / totalPaymentsReceivedJmd) * 100
        : null,
    categories: rollupCategories(rows),
  };

  return { rows, rollup };
}
