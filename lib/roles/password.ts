/**
 * Password-form validation. Pure and unit-tested (password.test.ts) — the rules
 * are shared by /auth/set-password (invite + reset) and /admin/account (change
 * your own), so they cannot drift apart.
 *
 * These are the client-side courtesies only. Supabase Auth applies the project's
 * real password policy server-side and its error is surfaced verbatim; this just
 * catches the obvious cases before a round trip.
 */

/** Supabase's own default minimum is 6; 10 is the floor this admin asks for. */
export const MIN_PASSWORD_LENGTH = 10;

export type PasswordCheck = { ok: true } | { ok: false; error: string };

export function validateNewPassword(password: string, confirmation: string): PasswordCheck {
  if (!password) {
    return { ok: false, error: "Enter a new password." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Use at least ${MIN_PASSWORD_LENGTH} characters — a short phrase you will remember beats a short scramble you will not.`,
    };
  }
  if (password.trim().length === 0) {
    return { ok: false, error: "A password of only spaces will not do." };
  }
  if (password !== confirmation) {
    return { ok: false, error: "The two passwords do not match." };
  }
  return { ok: true };
}
