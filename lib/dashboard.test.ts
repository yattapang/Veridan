import { describe, expect, it } from "vitest";
import { buildRecentActivity } from "./dashboard";

describe("buildRecentActivity", () => {
  it("merges the three sources into one reverse-chronological list", () => {
    const result = buildRecentActivity({
      enquiries: [
        { id: "e1", contact_name: "Jane Doe", company_name: "Acme Co", created_at: "2026-07-10T09:00:00Z" },
      ],
      quotesSent: [{ id: "q1", quote_ref: "VQ-2026-001", sent_at: "2026-07-12T09:00:00Z" }],
      quotesAccepted: [
        { id: "q2", quote_ref: "VQ-2026-002", accepted_at: "2026-07-14T09:00:00Z" },
      ],
    });

    expect(result.map((r) => r.id)).toEqual(["accepted-q2", "sent-q1", "enquiry-e1"]);
    expect(result[0].type).toBe("quote_accepted");
    expect(result[0].href).toBe("/admin/quotes/q2");
  });

  it("caps to the given limit", () => {
    const enquiries = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`,
      contact_name: "Someone",
      company_name: null,
      created_at: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T09:00:00Z`,
    }));
    const result = buildRecentActivity(
      { enquiries, quotesSent: [], quotesAccepted: [] },
      10,
    );
    expect(result).toHaveLength(10);
  });

  it("returns an empty list with no sources", () => {
    expect(buildRecentActivity({ enquiries: [], quotesSent: [], quotesAccepted: [] })).toEqual([]);
  });
});
