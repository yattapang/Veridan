"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deriveDoorType } from "@/lib/doors";

export type DoorActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialDoorActionResult: DoorActionResult = { ok: true };

/**
 * Parses the shared floor / door number / location / hardware set fields
 * from a door form submission and derives door_type from the door number
 * (§7.1 item 5, lib/doors.ts). door_number is required; every other field
 * is optional.
 */
function parseDoorFields(
  formData: FormData
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const doorNumber = String(formData.get("door_number") ?? "").trim();
  if (!doorNumber) {
    return { ok: false, error: "Enter a door number." };
  }

  const floor = String(formData.get("floor") ?? "").trim();
  const locationDescription = String(formData.get("location_description") ?? "").trim();
  const hardwareSetId = String(formData.get("hardware_set_id") ?? "").trim();

  return {
    ok: true,
    fields: {
      floor: floor || null,
      door_number: doorNumber,
      door_type: deriveDoorType(doorNumber),
      location_description: locationDescription || null,
      hardware_set_id: hardwareSetId || null,
    },
  };
}

/**
 * Adds a door to the register. Sort order is appended to the end so newly
 * added doors show up at the bottom of the grid, matching the entry order.
 */
export async function createDoor(
  projectId: string,
  _prevState: DoorActionResult,
  formData: FormData
): Promise<DoorActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const parsed = parseDoorFields(formData);
  if (!parsed.ok) return parsed;

  const { count } = await supabase
    .from("doors")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { error } = await supabase.from("doors").insert({
    ...parsed.fields,
    project_id: projectId,
    sort_order: count ?? 0,
  });

  if (error) {
    return { ok: false, error: `Could not add the door: ${error.message}` };
  }

  revalidatePath(`/admin/projects/${projectId}/doors`);
  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}

export async function updateDoor(
  projectId: string,
  doorId: string,
  _prevState: DoorActionResult,
  formData: FormData
): Promise<DoorActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const parsed = parseDoorFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("doors").update(parsed.fields).eq("id", doorId);
  if (error) {
    return { ok: false, error: `Could not save the door: ${error.message}` };
  }

  revalidatePath(`/admin/projects/${projectId}/doors`);
  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}

/**
 * Duplicates a door: copies floor, door_type, and hardware_set_id (§4
 * Task 15 brief) so a run of similar doors is fast to enter, but leaves
 * door_number and location_description blank — nothing is auto-incremented,
 * the user always types the new door's own number. The new row lands at
 * the end of the register, ready for inline editing.
 */
export async function duplicateDoor(projectId: string, doorId: string): Promise<DoorActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const { data: source, error: sourceError } = await supabase
    .from("doors")
    .select("*")
    .eq("id", doorId)
    .maybeSingle();

  if (sourceError || !source) {
    return { ok: false, error: `Could not load the door to duplicate: ${sourceError?.message ?? "not found"}.` };
  }

  const { count } = await supabase
    .from("doors")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { error } = await supabase.from("doors").insert({
    project_id: projectId,
    floor: source.floor,
    door_number: "",
    door_type: source.door_type,
    location_description: null,
    hardware_set_id: source.hardware_set_id,
    sort_order: count ?? 0,
  });

  if (error) {
    return { ok: false, error: `Could not duplicate the door: ${error.message}` };
  }

  revalidatePath(`/admin/projects/${projectId}/doors`);
  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}

/**
 * Doors have no historical-quote significance of their own until pulled
 * into a quote (quote_line_items references door_id with ON DELETE SET
 * NULL, per the schema), so a hard delete is safe here — mirroring the
 * hardware-set-line-item delete pattern.
 */
export async function deleteDoor(projectId: string, doorId: string): Promise<DoorActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const { error } = await supabase.from("doors").delete().eq("id", doorId);
  if (error) {
    return { ok: false, error: `Could not remove the door: ${error.message}` };
  }

  revalidatePath(`/admin/projects/${projectId}/doors`);
  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}
