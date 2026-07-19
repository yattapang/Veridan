import { describe, expect, it } from "vitest";
import { canTransitionOrder, isBeforeCustomsCleared, isOrderClosed, reachableOrderStatuses } from "./workflow";

describe("canTransitionOrder", () => {
  it("allows the next sequential status", () => {
    expect(canTransitionOrder("confirmed", "in_procurement").ok).toBe(true);
    expect(canTransitionOrder("in_procurement", "shipped").ok).toBe(true);
    expect(canTransitionOrder("shipped", "customs_cleared").ok).toBe(true);
    expect(canTransitionOrder("customs_cleared", "delivered").ok).toBe(true);
    expect(canTransitionOrder("delivered", "closed").ok).toBe(true);
  });

  it("allows skipping intermediate statuses forward", () => {
    expect(canTransitionOrder("confirmed", "delivered").ok).toBe(true);
    expect(canTransitionOrder("confirmed", "shipped").ok).toBe(true);
    expect(canTransitionOrder("in_procurement", "customs_cleared").ok).toBe(true);
  });

  it("rejects any backward transition", () => {
    expect(canTransitionOrder("shipped", "confirmed").ok).toBe(false);
    expect(canTransitionOrder("delivered", "shipped").ok).toBe(false);
    expect(canTransitionOrder("closed", "delivered").ok).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionOrder("shipped", "shipped").ok).toBe(false);
  });

  it("requires 'delivered' before 'closed' — cannot skip straight to closed", () => {
    const result = canTransitionOrder("shipped", "closed");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/delivered/i);

    expect(canTransitionOrder("confirmed", "closed").ok).toBe(false);
    expect(canTransitionOrder("customs_cleared", "closed").ok).toBe(false);
  });
});

describe("reachableOrderStatuses", () => {
  it("lists every forward status, with 'closed' only reachable from delivered", () => {
    expect(reachableOrderStatuses("confirmed")).toEqual([
      "in_procurement",
      "shipped",
      "customs_cleared",
      "delivered",
    ]);
    expect(reachableOrderStatuses("delivered")).toEqual(["closed"]);
    expect(reachableOrderStatuses("closed")).toEqual([]);
  });
});

describe("isOrderClosed", () => {
  it("is true only for 'closed'", () => {
    expect(isOrderClosed("closed")).toBe(true);
    expect(isOrderClosed("delivered")).toBe(false);
    expect(isOrderClosed("confirmed")).toBe(false);
  });
});

describe("isBeforeCustomsCleared", () => {
  it("is true for every status strictly before customs_cleared", () => {
    expect(isBeforeCustomsCleared("confirmed")).toBe(true);
    expect(isBeforeCustomsCleared("in_procurement")).toBe(true);
    expect(isBeforeCustomsCleared("shipped")).toBe(true);
  });

  it("is false at or past customs_cleared", () => {
    expect(isBeforeCustomsCleared("customs_cleared")).toBe(false);
    expect(isBeforeCustomsCleared("delivered")).toBe(false);
    expect(isBeforeCustomsCleared("closed")).toBe(false);
  });
});
