import { contactInfo } from "@/lib/site-content";

/**
 * Graceful-degradation fallback for the portal forms when Supabase env vars
 * are missing at runtime (Task 8 brief: "show a friendly form temporarily
 * unavailable message instead of crashing"). Rendered instead of the form.
 */
export function UnavailableNotice() {
  return (
    <div className="max-w-xl rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale px-6 py-5">
      <p className="text-sm font-medium text-veridan-ink">
        This form is temporarily unavailable.
      </p>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Please email us directly at{" "}
        <a
          href={`mailto:${contactInfo.email}`}
          className="font-medium text-veridan-ink underline underline-offset-2"
        >
          {contactInfo.email}
        </a>{" "}
        and we&rsquo;ll get your request started right away.
      </p>
    </div>
  );
}
