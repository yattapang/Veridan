import type { CurrencyCode, HardwareSetLineItemWithDetails } from "@/lib/supabase/types";

/**
 * Pure helpers for the Hardware Set builder (Task 14). Kept dependency-free
 * (no Supabase client) so they're unit-testable in isolation, mirroring the
 * lib/landed-cost/engine.ts pattern from Task 9.
 */

/**
 * Suggests the next set code ("HW01", "HW02", ...) given the codes already
 * used on a project. Only codes matching the `HW<digits>` pattern count
 * toward the suggestion; anything else is ignored so a manually-entered
 * odd code never breaks the counter. Always returns a 2+ digit, zero-padded
 * code (matches the workbook convention referenced in the build plan §6.1).
 */
export function nextSetCode(existingCodes: string[]): string {
  let max = 0;
  for (const code of existingCodes) {
    const match = /^HW(\d+)$/i.exec(code.trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  return `HW${String(next).padStart(2, "0")}`;
}

/** USD-per-native-currency-unit rate table shape (§7.1 item 9 convention). */
export type SupplierFxRates = Partial<Record<CurrencyCode, number>>;

/**
 * Resolves the effective unit cost + currency for a line item: the
 * per-line override if present (§1.4 "per-quote overrides allowed"),
 * otherwise the product library's own cost. Both fields must be set
 * together for an override to apply (a currency override with no cost
 * override, or vice versa, falls back to the library value — an
 * inconsistent partial override is treated as "no override" rather than
 * silently mixing an old cost with a new currency).
 */
export function resolveLineCost(
  line: HardwareSetLineItemWithDetails
): { unitCost: number; currency: CurrencyCode; isOverride: boolean } | null {
  if (line.unit_cost_override != null && line.cost_currency_override != null) {
    return { unitCost: line.unit_cost_override, currency: line.cost_currency_override, isOverride: true };
  }
  if (!line.products) return null;
  return { unitCost: line.products.unit_cost, currency: line.products.cost_currency, isOverride: false };
}

/**
 * Converts a native-currency amount to USD using the supplier_fx_rates
 * parameter table (USD per 1 unit of native currency — multiply). Falls
 * back to 1:1 for USD itself and returns null if a rate is genuinely
 * missing for a non-USD currency (caller decides how to surface that
 * rather than silently mis-costing).
 */
export function toUsdIndicative(amount: number, currency: CurrencyCode, rates: SupplierFxRates): number | null {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  if (rate == null) return null;
  return amount * rate;
}

export interface HardwareSetUsdSummary {
  lineCount: number;
  subtotalUsd: number;
  /** true if one or more lines could not be converted (missing fx rate or missing product join). */
  incomplete: boolean;
}

/**
 * Indicative USD subtotal for a hardware set — display only, per the build
 * brief ("real landed cost comes from the quote engine later"). Sums
 * qty x resolved-unit-cost, converted to USD via the supplier FX table.
 */
export function summarizeSetUsd(
  lines: HardwareSetLineItemWithDetails[],
  rates: SupplierFxRates
): HardwareSetUsdSummary {
  let subtotalUsd = 0;
  let incomplete = false;

  for (const line of lines) {
    const resolved = resolveLineCost(line);
    if (!resolved) {
      incomplete = true;
      continue;
    }
    const usd = toUsdIndicative(resolved.unitCost, resolved.currency, rates);
    if (usd == null) {
      incomplete = true;
      continue;
    }
    subtotalUsd += usd * Number(line.qty);
  }

  return { lineCount: lines.length, subtotalUsd, incomplete };
}
