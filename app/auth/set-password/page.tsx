"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { syncUserRecord } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/roles/password";

type Phase = "checking" | "ready" | "no-session" | "saved";

/**
 * Where an invited colleague, or anyone following a reset link, chooses their
 * OWN password. This is the only place in the app where a password is set for a
 * Veridan account, and it always runs in the account holder's own browser: the
 * founder never sees, types, or relays it.
 *
 * The recovery session can arrive three ways, and all three are handled because
 * which one you get depends on the project's email templates:
 *   1. Cookies already set by /auth/confirm (the token_hash → verifyOtp route).
 *   2. `#access_token` / `#refresh_token` in the URL fragment — what Supabase's
 *      DEFAULT invite/recovery templates produce via {{ .ConfirmationURL }}.
 *   3. `?code=` — the PKCE style, when the link is opened in the same browser
 *      that started the flow.
 */
function SetPasswordForm() {
  const searchParams = useSearchParams();
  const linkError = searchParams.get("error");

  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function establishSession() {
      let supabase;
      try {
        supabase = createClient();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Supabase is not configured.");
          setPhase("no-session");
        }
        return;
      }

      // (2) Implicit-flow tokens in the fragment.
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      if (hash.includes("access_token")) {
        const params = new URLSearchParams(hash.replace(/^#/, ""));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          // Strip the tokens out of the address bar either way.
          window.history.replaceState(null, "", window.location.pathname);
          if (!sessionError && !cancelled) {
            setPhase("ready");
            return;
          }
        }
      }

      // (3) PKCE code, when the same browser started the flow.
      const code = searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!exchangeError && !cancelled) {
          setPhase("ready");
          return;
        }
      }

      // (1) Cookies already set by /auth/confirm.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setPhase(user ? "ready" : "no-session");
    }

    void establishSession();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

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
      // Keep the public.users row current. It NEVER writes role or active, so
      // the role the founder chose at invite time survives untouched.
      const { error: syncError } = await syncUserRecord();
      if (syncError) {
        console.error("[veridan:set-password] User record sync failed:", syncError);
      }
      setPhase("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <Image
          src="/brand/logo-mark-ink.png"
          alt="Veridan Limited"
          width={29}
          height={32}
          className="mx-auto mb-4"
          style={{ height: 32, width: "auto" }}
        />
        <h1 className="mb-1 text-center text-xl font-semibold text-gray-900">
          Choose your password
        </h1>

        {phase === "checking" && (
          <p className="mt-6 text-center text-sm text-gray-500">Checking your link…</p>
        )}

        {phase === "no-session" && (
          <div className="mt-6 space-y-3 text-sm text-gray-600">
            <p role="alert" className="text-red-600">
              {linkError
                ? `This link could not be used (${linkError}).`
                : "This link has expired or has already been used."}
            </p>
            <p>
              Ask for a new one from the sign-in page — use{" "}
              <Link href="/forgot-password" className="underline underline-offset-2">
                Forgot password?
              </Link>{" "}
              — or ask a founder to send you a fresh invite.
            </p>
          </div>
        )}

        {phase === "saved" && (
          <div className="mt-6 space-y-3 text-sm text-gray-600">
            <p role="status" className="text-green-700">
              Password set. You are signed in.
            </p>
            <a
              href="/admin"
              className="block w-full rounded-md bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-gray-700"
            >
              Go to the admin
            </a>
          </div>
        )}

        {phase === "ready" && (
          <>
            <p className="mb-6 mt-1 text-center text-sm text-gray-500">
              Pick something only you know. Nobody at Veridan can see it.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="confirmation"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  New password again
                </label>
                <input
                  id="confirmation"
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Set password"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense>
      <SetPasswordForm />
    </Suspense>
  );
}
