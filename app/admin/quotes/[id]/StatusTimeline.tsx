import type { QuoteRow } from "@/lib/supabase/types";

/**
 * Status timeline strip (Task 19 brief: "status timeline strip
 * (draft→approved→sent→outcome with timestamps)"). Pure display — reads the
 * quote's own timestamp columns, does not compute or mutate anything.
 * `isExpiredComputed` is the display-only expiry flag from
 * lib/quotes/workflow.ts isComputedExpired, layered on top of "Sent" as a
 * soft warning rather than a fifth step, since it is NOT a stored status.
 */
function stepClasses(done: boolean): string {
  return done
    ? "bg-veridan-ink text-veridan-paper"
    : "bg-veridan-warm-gray-pale text-veridan-warm-gray";
}

function stamp(at: string | null): string | null {
  if (!at) return null;
  return new Date(at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function StatusTimeline({
  quote,
  isExpiredComputed,
}: {
  quote: QuoteRow;
  isExpiredComputed: boolean;
}) {
  const steps: Array<{ label: string; at: string | null; done: boolean }> = [
    { label: "Draft", at: quote.created_at, done: true },
    { label: "Approved", at: quote.approved_at, done: Boolean(quote.approved_at) },
    { label: "Sent", at: quote.sent_at, done: Boolean(quote.sent_at) },
  ];

  let outcomeLabel = "Pending";
  let outcomeAt: string | null = null;
  let outcomeDone = false;
  if (quote.status === "accepted") {
    outcomeLabel = "Accepted";
    outcomeAt = quote.accepted_at;
    outcomeDone = true;
  } else if (quote.status === "declined") {
    outcomeLabel = "Declined";
    outcomeAt = quote.declined_at;
    outcomeDone = true;
  } else if (quote.status === "expired") {
    outcomeLabel = "Expired";
    outcomeDone = true;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            <div className={`rounded-md px-3 py-1.5 text-xs font-medium ${stepClasses(s.done)}`}>
              {s.label}
              {stamp(s.at) && <span className="ml-1.5 opacity-70">· {stamp(s.at)}</span>}
            </div>
            {i < steps.length - 1 && <span className="text-veridan-warm-gray">→</span>}
          </div>
        ))}
        <span className="text-veridan-warm-gray">→</span>
        <div className={`rounded-md px-3 py-1.5 text-xs font-medium ${stepClasses(outcomeDone)}`}>
          {outcomeLabel}
          {stamp(outcomeAt) && <span className="ml-1.5 opacity-70">· {stamp(outcomeAt)}</span>}
        </div>
      </div>
      {isExpiredComputed && quote.status !== "expired" && (
        <p className="mt-2 text-xs text-amber-700">
          Past its valid-until date — showing as expired here even though the stored status is still
          &ldquo;{quote.status}&rdquo;. Use &ldquo;Mark expired&rdquo; below to update the status itself.
        </p>
      )}
    </div>
  );
}
