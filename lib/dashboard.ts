/**
 * Recent-activity feed (Task 21) — PURE, no I/O. Merges three already-
 * fetched row sets (enquiries received, quotes sent, quotes accepted) into
 * one reverse-chronological list, capped to `limit`. Kept separate from the
 * page component so the "union + sort + cap" logic is unit-testable.
 */

export type ActivityType = "enquiry_received" | "quote_sent" | "quote_accepted";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  label: string;
  atIso: string;
  href: string;
}

export interface ActivitySourceRows {
  enquiries: { id: string; contact_name: string; company_name: string | null; created_at: string }[];
  quotesSent: { id: string; quote_ref: string; sent_at: string }[];
  quotesAccepted: { id: string; quote_ref: string; accepted_at: string }[];
}

export function buildRecentActivity(sources: ActivitySourceRows, limit = 10): ActivityItem[] {
  const items: ActivityItem[] = [
    ...sources.enquiries.map((e) => ({
      id: `enquiry-${e.id}`,
      type: "enquiry_received" as const,
      label: `Enquiry received from ${e.company_name || e.contact_name}`,
      atIso: e.created_at,
      href: `/admin/enquiries/${e.id}`,
    })),
    ...sources.quotesSent.map((q) => ({
      id: `sent-${q.id}`,
      type: "quote_sent" as const,
      label: `Quote ${q.quote_ref} sent`,
      atIso: q.sent_at,
      href: `/admin/quotes/${q.id}`,
    })),
    ...sources.quotesAccepted.map((q) => ({
      id: `accepted-${q.id}`,
      type: "quote_accepted" as const,
      label: `Quote ${q.quote_ref} accepted`,
      atIso: q.accepted_at,
      href: `/admin/quotes/${q.id}`,
    })),
  ];

  items.sort((a, b) => (a.atIso < b.atIso ? 1 : a.atIso > b.atIso ? -1 : 0));
  return items.slice(0, limit);
}
