/**
 * Pure helpers for the Door Register (Task 15). Kept dependency-free (no
 * Supabase client) so they're unit-testable in isolation, mirroring the
 * lib/hardware-sets.ts and lib/landed-cost/engine.ts patterns.
 */

/**
 * Door-type derivation rule (§7.1 item 5, PRD §6.1 — RESOLVED but flagged as
 * an assumption to verify against the real workbook data in Task 25's
 * parity test): door type is the run of alphabetic characters immediately
 * following the leading "D" in the door number.
 *   "DE01" -> "E"   "DB04" -> "B"   "DD02" -> "D"   "D05" -> none
 *
 * Exported so the exact pattern can be tuned in one place (Task 25) without
 * touching the calling code. Matched case-insensitively against the
 * uppercased door number; the captured group preserves uppercase.
 */
export const DOOR_TYPE_PATTERN = /^D([A-Z]+)/;

/**
 * Derives the door type from a door number per DOOR_TYPE_PATTERN. Returns
 * null when the door number doesn't start with "D", or when "D" isn't
 * immediately followed by at least one letter (e.g. "D05", junk input, or
 * an empty string).
 */
export function deriveDoorType(doorNumber: string): string | null {
  const normalized = doorNumber.trim().toUpperCase();
  if (!normalized) return null;
  const match = DOOR_TYPE_PATTERN.exec(normalized);
  return match ? match[1] : null;
}

/**
 * Groups a project's doors by assigned hardware set for the Door Register
 * summary ("HW01 x 9 doors") and flags doors with no set assigned. Takes
 * only the fields it needs so it works directly against DoorRow or any
 * shape that has a hardware_set_id.
 */
export interface DoorHardwareSetCounts {
  /** hardware_set_id -> number of doors assigned to it. */
  counts: Map<string, number>;
  /** Doors with no hardware_set_id at all. */
  unassigned: number;
}

export function countDoorsByHardwareSet(
  doors: Array<{ hardware_set_id: string | null }>
): DoorHardwareSetCounts {
  const counts = new Map<string, number>();
  let unassigned = 0;

  for (const door of doors) {
    if (!door.hardware_set_id) {
      unassigned += 1;
      continue;
    }
    counts.set(door.hardware_set_id, (counts.get(door.hardware_set_id) ?? 0) + 1);
  }

  return { counts, unassigned };
}
