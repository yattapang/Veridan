"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { syncUserRecord } from "@/lib/auth";

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      // Sync the public.users row (Task 5: "users table sync on first
      // login"). Non-fatal if it fails — don't block sign-in over it.
      const { error: syncError } = await syncUserRecord();
      if (syncError) {
        console.error("[veridan:login] User record sync failed:", syncError);
      }
      // Full-page navigation, NOT router.push: the client router cache may
      // hold the pre-auth "/admin → /login" redirect payload, which makes a
      // successful sign-in appear to do nothing. A hard navigation forces a
      // fresh server round-trip with the new auth cookies.
      // Only allow same-origin relative paths (no "//host" or absolute URLs).
      const redirectParam = searchParams.get("redirect");
      const target =
        redirectParam?.startsWith("/") && !redirectParam.startsWith("//")
          ? redirectParam
          : "/admin";
      window.location.assign(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setLoading(false);
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
          Veridan Admin
        </h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          Sign in to continue
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
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
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            disabled={loading}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
