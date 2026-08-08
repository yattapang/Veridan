import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "./password";

const GOOD = "correct horse battery";

describe("validateNewPassword", () => {
  it("accepts a long enough matching pair", () => {
    expect(validateNewPassword(GOOD, GOOD)).toEqual({ ok: true });
  });

  it("rejects an empty password", () => {
    const result = validateNewPassword("", "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/enter a new password/i);
  });

  it("rejects anything shorter than the minimum", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const result = validateNewPassword(short, short);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(new RegExp(String(MIN_PASSWORD_LENGTH)));
  });

  it("accepts exactly the minimum length", () => {
    const exact = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(validateNewPassword(exact, exact)).toEqual({ ok: true });
  });

  it("rejects a whitespace-only password", () => {
    const spaces = " ".repeat(MIN_PASSWORD_LENGTH + 2);
    const result = validateNewPassword(spaces, spaces);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/only spaces/i);
  });

  it("rejects a mismatched confirmation", () => {
    const result = validateNewPassword(GOOD, `${GOOD}!`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/do not match/i);
  });

  it("is case- and whitespace-sensitive when matching", () => {
    expect(validateNewPassword(GOOD, GOOD.toUpperCase()).ok).toBe(false);
    expect(validateNewPassword(GOOD, ` ${GOOD}`).ok).toBe(false);
  });
});
