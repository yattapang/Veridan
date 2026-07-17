"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { GRADE_VALUES, type GradeValue, type ItemGroupRow } from "@/lib/supabase/types";
import { validateMergeSelection } from "@/lib/item-groups";

export type ItemGroupFormResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

function isGradeValueOrEmpty(value: unknown): value is GradeValue | "" {
  return value === "" || (typeof value === "string" && (GRADE_VALUES as string[]).includes(value));
}

function parseItemGroupFields(
  formData: FormData
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const familyName = String(formData.get("family_name") ?? "").trim();
  if (!familyName) {
    return { ok: false, error: "Family name is required." };
  }

  const grade = formData.get("grade");
  if (!isGradeValueOrEmpty(grade)) {
    return { ok: false, error: "Choose a valid ANSI/BHMA grade, or leave blank." };
  }

  const notes = String(formData.get("notes") ?? "").trim();

  return {
    ok: true,
    fields: {
      family_name: familyName,
      grade: grade || null,
      notes: notes || null,
    },
  };
}

export async function createItemGroup(
  _prevState: ItemGroupFormResult,
  formData: FormData
): Promise<ItemGroupFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create an item group." };

  const parsed = parseItemGroupFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("item_groups").insert(parsed.fields);
  if (error) {
    return { ok: false, error: `Could not create item group: ${error.message}` };
  }

  revalidatePath("/admin/item-groups");
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function updateItemGroup(
  id: string,
  _prevState: ItemGroupFormResult,
  formData: FormData
): Promise<ItemGroupFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to update an item group." };

  const parsed = parseItemGroupFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("item_groups").update(parsed.fields).eq("id", id);
  if (error) {
    return { ok: false, error: `Could not save item group: ${error.message}` };
  }

  revalidatePath("/admin/item-groups");
  revalidatePath("/admin/products");
  return { ok: true };
}

/**
 * Hard delete. Products referencing this group have `item_group_id
 * references item_groups(id) on delete set null` (§1.4), so deleting a
 * group in use never corrupts a product row — it just ungroups it. This is
 * the "set null, not a hard failure" branch of the Phase2A UAT script §6.1
 * item 6 (the alternative — blocking delete outright — was rejected as
 * more friction for no real safety benefit at this data volume).
 */
export async function deleteItemGroup(id: string): Promise<ItemGroupFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to delete an item group." };

  const { error } = await supabase.from("item_groups").delete().eq("id", id);
  if (error) {
    return { ok: false, error: `Could not delete item group: ${error.message}` };
  }

  revalidatePath("/admin/item-groups");
  revalidatePath("/admin/products");
  return { ok: true };
}

/**
 * Merges one item group ("losing") into another ("surviving"): re-points
 * every product currently in the losing group, records an audit row in
 * item_group_merges (snapshotting the losing group's name/grade since that
 * row is deleted next), then deletes the losing group. Task 30 / plan §1.5.
 */
export async function mergeItemGroups(
  survivingGroupId: string,
  losingGroupId: string,
  reason: string
): Promise<ItemGroupFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to merge item groups." };

  const validation = validateMergeSelection(survivingGroupId, losingGroupId);
  if (!validation.ok) return { ok: false, error: validation.error };

  const { data: losingGroup, error: losingGroupError } = await supabase
    .from("item_groups")
    .select("*")
    .eq("id", losingGroupId)
    .maybeSingle<ItemGroupRow>();
  if (losingGroupError) {
    return { ok: false, error: `Could not load the group being merged: ${losingGroupError.message}` };
  }
  if (!losingGroup) {
    return { ok: false, error: "The group being merged no longer exists." };
  }

  const { data: repointed, error: repointError } = await supabase
    .from("products")
    .update({ item_group_id: survivingGroupId })
    .eq("item_group_id", losingGroupId)
    .select("id");
  if (repointError) {
    return { ok: false, error: `Could not move products: ${repointError.message}` };
  }
  const productCount = repointed?.length ?? 0;

  const { error: auditError } = await supabase.from("item_group_merges").insert({
    surviving_group_id: survivingGroupId,
    losing_group_family_name: losingGroup.family_name,
    losing_group_grade: losingGroup.grade,
    product_count: productCount,
    reason: reason.trim() || null,
    merged_by: user.id,
  });
  if (auditError) {
    return { ok: false, error: `Products were moved but the merge audit log failed: ${auditError.message}` };
  }

  const { error: deleteError } = await supabase.from("item_groups").delete().eq("id", losingGroupId);
  if (deleteError) {
    return {
      ok: false,
      error: `Products were moved and logged, but the empty group could not be removed: ${deleteError.message}`,
    };
  }

  revalidatePath("/admin/item-groups");
  revalidatePath("/admin/products");
  return { ok: true };
}
