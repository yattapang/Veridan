import { describe, expect, it } from "vitest";
import { deriveStage, groupByStage, PIPELINE_STAGES } from "./pipeline";

describe("deriveStage", () => {
  it("maps a brand-new enquiry to Enquiry", () => {
    expect(deriveStage({ enquiryStatus: "new", quoteStatus: null, projectStatus: null })).toBe(
      "Enquiry",
    );
  });

  it("maps a reviewing enquiry to Technical Review", () => {
    expect(
      deriveStage({ enquiryStatus: "reviewing", quoteStatus: null, projectStatus: null }),
    ).toBe("Technical Review");
  });

  it("maps a converted enquiry with a project but no quote yet to Technical Review", () => {
    expect(
      deriveStage({ enquiryStatus: "converted", quoteStatus: null, projectStatus: "active" }),
    ).toBe("Technical Review");
  });

  it("maps a draft quote to Quote Drafted", () => {
    expect(
      deriveStage({ enquiryStatus: "converted", quoteStatus: "draft", projectStatus: "active" }),
    ).toBe("Quote Drafted");
  });

  it.each(["approved", "sent", "viewed", "expired"] as const)(
    "maps a %s quote to Sent",
    (status) => {
      expect(
        deriveStage({ enquiryStatus: "converted", quoteStatus: status, projectStatus: "active" }),
      ).toBe("Sent");
    },
  );

  it("maps an accepted quote to Accepted", () => {
    expect(
      deriveStage({ enquiryStatus: "converted", quoteStatus: "accepted", projectStatus: "active" }),
    ).toBe("Accepted");
  });

  it("maps a declined quote to Declined", () => {
    expect(
      deriveStage({ enquiryStatus: "converted", quoteStatus: "declined", projectStatus: "active" }),
    ).toBe("Declined");
  });

  it("maps a closed project to Fulfilled regardless of quote status", () => {
    expect(
      deriveStage({ enquiryStatus: "converted", quoteStatus: "accepted", projectStatus: "closed" }),
    ).toBe("Fulfilled");
  });

  it("prioritizes a closed project over an in-progress quote", () => {
    expect(
      deriveStage({ enquiryStatus: "converted", quoteStatus: "draft", projectStatus: "closed" }),
    ).toBe("Fulfilled");
  });

  it("falls back to Unknown for a discarded enquiry with nothing else", () => {
    expect(deriveStage({ enquiryStatus: "discarded", quoteStatus: null, projectStatus: null })).toBe(
      "Unknown",
    );
  });
});

describe("groupByStage", () => {
  it("buckets rows by stage in PIPELINE_STAGES order and drops Unknown", () => {
    const rows = [
      { id: "1", stage: "Sent" as const },
      { id: "2", stage: "Enquiry" as const },
      { id: "3", stage: "Unknown" as const },
      { id: "4", stage: "Sent" as const },
    ];
    const grouped = groupByStage(rows);
    expect(Object.keys(grouped)).toEqual(PIPELINE_STAGES);
    expect(grouped.Sent.map((r) => r.id)).toEqual(["1", "4"]);
    expect(grouped.Enquiry.map((r) => r.id)).toEqual(["2"]);
    expect(grouped["Quote Drafted"]).toEqual([]);
  });
});
