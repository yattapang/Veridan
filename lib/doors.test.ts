import { describe, expect, it } from "vitest";
import { countDoorsByHardwareSet, deriveDoorType } from "./doors";

describe("deriveDoorType", () => {
  it("derives the alphabetic code following the leading D", () => {
    expect(deriveDoorType("DE01")).toBe("E");
  });

  it("handles a different letter code", () => {
    expect(deriveDoorType("DB04")).toBe("B");
  });

  it("returns null when D is immediately followed by a digit", () => {
    expect(deriveDoorType("D05")).toBeNull();
  });

  it("captures a repeated D as its own code", () => {
    expect(deriveDoorType("DD02")).toBe("D");
  });

  it("is case-insensitive on input, uppercase on output", () => {
    expect(deriveDoorType("de01")).toBe("E");
  });

  it("returns null for junk input with no leading D", () => {
    expect(deriveDoorType("XYZ123")).toBeNull();
  });

  it("returns null for an empty or whitespace-only string", () => {
    expect(deriveDoorType("")).toBeNull();
    expect(deriveDoorType("   ")).toBeNull();
  });

  it("returns null when D has nothing after it", () => {
    expect(deriveDoorType("D")).toBeNull();
  });

  it("trims surrounding whitespace before matching", () => {
    expect(deriveDoorType("  DE01  ")).toBe("E");
  });
});

describe("countDoorsByHardwareSet", () => {
  it("counts doors per hardware set and flags unassigned doors", () => {
    const doors = [
      { hardware_set_id: "set-1" },
      { hardware_set_id: "set-1" },
      { hardware_set_id: "set-2" },
      { hardware_set_id: null },
    ];
    const result = countDoorsByHardwareSet(doors);
    expect(result.counts.get("set-1")).toBe(2);
    expect(result.counts.get("set-2")).toBe(1);
    expect(result.unassigned).toBe(1);
  });

  it("returns an empty map and zero unassigned for no doors", () => {
    const result = countDoorsByHardwareSet([]);
    expect(result.counts.size).toBe(0);
    expect(result.unassigned).toBe(0);
  });
});
