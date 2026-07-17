"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  type BusinessParameterRow,
  type HardwareSetLineItemWithDetails,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/supabase/types";
import { nextSetCode, resolveLineCost, toUsdIndicative, type SupplierFxRates } from "@/lib/hardware-sets";
import { getCurrentUser } from "@/lib/auth";
import { buildFxSnapshot, buildParametersSnapshot } from "@/lib/quotes/snapshot";
import {
  buildOriginGroups,
  nextQuoteRef,
  supplierOriginLabelMap,
  type SupplierOriginFields,
} from "@/lib/quotes/mapping";
import { recomputeQuote } from "@/lib/quotes/persist";

export type ProjectActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

function isProjectType(value: unknown): value is ProjectType {
  return typeof value === "string" && (PROJECT_TYPES as string[]).includes(value);
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as string[]).includes(value);
}

/** Updates the project header fields (Task 14). */
export async function updateProject(
  projectId: string,
  _prevState: ProjectActionResult,
  formData: FormData
): Promise<ProjectActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to update a project." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { ok: false, error: "Project name is required." };
  }

  const projectType = formData.get("project_type");
  if (!isProjectType(projectType)) {
    return { ok: false, error: "Choose a valid project type." };
  }

  const status = formData.get("status");
  if (!isProjectStatus(status)) {
    return { ok: false, error: "Choose a valid status." };
  }

  const siteAddress = String(formData.get("site_address") ?? "").trim();
  const architectCompanyId = String(formData.get("architect_company_id") ?? "").trim();

  const { error } = await supabase
    .from("projects")
    .update({
      name,
      project_type: projectType,
      status,
      site_address: siteAddress || null,
      architect_company_id: architectCompanyId || null,
    })
    .eq("id", projectId);

  if (error) {
    return { ok: false, error: `Could not save project: ${error.message}` };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin/projects");
  return { ok: true };
}

/**
 * Creates a new hardware set on this project. The suggested next code is
 * computed server-side (§lib/hardware-sets.nextSetCode) but re-verified
 * here against the current DB state, and re-checked again at insert time
 * via the `uq_hardware_sets_project_code` unique constraint — a race
 * between two tabs adding a set at once surfaces as a clear DB error
 * rather than silently colliding.
 */
export async function createHardwareSet(
  projectId: string,
  _prevState: ProjectActionResult,
  formData: FormData
): Promise<ProjectActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create a hardware set." };

  let code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();

  if (!code) {
    const { data: existing } = await supabase
      .from("hardware_sets")
      .select("code")
      .eq("project_id", projectId);
    code = nextSetCode((existing ?? []).map((r) => r.code as string));
  }

  const { error } = await supabase
    .from("hardware_sets")
    .insert({ project_id: projectId, code, name: name || null });

  if (error) {
    const friendly = error.message.includes("uq_hardware_sets_project_code")
      ? `A set with code "${code}" already exists on this project. Choose a different code.`
      : `Could not create the hardware set: ${error.message}`;
    return { ok: false, error: friendly };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}

/**
 * Clones a hardware set (and its line items) from another project into
 * this one (§6.1 "clonable from previous projects"). The new set gets an
 * auto-suggested code and `cloned_from_set_id` set for provenance. Runs
 * sequentially (set insert, then line-item inserts); if the line-item copy
 * fails partway, the new (possibly-partial) set still exists — surfaced
 * clearly so staff can inspect/fix it rather than silently losing lines.
 */
