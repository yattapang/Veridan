/**
 * Pipeline + KPI data-fetching (Tasks 20-21) — server-side glue between
 * Supabase and the pure computation in lib/kpis.ts / lib/pipeline.ts /
 * lib/dashboard.ts. Kept separate from the pure math (same split as
 * lib/quotes/persist.ts) so /admin/pipeline and /admin can both call these
 * functions without duplicating queries, and so the arithmetic stays
 * testable without a database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineViewRow, QuoteStatus } from "@/lib/supabase/types";
import {
  computeAverageOrderValue,
  computeAverageTurnaroundBusinessDays,
  computeConversionRate,
  computeMonthlyConversion,
  findMarginBreaches,
  getCurrentQuarterRange,
  isConversionEarlyWarning,
  isWithinRange,
  type AverageOrderValueResult,
  type ConversionResult,
  type MarginFlagQuote,
} from "@/lib/kpis";
import { buildRecentActivity, type ActivityItem } from "@/lib/dashboard";

// A loosely-typed client is fine here — this repo has no generated DB types
// yet (see lib/supabase/types.ts header), matching the pattern used across
// the admin actions (lib/quotes/persist.ts, lib/quotes/pdf.ts).
type Client = SupabaseClient;

export async function fetchPipelineRows(
  supabase: Client,
): Promise<{ rows: PipelineViewRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("pipeline_view")
    .select("*")
    .order("enquiry_created_at", { ascending: false });
  if (error) return { rows: [], error: error.message };
  return { rows: (data as unknown as PipelineViewRow[]) ?? [], error: null };
}

interface QuoteKpiRow {
  id: string;
  quote_ref: string;
  status: QuoteStatus;
  project_id: string;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  total_client_jmd: number | null;
  total_client_usd: number | null;
  total_landed_usd: number | null;
}

/** The date a quote "settles" into the conversion denominator — see lib/kpis.ts computeMonthlyConversion doc. */
function outcomeDateOf(q: QuoteKpiRow): string | null {
  return q.accepted_at ?? q.declined_at ?? q.sent_at;
}

export interface DashboardKpis {
  quarterRange: { startIso: string; endIsoExclusive: string };
  conversion: ConversionResult;
  conversionEarlyWarning: boolean;
  turnaroundBusinessDays: number | null;
  averageOrderValue: AverageOrderValueResult;
  marginBreaches: MarginFlagQuote[];
  /** Non-fatal query error, if any — pages should degrade gracefully rather than crash. */
  error: string | null;
}

/**
 * Computes every KPI + early-warning flag from three queries: all quotes
 * (for conversion/turnaround/order-value/margin), and enquiries that were
 * converted to a project (for the turnaround pairing). Shared by
 * /admin/pipeline (Task 20) and /admin (Task 21) so the numbers can never
 * drift between the two pages.
 */
export async function fetchDashboardKpis(
  supabase: Client,
  now: Date = new Date(),
): Promise<DashboardKpis> {
  const quarterRange = getCurrentQuarterRange(now);

  const [quotesResult, enquiriesResult] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, quote_ref, status, project_id, sent_at, accepted_at, declined_at, total_client_jmd, total_client_usd, total_landed_usd",
      ),
    supabase.from("enquiries").select("id, created_at, project_id").not("project_id", "is", null),
  ]);

  if (quotesResult.error) {
    return {
      quarterRange,
      conversion: { acceptedCount: 0, resolvedCount: 0, conversionPct: null },
      conversionEarlyWarning: false,
      turnaroundBusinessDays: null,
      averageOrderValue: { count: 0, avgJmd: null, avgUsd: null },
      marginBreaches: [],
      error: quotesResult.error.message,
    };
  }

  const quotes = (quotesResult.data as unknown as QuoteKpiRow[]) ?? [];
  const enquiries = enquiriesResult.error
    ? []
    : ((enquiriesResult.data as unknown as { id: string; created_at: string; project_id: string }[]) ?? []);

  // --- Conversion (current quarter) ---
  const quotesThisQuarter = quotes.filter((q) => isWithinRange(outcomeDateOf(q), quarterRange));
  const conversion = computeConversionRate(quotesThisQuarter);

  // --- Monthly conversion early-warning (all data, not quarter-scoped) ---
  const monthlyConversion = computeMonthlyConversion(
    quotes.map((q) => ({ status: q.status, outcomeDateIso: outcomeDateOf(q) })),
  );
  const conversionEarlyWarning = isConversionEarlyWarning(monthlyConversion, now);

  // --- Turnaround: earliest sent_at per project, paired with that project's enquiry ---
  const earliestSentByProject = new Map<string, string>();
  for (const q of quotes) {
    if (!q.sent_at) continue;
    const existing = earliestSentByProject.get(q.project_id);
    if (!existing || q.sent_at < existing) earliestSentByProject.set(q.project_id, q.sent_at);
  }
  const turnaroundPairs = enquiries
    .map((e) => {
      const firstSent = earliestSentByProject.get(e.project_id);
      return firstSent ? { enquiryCreatedAtIso: e.created_at, firstQuoteSentAtIso: firstSent } : null;
    })
    .filter((p): p is { enquiryCreatedAtIso: string; firstQuoteSentAtIso: string } => p != null);
  const turnaroundBusinessDays = computeAverageTurnaroundBusinessDays(turnaroundPairs);

  // --- Average order value + margin breaches (accepted quotes, all-time) ---
  const acceptedQuotes = quotes.filter((q) => q.status === "accepted");
  const averageOrderValue = computeAverageOrderValue(acceptedQuotes);
  const marginBreaches = findMarginBreaches(acceptedQuotes);

  return {
    quarterRange,
    conversion,
    conversionEarlyWarning,
    turnaroundBusinessDays,
    averageOrderValue,
    marginBreaches,
    error: null,
  };
}

export async function fetchRecentActivity(
  supabase: Client,
  limit = 10,
): Promise<{ items: ActivityItem[]; error: string | null }> {
  const [enquiriesResult, sentResult, acceptedResult] = await Promise.all([
    supabase
      .from("enquiries")
      .select("id, contact_name, company_name, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("quotes")
      .select("id, quote_ref, sent_at")
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(limit),
    supabase
      .from("quotes")
      .select("id, quote_ref, accepted_at")
      .not("accepted_at", "is", null)
      .order("accepted_at", { ascending: false })
      .limit(limit),
  ]);

  const error = enquiriesResult.error?.message ?? sentResult.error?.message ?? acceptedResult.error?.message ?? null;
  if (error) return { items: [], error };

  const items = buildRecentActivity(
    {
      enquiries: (enquiriesResult.data as unknown as {
        id: string;
        contact_name: string;
        company_name: string | null;
        created_at: string;
      }[]) ?? [],
      quotesSent: (sentResult.data as unknown as { id: string; quote_ref: string; sent_at: string }[]) ?? [],
      quotesAccepted:
        (acceptedResult.data as unknown as { id: string; quote_ref: string; accepted_at: string }[]) ?? [],
    },
    limit,
  );
  return { items, error: null };
}
