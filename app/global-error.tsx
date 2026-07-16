"use client";

import { useEffect } from "react";

/**
 * Root backstop error boundary (Task 26). Only catches errors that
 * escape every nested error.tsx — e.g. a crash in the root layout itself.
 * Per the App Router contract this file must render its own <html>/<body>
 * since it replaces the root layout entirely when active. Kept
 * dependency-free (no shared components, no Tailwind-only classes that
 * assume globals.css loaded) since the very thing that crashed might be
 * upstream of those.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[veridan:global-error]", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          backgroundColor: "#faf8f5",
          color: "#1c1a17",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#7a7469",
            margin: 0,
          }}
        >
          Veridan
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 12 }}>
          Something went wrong
        </h1>
        <p style={{ maxWidth: 420, fontSize: 14, color: "#7a7469", marginTop: 8 }}>
          The application hit an unexpected error. Please try again.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 24,
            borderRadius: 6,
            backgroundColor: "#1c1a17",
            color: "#faf8f5",
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