export async function cloneHardwareSet(
  projectId: string,
  _prevState: ProjectActionResult,
  formData: FormData
): Promise<ProjectActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to clone a hardware set." };

  const sourceSetId = String(formData.get("source_set_id") ?? "").trim();
  if (!sourceSetId) {
    return { ok: false, error: "Choose a hardware set to clone." };
  }

  const { data: sourceSet, error: sourceSetError } = await supabase
    .from("hardware_sets")
    .select("*")
    .eq("id", sourceSetId)
    .maybeSingle();

  if (sourceSetError || !sourceSet) {
    return { ok: false, error: `Could not load the source set: ${sourceSetError?.message ?? "not found"}.` };
  }

  const { data: sourceLines, error: sourceLinesError } = await supabase
    .from("hardware_set_line_items")
    .select("*")
    .eq("hardware_set_id", sourceSetId)
    .order("sort_order");

  if (sourceLinesError) {
    return { ok: false, error: `Could not load the source set's line items: ${sourceLinesError.message}.` };
  }

  const { data: existingCodes } = await supabase
    .from("hardware_sets")
    .select("code")
    .eq("project_id", projectId);
  const code = nextSetCode((existingCodes ?? []).map((r) => r.code as string));

  const { data: newSet, error: newSetError } = await supabase
    .from("hardware_sets")
    .insert({
      project_id: projectId,
      code,
      name: sourceSet.name,
      cloned_from_set_id: sourceSetId,
    })
    .select("id")
    .single();

  if (newSetError || !newSet) {
    return { ok: false, error: `Could not create the cloned set: ${newSetError?.message ?? "unknown error"}.` };
  }

  if (sourceLines && sourceLines.length > 0) {
    const newLines = sourceLines.map((line) => ({
      hardware_set_id: newSet.id,
      product_id: line.product_id,
      supplier_id: line.supplier_id,
      qty: line.qty,
      unit_cost_override: line.unit_cost_override,
      cost_currency_override: line.cost_currency_override,
      sort_order: line.sort_order,
      notes: line.notes,
    }));

    const { error: lineInsertError } = await supabase.from("hardware_set_line_items").insert(newLines);
    if (lineInsertError) {
      return {
        ok: false,
        error: `Set "${code}" was created, but copying its line items failed: ${lineInsertError.message}. Open the new set and add lines manually, or delete it and retry.`,
      };
    }
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}

/**
 * Creates a Door Register quote from a project (Task 16). This is the whole
 * materialization pipeline:
 *   1. Snapshot the LIVE business_parameters into the quote's
 *      parameters_snapshot + fx_snapshot — after this, the quote's numbers
 *      are frozen against later parameter edits (§1.7).
 *   2. Group the distinct suppliers used across the project's doors' hardware
 *      sets into default shipment-origin pools (quote_origins), one per
 *      supplier origin (region → country → "Other").
 *   3. Materialize one quote_line_items row per (door × set line), with the
 *      cost/currency snapshotted from the product/set-override and assigned to
 *      its supplier's origin pool.
 *   4. Run the landed-cost engine once to populate the computed caches.
 * Then redirect into the builder. The quote starts in 'draft'.
 *
 * Doors with no hardware set (and sets with no line items) contribute nothing
 * — they're simply skipped, so a partly-built register still yields a usable
 * draft. On any DB error the partial quote is left in place and the error is
 * surfaced rather than silently swallowed.
 */
