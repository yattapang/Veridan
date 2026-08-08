import { describe, expect, it } from "vitest";
import { CREATE_NEW_OPTION_VALUE, isCreateNewOptionValue, mergeLocallyCreated } from "./creatableSelect";

describe("isCreateNewOptionValue", () => {
  it("recognizes the sentinel value", () => {
    expect(isCreateNewOptionValue(CREATE_NEW_OPTION_VALUE)).toBe(true);
  });

  it("rejects a real option value, including an empty string used for a real placeholder", () => {
    expect(isCreateNewOptionValue("")).toBe(false);
    expect(isCreateNewOptionValue("architect")).toBe(false);
    expect(isCreateNewOptionValue("11111111-1111-1111-1111-111111111111")).toBe(false);
  });
});

describe("mergeLocallyCreated", () => {
  const managed = [
    { id: "1", name: "architect" },
    { id: "2", name: "owner" },
  ];

  it("appends locally-created entries not present in the managed list", () => {
    const merged = mergeLocallyCreated(managed, [{ id: "3", name: "consultant" }]);
    expect(merged).toEqual([
      { id: "1", name: "architect" },
      { id: "2", name: "owner" },
      { id: "3", name: "consultant" },
    ]);
  });

  it("drops a locally-created entry once the managed list catches up with the same id", () => {
    const merged = mergeLocallyCreated(
      [...managed, { id: "3", name: "consultant" }],
      [{ id: "3", name: "consultant (stale copy)" }]
    );
    expect(merged).toEqual([
      { id: "1", name: "architect" },
      { id: "2", name: "owner" },
      { id: "3", name: "consultant" },
    ]);
  });

  it("returns the managed list unchanged when nothing was created locally", () => {
    expect(mergeLocallyCreated(managed, [])).toEqual(managed);
  });

  it("handles an empty managed list", () => {
    expect(mergeLocallyCreated([], [{ id: "1", name: "new" }])).toEqual([{ id: "1", name: "new" }]);
  });
});
