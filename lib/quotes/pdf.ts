/**
 * Quote PDF data loading + rendering (Task 18, extracted for Task 19). This
 * is the query/transform logic that used to live entirely inside
 * app/api/quotes/[id]/pdf/route.ts — pulled out here so the send flow
 * (workflowActions.ts) can render the exact same PDF buffer for its Resend
 * attachment + Storage artifact without duplicating ~150 lines of Supabase
 * joins and door/line grouping. The route now calls `renderQuotePdf` too, so
 * there is exactly one place that turns a quote id into a PDF buffer.
 */

import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeQuoteResult } from "@/lib/quotes/mapping";
import { matchLeadTime } from "@/lib/quote-pdf/format";
import {
  QuotePdf,
  type QuotePdfDoorGroupRow,
  type QuotePdfFlatLineRow,
  type QuotePdfOriginLeadTime,
} from "@/lib/quote-pdf/QuotePdf";
import { siteMeta, contactInfo } from "@/lib/site-content";
import type {
  QuoteLineItemWithDetails,
  QuoteOriginRow,
  QuoteWithProject,
} from "@/lib/supabase/types";

type Client = SupabaseClient;

export type QuotePdfLoadResult =
  | { ok: true; quoteRef: string; buffer: Buffer; error?: undefined }
  | { ok: false; status: number; error: string };

/**
 * Loads a quote's full display state, runs the pure engine over its OWN
 * frozen snapshots (never live parameters — §1.7), and renders the
 * client-facing PDF to a buffer. Identical query shape to
 * app/admin/quotes/[id]/page.tsx and the same engine entrypoint, so the
 * PDF's numbers are guaranteed to match what the builder page shows.
 */
