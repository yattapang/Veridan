"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/roles/password";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass =
  "block text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Change YOUR OWN password.
 *
 * Uses the ordinary authenticated browser client — `auth.updateUser({ password })`
 * acts on the caller's own session and nothing else. Deliberately NOT a server
 * action: the new password never travels to this app's server, never appears in
 * a server log, and the service-role client is nowhere near it.
 */
export function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(false);

    const validated = validateNewPassword(password, confirmation);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setPassword("");
      setConfirmation("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:max-w-sm">
      <div>
        <label className={labelClass} htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="confirm-password">
          New password again
        </label>
        <input
          id="confirm-password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-xs text-green-700">
          Password changed. Use it next time you sign in.
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Change password"}
        </button>
      </div>
    </form>
  );
}
