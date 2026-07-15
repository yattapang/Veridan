"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_STATUSES, PROJECT_TYPES, type ProjectStatus, type ProjectType } from "@/lib/supabase/types";
import { nextSetCode } from "@/lib/hardware-sets";

export type ProjectActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialProjectActionResult: ProjectActionResult = { ok: true };

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
