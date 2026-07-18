/**
 * Quote line-item -> PDF row grouping — PURE, no I/O (extracted from
 * lib/quotes/pdf.ts during the Phase 2C independent-review fix, MAJOR-2:
 * invoices need to show the SAME itemized breakdown as the quote PDF, "no
 * re-keying" per spec §3, so this is the one place that turns a quote's
 * computeQuoteResult() output + its quote_line_items (with product/door/
 * hardware-set joins) into the door_register HW-group rows or line_item flat
 * rows either document renders. lib/quotes/pdf.ts (the quote PDF) and
 * lib/invoices/pdf.ts (the invoice PDF's itemized section) both call this,
 * so there is exactly one grouping algorithm for both documents — the quote
 * PDF's output is unchanged by this extraction (byte-identical), only moved.
 */

import type { DoorRollup, LineResult } from "@/lib/landed-cost/types";
import type { QuoteLineItemWithDetails } from "@/lib/supabase/types";
import type { QuotePdfDoorGroupRow, QuotePdfFlatLineRow } from "./QuotePdf";

export interface QuoteItemization {
  doorGroups: QuotePdfDoorGroupRow[];
  flatLines: QuotePdfFlatLineRow[];
  /** Sum of the already-rounded per-line/per-door components (Build Plan §3.3) — never a re-derivation from unrounded totals. */
  grandTotalJmd: number;
}

/**
 * Groups a quote's lines (+ engine result) into the door_register HW-group
 * rows or line_item flat rows a PDF renders, mirroring the exact logic that
 * used to live inline in lib/quotes/pdf.ts's renderQuotePdf.
 */
export function buildQuoteItemization(params: {
  isDoorMode: boolean;
  lines: QuoteLineItemWithDetails[];
  resultLines: LineResult[];
  resultDoors: DoorRollup[];
}): QuoteItemization {
  const { isDoorMode, lines, resultLines, resultDoors } = params;

  const lineResultById = new Map(resultLines.map((l) => [l.lineId, l]));
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

    const rollupsBySet = new Map<string, DoorRollup[]>();
    for (const d of resultDoors) {
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

  return { doorGroups, flatLines, grandTotalJmd };
}