// Signature note: bound via useActionState as (prevState, formData) — neither
// input is needed here, and TS allows the narrower parameter list, so the
// unused args are simply omitted.
export async function createDoorRegisterQuote(
  projectId: string
): Promise<ProjectActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to create a quote." };
  }

  // 1. Project + parameter snapshot.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) return { ok: false, error: `Could not load the project: ${projectError.message}` };
  if (!project) return { ok: false, error: "Project not found." };

  const { data: paramRows, error: paramError } = await supabase.from("business_parameters").select("*");
  if (paramError) return { ok: false, error: `Could not load business parameters: ${paramError.message}` };

  const parameters = (paramRows as BusinessParameterRow[]) ?? [];
  const quoteDate = new Date().toISOString().slice(0, 10);
  const parametersSnapshot = buildParametersSnapshot(parameters);
  const fxSnapshot = buildFxSnapshot(parameters, quoteDate);
  const fxRates = fxSnapshot.supplier_rates as SupplierFxRates;

  // 2. Doors with an assigned set, and the line items of the sets they use.
  const { data: doorRows, error: doorError } = await supabase
    .from("doors")
    .select("id, door_number, hardware_set_id, sort_order")
    .eq("project_id", projectId)
    .not("hardware_set_id", "is", null)
    .order("sort_order");
  if (doorError) return { ok: false, error: `Could not load the door register: ${doorError.message}` };

  const doors = (doorRows as Array<{ id: string; hardware_set_id: string | null; sort_order: number | null }>) ?? [];
  const setIds = [...new Set(doors.map((d) => d.hardware_set_id).filter((v): v is string => Boolean(v)))];

  let setLines: HardwareSetLineItemWithDetails[] = [];
  if (setIds.length > 0) {
    const { data: lineRows, error: lineError } = await supabase
      .from("hardware_set_line_items")
      .select(
        "*, products(id, description, manufacturer, product_ref, catalogue_ref, unit, unit_cost, cost_currency), suppliers(id, name, default_currency)"
      )
      .in("hardware_set_id", setIds)
      .order("sort_order");
    if (lineError) return { ok: false, error: `Could not load hardware set line items: ${lineError.message}` };
    setLines = (lineRows as unknown as HardwareSetLineItemWithDetails[]) ?? [];
  }
  const linesBySet = new Map<string, HardwareSetLineItemWithDetails[]>();
  for (const line of setLines) {
    const list = linesBySet.get(line.hardware_set_id) ?? [];
    list.push(line);
    linesBySet.set(line.hardware_set_id, list);
  }

  // 3. Distinct suppliers used → origin pools.
  const supplierIds = [...new Set(setLines.map((l) => l.supplier_id))];
  let suppliers: SupplierOriginFields[] = [];
  if (supplierIds.length > 0) {
    const { data: supplierRows, error: supplierError } = await supabase
      .from("suppliers")
      .select("id, origin_region, country")
      .in("id", supplierIds);
    if (supplierError) return { ok: false, error: `Could not load suppliers: ${supplierError.message}` };
    suppliers = (supplierRows as SupplierOriginFields[]) ?? [];
  }
  const originGroups = buildOriginGroups(suppliers);
  const supplierToLabel = supplierOriginLabelMap(originGroups);

  // 4. Generate the quote ref (VQ-YYYY-NNN) for the current year.
  const year = Number(quoteDate.slice(0, 4));
  const { data: existingRefRows, error: refError } = await supabase
    .from("quotes")
    .select("quote_ref")
    .like("quote_ref", `VQ-${year}-%`);
  if (refError) return { ok: false, error: `Could not generate a quote reference: ${refError.message}` };
  const quoteRef = nextQuoteRef(year, ((existingRefRows as Array<{ quote_ref: string }>) ?? []).map((r) => r.quote_ref));

  // 5. Insert the quote (draft).
  const marginTiers = parametersSnapshot.margin_tiers;
  const defaultMargin = marginTiers.length > 0 ? marginTiers[0] : 30;
  const { data: insertedQuote, error: quoteInsertError } = await supabase
    .from("quotes")
    .insert({
      project_id: projectId,
      quote_ref: quoteRef,
      status: "draft",
      quote_mode: "door_register",
      quote_date: quoteDate,
      validity_days: parametersSnapshot.quote_validity_days,
      deposit_pct: parametersSnapshot.deposit_standard_pct,
      margin_pct: defaultMargin,
      parameters_snapshot: parametersSnapshot,
      fx_snapshot: fxSnapshot,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (quoteInsertError || !insertedQuote) {
    return { ok: false, error: `Could not create the quote: ${quoteInsertError?.message ?? "unknown error"}` };
  }
  const quoteId = insertedQuote.id as string;

  // 6. Insert the origin pools and map label → id.
  const originIdByLabel = new Map<string, string>();
  if (originGroups.length > 0) {
    const { data: insertedOrigins, error: originInsertError } = await supabase
      .from("quote_origins")
      .insert(
        originGroups.map((g) => ({
          quote_id: quoteId,
          origin_label: g.label,
          freight_export_fees_usd: 0,
          ocean_freight_usd: null, // null → $1,250 freight+insurance fallback (§7.1 item 2)
          marine_insurance_usd: null, // null → engine computes 1.5% of CIF
          port_handling_usd: parametersSnapshot.port_handling_usd,
          brokerage_usd: null, // null → engine computes 120 + 50×(pallets−1)
          pallet_count: 1,
          duty_gct_pct: parametersSnapshot.duty_gct_pct,
        }))
      )
      .select("id, origin_label");
    if (originInsertError || !insertedOrigins) {
      return { ok: false, error: `Quote ${quoteRef} was created but its origin pools failed: ${originInsertError?.message ?? "unknown error"}.` };
    }
    for (const o of insertedOrigins as Array<{ id: string; origin_label: string }>) {
      originIdByLabel.set(o.origin_label, o.id);
    }
  }

  // 7. Materialize the quote line items (one per door × set line).
  const lineInserts: Record<string, unknown>[] = [];
  let sortOrder = 0;
  for (const door of doors) {
    const lines = door.hardware_set_id ? linesBySet.get(door.hardware_set_id) ?? [] : [];
    for (const line of lines) {
      const resolved = resolveLineCost(line);
      if (!resolved) continue; // product join missing — skip rather than insert a broken line
      const originLabel = supplierToLabel.get(line.supplier_id) ?? "Other";
      const originId = originIdByLabel.get(originLabel);
      if (!originId) continue; // no pool (shouldn't happen once suppliers are grouped)
      const unitCostUsd = toUsdIndicative(resolved.unitCost, resolved.currency, fxRates) ?? 0;
      const qty = Number(line.qty);
      const lineValueUsd = qty * unitCostUsd;
      lineInserts.push({
        quote_id: quoteId,
        door_id: door.id,
        hardware_set_id: door.hardware_set_id,
        product_id: line.product_id,
        quote_origin_id: originId,
        qty,
        unit_cost: resolved.unitCost,
        cost_currency: resolved.currency,
        unit_cost_usd: unitCostUsd,
        line_value_usd: lineValueUsd,
        landed_cost_usd: lineValueUsd, // placeholder; recompute overwrites with the allocated landed cost
        sort_order: sortOrder++,
      });
    }
  }

  if (lineInserts.length > 0) {
    const { error: lineInsertError } = await supabase.from("quote_line_items").insert(lineInserts);
    if (lineInsertError) {
      return { ok: false, error: `Quote ${quoteRef} was created but its line items failed: ${lineInsertError.message}.` };
    }
  }

  // 8. Run the engine once to populate computed caches + totals.
  const { error: computeError } = await recomputeQuote(supabase, quoteId);
  if (computeError) {
    // The quote exists and is editable; recompute can be retried from the
    // builder. Surface the issue rather than blocking navigation.
    return { ok: false, error: `Quote ${quoteRef} was created but the initial calculation failed: ${computeError}. Open it and re-save to recompute.` };
  }

  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/projects/${projectId}`);
  redirect(`/admin/quotes/${quoteId}`);
}

/**
 * Creates a line_item-mode quote (Task 17 — retrofit/simple jobs, §6.2) from
 * a project. Unlike the Door Register pipeline, there is no register to
 * materialize from: the quote is created empty (no origins, no lines) and the
 * founder adds product/ad-hoc lines directly on the builder page, which
 * regroups origin pools after every edit (lib/quotes/persist.ts
 * regroupLineItemOrigins). Same parameter/FX snapshot freeze as door_register
 * (§1.7) so the quote's numbers are immune to later parameter edits either
 * way.
 */
export async function createLineItemQuote(projectId: string): Promise<ProjectActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to create a quote." };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) return { ok: false, error: `Could not load the project: ${projectError.message}` };
  if (!project) return { ok: false, error: "Project not found." };

  const { data: paramRows, error: paramError } = await supabase.from("business_parameters").select("*");
  if (paramError) return { ok: false, error: `Could not load business parameters: ${paramError.message}` };

  const parameters = (paramRows as BusinessParameterRow[]) ?? [];
  const quoteDate = new Date().toISOString().slice(0, 10);
  const parametersSnapshot = buildParametersSnapshot(parameters);
  const fxSnapshot = buildFxSnapshot(parameters, quoteDate);

  const year = Number(quoteDate.slice(0, 4));
  const { data: existingRefRows, error: refError } = await supabase
    .from("quotes")
    .select("quote_ref")
    .like("quote_ref", `VQ-${year}-%`);
  if (refError) return { ok: false, error: `Could not generate a quote reference: ${refError.message}` };
  const quoteRef = nextQuoteRef(year, ((existingRefRows as Array<{ quote_ref: string }>) ?? []).map((r) => r.quote_ref));

  const marginTiers = parametersSnapshot.margin_tiers;
  const defaultMargin = marginTiers.length > 0 ? marginTiers[0] : 30;
  const { data: insertedQuote, error: quoteInsertError } = await supabase
    .from("quotes")
    .insert({
      project_id: projectId,
      quote_ref: quoteRef,
      status: "draft",
      quote_mode: "line_item",
      quote_date: quoteDate,
      validity_days: parametersSnapshot.quote_validity_days,
      deposit_pct: parametersSnapshot.deposit_standard_pct,
      margin_pct: defaultMargin,
      parameters_snapshot: parametersSnapshot,
      fx_snapshot: fxSnapshot,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (quoteInsertError || !insertedQuote) {
    return { ok: false, error: `Could not create the quote: ${quoteInsertError?.message ?? "unknown error"}` };
  }

  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/projects/${projectId}`);
  redirect(`/admin/quotes/${insertedQuote.id as string}`);
}
