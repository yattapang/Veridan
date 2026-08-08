import "server-only";

/**
 * How a quote gets its pricing inputs (security review 2026-08-08, BLOCKER-3).
 *
 * THE PROBLEM. `business_parameters` and `suppliers` are founder-only from
 * 20260807000004_user_roles.sql. Staff nonetheless create quotes — that is the
 * founder's explicit intent — and quote creation must read both:
 *
 *   * business_parameters → frozen into quotes.parameters_snapshot / fx_snapshot
 *     at creation (§1.7), which is what the quote is priced from forever.
 *   * suppliers.origin_region / country → groups the quote's suppliers into
 *     shipment-origin cost pools.
 *
 * Under RLS a denied SELECT does not fail. It returns ZERO ROWS with
 * `error === null`. So the previous code — `const {data, error} = await
 * supabase.from("business_parameters").select("*"); if (error) return …` — did
 * exactly the wrong thing for a staff session: the guard passed, `data` was
 * `[]`, and the snapshot builders substituted seed defaults which were then
 * frozen into the quote permanently. Same shape of bug for suppliers: no
 * supplier rows meant no origin pools, which meant every line was skipped and
 * the quote was created EMPTY. Neither produced an error on screen.
 *
 * THE FIX, both halves:
 *   (a) these helpers, which go through the `security definer` functions added
 *       in that migration's §7 so the read returns the real rows for founder and
 *       staff alike, while direct table access stays founder-only; and
 *   (b) independently, lib/quotes/snapshot.ts now THROWS on a short parameter
 *       set, so even if a future call site forgets to come through here the
 *       failure is loud instead of silent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessParameterRow } from "@/lib/supabase/types";
import type { SupplierOriginFields } from "@/lib/quotes/mapping";

type Client = SupabaseClient;

/**
 * The parameter rows a quote snapshot freezes, read through
 * `public.snapshot_business_parameters()`.
 *
 * An empty result is reported as an ERROR here rather than returned as an empty
 * array, so a caller that only checks `error` cannot fall through to the
 * defaults. (snapshot.ts throws on the same condition — this is the polite
 * version of the same refusal, phrased for the founder reading the screen.)
 */
export async function loadSnapshotParameters(
  supabase: Client,
): Promise<{ parameters: BusinessParameterRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc("snapshot_business_parameters");

  if (error) {
    return { parameters: [], error: `Could not load business parameters: ${error.message}` };
  }

  const parameters = (data as BusinessParameterRow[] | null) ?? [];
  if (parameters.length === 0) {
    return {
      parameters: [],
      error:
        "Could not load business parameters: the pricing parameters came back empty. " +
        "A quote cannot be priced from nothing, so nothing was created. Check that " +
        "supabase/migrations/20260713000003_seed_parameters.sql and 20260807000004_user_roles.sql " +
        "have both been applied, then try again.",
    };
  }

  return { parameters, error: null };
}

/**
 * Origin-grouping fields for the given suppliers, read through
 * `public.quote_origin_suppliers()`. Returns the shape `buildOriginGroups`
 * expects, so the call sites keep their existing logic.
 *
 * An empty `supplierIds` legitimately yields an empty list (a quote with no
 * supplier-bearing lines); a NON-empty request that comes back with nothing is
 * an error, because that is the RLS-denied shape that used to produce a quote
 * with zero line items.
 */
export async function loadQuoteOriginSuppliers(
  supabase: Client,
  supplierIds: string[],
): Promise<{ suppliers: SupplierOriginFields[]; error: string | null }> {
  if (supplierIds.length === 0) return { suppliers: [], error: null };

  const { data, error } = await supabase.rpc("quote_origin_suppliers", {
    p_supplier_ids: supplierIds,
  });

  if (error) {
    return { suppliers: [], error: `Could not load suppliers: ${error.message}` };
  }

  const rows =
    (data as Array<{
      supplier_id: string;
      supplier_origin_region: string | null;
      supplier_country: string | null;
    }> | null) ?? [];

  if (rows.length === 0) {
    return {
      suppliers: [],
      error:
        "Could not load suppliers: none of this quote's suppliers could be read, so its " +
        "shipment origin pools could not be built and no line items would have been created. " +
        "Check that supabase/migrations/20260807000004_user_roles.sql has been applied, then try again.",
    };
  }

  return {
    suppliers: rows.map((row) => ({
      id: row.supplier_id,
      origin_region: row.supplier_origin_region,
      country: row.supplier_country,
    })),
    error: null,
  };
}
