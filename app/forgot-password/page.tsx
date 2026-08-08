"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * Self-service password reset.
 *
 * NO ACCOUNT ENUMERATION: the same neutral confirmation is shown whether or not
 * the address belongs to a Veridan account, and Supabase's own error is only
 * surfaced when it is a transport/config failure rather than a "no such user"
 * signal. An unauthenticated visitor must not be able to use this page to
 * discover who works here.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSending(true);

    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/set-password`,
      });

      // Rate limiting and misconfiguration are worth telling the user about;
      // anything else is swallowed so the response cannot distinguish a real
      // address from an unknown one.
      if (resetError && /rate|limit|too many|redirect/i.test(resetError.message)) {
        setError(resetError.message);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset email.");
    } finally {
      setSending(false);
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
        <h1 className="mb-1 text-center text-xl font-semibold text-gray-900">Reset your password</h1>

        {sent ? (
          <div className="mt-6 space-y-3 text-sm text-gray-600">
            <p role="status">
              If that address belongs to a Veridan account, a reset link is on its way. It expires
              shortly, so use it soon.
            </p>
            <Link
              href="/login"
              className="block w-full rounded-md bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-gray-700"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-6 mt-1 text-center text-sm text-gray-500">
              We will email you a one-time link. You choose the new password yourself.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                disabled={sending}
                className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {sending ? "Sending…" : "Email me a reset link"}
              </button>
            </form>
            <p className="mt-4 text-center text-sm text-gray-500">
              <Link href="/login" className="underline underline-offset-2">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