export async function renderQuotePdf(supabase: Client, quoteId: string): Promise<QuotePdfLoadResult> {
  const { data: quoteData, error: quoteError } = await supabase
    .from("quotes")
    .select("*, projects(id, name, site_address, architect_company_id, companies(id, name))")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) return { ok: false, status: 500, error: quoteError.message };
  if (!quoteData) return { ok: false, status: 404, error: "Quote not found." };

  const quote = quoteData as unknown as QuoteWithProject & {
    projects: (QuoteWithProject["projects"] & { site_address: string | null; architect_company_id: string | null }) | null;
  };

  const architectCompanyId = quote.architect_company_id ?? quote.projects?.architect_company_id ?? null;

  const [originsResult, linesResult, architectResult] = await Promise.all([
    supabase.from("quote_origins").select("*").eq("quote_id", quoteId).order("origin_label"),
    supabase
      .from("quote_line_items")
      .select(
        "*, products(id, description, manufacturer, product_ref, unit), doors(id, door_number, floor), hardware_sets(id, code, name), suppliers(id, name)"
      )
      .eq("quote_id", quoteId)
      .order("sort_order"),
    architectCompanyId
      ? supabase.from("companies").select("id, name").eq("id", architectCompanyId).maybeSingle()
      : Promise.resolve({ data: null as { id: string; name: string } | null, error: null }),
  ]);

  if (originsResult.error) return { ok: false, status: 500, error: originsResult.error.message };
  if (linesResult.error) return { ok: false, status: 500, error: linesResult.error.message };

  const origins = (originsResult.data as QuoteOriginRow[]) ?? [];
  const lines = (linesResult.data as unknown as QuoteLineItemWithDetails[]) ?? [];
  const architect = architectResult.data as { id: string; name: string } | null;

  const result = computeQuoteResult({ quote, origins, lines });
  const isDraft = quote.status === "draft";
  const isDoorMode = quote.quote_mode === "door_register";

  const lineResultById = new Map(result.lines.map((l) => [l.lineId, l]));
  const lineDetailById = new Map(lines.map((l) => [l.id, l]));

  // ---- door_register mode: group doors by hardware set (HW-group rows). --
  const doorGroups: QuotePdfDoorGroupRow[] = [];
  if (isDoorMode) {
    const setMeta = new Map<string, { code: string; name: string | null }>();
    for (const l of lines) {
      if (l.hardware_set_id && l.hardware_sets) {
        setMeta.set(l.hardware_set_id, { code: l.hardware_sets.code, name: l.hardware_sets.name });
      }
    }

    const rollupsBySet = new Map<string, typeof result.doors>();
    for (const d of result.doors) {
      if (!d.hardwareSetId) continue;
      const list = rollupsBySet.get(d.hardwareSetId) ?? [];
      list.push(d);
      rollupsBySet.set(d.hardwareSetId, list);
    }

    for (const [setId, rollups] of rollupsBySet) {
      const meta = setMeta.get(setId);
      const doorNumbers = rollups
        .map((r) => lineDetailById.get(r.lineIds[0])?.doors?.door_number)
        .filter((n): n is string => Boolean(n));

      const representative = rollups[0];
      const compositionItems = representative.lineIds
        .map((lineId) => lineDetailById.get(lineId))
        .filter((detail): detail is QuoteLineItemWithDetails => Boolean(detail))
        .map((detail) => ({
          description: detail.products?.description ?? detail.description_override ?? "Item",
          qty: Number(detail.qty) || 0,
        }));

      const pricePerDoorJmd = rollups[0].clientPriceJmd;
      const totalJmd = rollups.reduce((sum, r) => sum + r.clientPriceJmd, 0);

      doorGroups.push({
        setCode: meta?.code ?? "—",
        setName: meta?.name ?? null,
        compositionItems,
        doorNumbers,
        doorCount: rollups.length,
        pricePerDoorJmd,
        totalJmd,
      });
    }
    doorGroups.sort((a, b) => a.setCode.localeCompare(b.setCode));
  }

  // ---- line_item mode: flat rows. ------------------------------------
  const flatLines: QuotePdfFlatLineRow[] = isDoorMode
    ? []
    : lines.map((line) => {
        const lr = lineResultById.get(line.id);
        const qty = Number(line.qty) || 0;
        const lineTotalJmd = lr?.clientPriceJmdRounded ?? 0;
        const unitPriceJmd = qty > 0 ? lineTotalJmd / qty : lineTotalJmd;
        return {
          description: line.products?.description ?? line.description_override ?? "Line item",
          qty,
          unitPriceJmd,
          lineTotalJmd,
        };
      });

  // Grand total: sum of the already-rounded components shown above, NEVER a
  // re-derivation from unrounded totals (Build Plan §3.3).
  const grandTotalJmd = isDoorMode
    ? doorGroups.reduce((sum, g) => sum + g.totalJmd, 0)
    : flatLines.reduce((sum, l) => sum + l.lineTotalJmd, 0);

  // ---- lead times, from the quote's OWN frozen snapshot. --------------
  const leadTimesTable = quote.parameters_snapshot?.lead_times ?? {};
  const leadTimes: QuotePdfOriginLeadTime[] = origins
    .map((o) => {
      const lt = matchLeadTime(o.origin_label, leadTimesTable);
      return lt ? { label: o.origin_label, leadTime: lt } : null;
    })
    .filter((v): v is QuotePdfOriginLeadTime => Boolean(v));

  // ---- company details, from the snapshot with a site-content fallback. -
  const snapshotCompany = quote.parameters_snapshot?.company_details ?? {};
  const company = {
    name: snapshotCompany.name?.trim() || siteMeta.legalName,
    address: snapshotCompany.address?.trim() || "",
    trn: snapshotCompany.trn?.trim() || "",
    phone: snapshotCompany.phone?.trim() || "",
    email: snapshotCompany.email?.trim() || contactInfo.email,
  };

  const pdfDoc = QuotePdf({
    wordmark: siteMeta.wordmark,
    quoteRef: quote.quote_ref,
    quoteDateIso: quote.quote_date,
    validityDays: quote.validity_days,
    isDraft,
    project: {
      name: quote.projects?.name ?? "—",
      clientCompanyName: quote.projects?.companies?.name ?? null,
      siteAddress: quote.projects?.site_address ?? null,
      architectCompanyName: architect?.name ?? null,
    },
    mode: quote.quote_mode,
    doorGroups,
    flatLines,
    grandTotalJmd,
    leadTimes,
    depositPct: quote.deposit_pct,
    company,
  });

  const buffer = await renderToBuffer(pdfDoc);
  return { ok: true, quoteRef: quote.quote_ref, buffer };
}
