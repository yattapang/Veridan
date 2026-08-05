import { describe, expect, it } from "vitest";
// Relative imports only (not the "@/..." alias) — vitest here has no
// path-alias resolution configured for runtime imports, same constraint
// documented in lib/item-groups.ts.
import {
  siteMeta,
  contactInfo,
  brandsSupplied,
  trustSignals,
  testimonials,
  serviceLines,
  productCategories,
  founders,
  aboutStory,
} from "../site-content";
import {
  isValidSiteMetaEditable,
  isValidContactInfoEditable,
  isValidBrandsSuppliedEditable,
  isValidTrustSignalsEditable,
  isValidTestimonialsEditable,
  isValidServiceLinesEditable,
  isValidProductCategoriesEditable,
  isValidFoundersEditable,
  isValidAboutStoryEditable,
  isValidInstallGalleryEditable,
  isValidConsultationBookingEditable,
  resolveSiteMeta,
  resolveContactInfo,
  resolveBrandsSupplied,
  resolveTrustSignals,
  resolveTestimonials,
  resolveServiceLines,
  resolveProductCategories,
  resolveFounders,
  resolveAboutStory,
  resolveInstallGallery,
  resolveConsultationBooking,
} from "./validation";

describe("shape validation — the current lib/site-content.ts constants are themselves valid (sanity check the validators against real data)", () => {
  it("site_meta editable subset", () => {
    expect(
      isValidSiteMetaEditable({
        tagline: siteMeta.tagline,
        positioning: siteMeta.positioning,
        description: siteMeta.description,
        locality: siteMeta.locality,
      })
    ).toBe(true);
  });

  it("contact_info", () => {
    expect(isValidContactInfoEditable(contactInfo)).toBe(true);
  });

  it("brands_supplied (including the empty-array edge case)", () => {
    expect(isValidBrandsSuppliedEditable(brandsSupplied)).toBe(true);
    expect(isValidBrandsSuppliedEditable([])).toBe(true);
  });

  it("trust_signals", () => {
    expect(isValidTrustSignalsEditable(trustSignals)).toBe(true);
  });

  it("testimonials (seeded-empty case)", () => {
    expect(isValidTestimonialsEditable(testimonials)).toBe(true);
    expect(isValidTestimonialsEditable([])).toBe(true);
  });

  it("service_lines", () => {
    expect(isValidServiceLinesEditable(serviceLines)).toBe(true);
  });

  it("product_categories, including a category with an empty brands array (signage)", () => {
    expect(isValidProductCategoriesEditable(productCategories)).toBe(true);
    const signage = productCategories.find((c) => c.key === "signage");
    expect(signage?.brands.length).toBe(0);
  });

  it("founders", () => {
    expect(isValidFoundersEditable(founders)).toBe(true);
  });

  it("about_story", () => {
    expect(isValidAboutStoryEditable(aboutStory)).toBe(true);
  });
});

describe("shape validation — rejects malformed/legacy shapes", () => {
  it("site_meta: missing field, wrong type, empty string, non-object", () => {
    expect(isValidSiteMetaEditable(undefined)).toBe(false);
    expect(isValidSiteMetaEditable(null)).toBe(false);
    expect(isValidSiteMetaEditable("a string")).toBe(false);
    expect(isValidSiteMetaEditable([])).toBe(false);
    expect(
      isValidSiteMetaEditable({ tagline: "x", positioning: "y", description: "z" }) // missing locality
    ).toBe(false);
    expect(
      isValidSiteMetaEditable({ tagline: "", positioning: "y", description: "z", locality: "w" }) // blank tagline
    ).toBe(false);
    expect(
      isValidSiteMetaEditable({ tagline: 5, positioning: "y", description: "z", locality: "w" }) // wrong type
    ).toBe(false);
  });

  it("contact_info: missing/blank field", () => {
    expect(isValidContactInfoEditable(undefined)).toBe(false);
    expect(
      isValidContactInfoEditable({
        email: "a@b.com",
        whatsappBusinessLabel: "WhatsApp",
        whatsappBusinessNote: "   ",
        location: "Kingston",
      })
    ).toBe(false);
  });

  it("brands_supplied: non-array, array with a non-string, array with a blank string", () => {
    expect(isValidBrandsSuppliedEditable(undefined)).toBe(false);
    expect(isValidBrandsSuppliedEditable("Assa Abloy")).toBe(false);
    expect(isValidBrandsSuppliedEditable(["Assa Abloy", 5])).toBe(false);
    expect(isValidBrandsSuppliedEditable(["Assa Abloy", "  "])).toBe(false);
  });

  it("trust_signals: item missing body", () => {
    expect(isValidTrustSignalsEditable(undefined)).toBe(false);
    expect(isValidTrustSignalsEditable([{ title: "Only a title" }])).toBe(false);
  });

  it("testimonials: item missing attribution", () => {
    expect(isValidTestimonialsEditable([{ quote: "Great service" }])).toBe(false);
  });

  it("service_lines: href not site-relative", () => {
    expect(
      isValidServiceLinesEditable([
        { key: "x", title: "X", href: "https://evil.example.com", summary: "s" },
      ])
    ).toBe(false);
  });

  it("product_categories: brands not an array of strings", () => {
    expect(
      isValidProductCategoriesEditable([
        { key: "x", title: "X", description: "d", brands: ["ok", 5] },
      ])
    ).toBe(false);
    expect(
      isValidProductCategoriesEditable([{ key: "x", title: "X", description: "d", brands: "not-an-array" }])
    ).toBe(false);
  });

  it("founders: item missing role", () => {
    expect(isValidFoundersEditable([{ name: "A", bio: "b" }])).toBe(false);
  });

  it("about_story: empty body array, or a blank paragraph", () => {
    expect(isValidAboutStoryEditable({ heading: "H", body: [] })).toBe(false);
    expect(isValidAboutStoryEditable({ heading: "H", body: ["ok", "   "] })).toBe(false);
  });
});

describe("fallback resolution — the guarantee marketing pages depend on: missing row, Supabase error, and invalid shape ALL fall back to the lib/site-content.ts constant verbatim", () => {
  it("site_meta: undefined (missing row / error) falls back whole, including structural fields", () => {
    expect(resolveSiteMeta(undefined, siteMeta)).toEqual(siteMeta);
  });

  it("site_meta: invalid shape falls back whole", () => {
    expect(resolveSiteMeta({ tagline: "only this" }, siteMeta)).toEqual(siteMeta);
  });

  it("site_meta: valid DB value overrides only the editable fields, keeping structural fields from the fallback", () => {
    const dbValue = {
      tagline: "New tagline from the admin",
      positioning: siteMeta.positioning,
      description: siteMeta.description,
      locality: siteMeta.locality,
    };
    const resolved = resolveSiteMeta(dbValue, siteMeta);
    expect(resolved.tagline).toBe("New tagline from the admin");
    // Structural fields never come from the DB — always the fallback's.
    expect(resolved.name).toBe(siteMeta.name);
    expect(resolved.legalName).toBe(siteMeta.legalName);
    expect(resolved.wordmark).toBe(siteMeta.wordmark);
    expect(resolved.domain).toBe(siteMeta.domain);
    expect(resolved.siteUrl).toBe(siteMeta.siteUrl);
  });

  it("contact_info: missing/invalid falls back verbatim; valid DB value fully replaces (no structural leftover fields)", () => {
    expect(resolveContactInfo(undefined, contactInfo)).toEqual(contactInfo);
    const dbValue = {
      email: "quotes@veridanlimited.com",
      whatsappBusinessLabel: "WhatsApp Business",
      whatsappBusinessNote: "+1 876 555 0100",
      location: "Kingston, Jamaica",
      phone: "1 876 555 0199",
    };
    expect(resolveContactInfo(dbValue, contactInfo)).toEqual(dbValue);
  });

  it("contact_info: phone is optional — a legacy row missing the key still resolves, falling back to the constant's phone only", () => {
    const legacyDbValue = {
      email: "quotes@veridanlimited.com",
      whatsappBusinessLabel: "WhatsApp Business",
      whatsappBusinessNote: "+1 876 555 0100",
      location: "Kingston, Jamaica",
      // no `phone` key at all
    };
    expect(isValidContactInfoEditable(legacyDbValue)).toBe(true);
    expect(resolveContactInfo(legacyDbValue, contactInfo)).toEqual({
      ...legacyDbValue,
      phone: contactInfo.phone,
    });
  });

  it("contact_info: phone cleared to blank is treated as missing, not as an invalid shape", () => {
    const dbValue = {
      email: "quotes@veridanlimited.com",
      whatsappBusinessLabel: "WhatsApp Business",
      whatsappBusinessNote: "+1 876 555 0100",
      location: "Kingston, Jamaica",
      phone: "   ",
    };
    expect(isValidContactInfoEditable(dbValue)).toBe(true);
    expect(resolveContactInfo(dbValue, contactInfo).phone).toBe(contactInfo.phone);
  });

  it("brands_supplied: missing falls back to the hardcoded list (normalized to {name, logoPath: null}); a validly-empty DB array is honored, not treated as missing; the new {name, logo_path} shape normalizes too", () => {
    expect(resolveBrandsSupplied(undefined, brandsSupplied)).toEqual(
      brandsSupplied.map((name) => ({ name, logoPath: null }))
    );
    expect(resolveBrandsSupplied([], brandsSupplied)).toEqual([]);
    expect(resolveBrandsSupplied(["Only One Brand"], brandsSupplied)).toEqual([
      { name: "Only One Brand", logoPath: null },
    ]);
    expect(
      resolveBrandsSupplied(
        [{ name: "Only One Brand", logo_path: "only-one-brand/1-logo.png" }],
        brandsSupplied
      )
    ).toEqual([{ name: "Only One Brand", logoPath: "only-one-brand/1-logo.png" }]);
  });

  it("trust_signals / testimonials / service_lines / product_categories / founders: same missing-vs-invalid-vs-valid pattern", () => {
    expect(resolveTrustSignals(undefined, [...trustSignals])).toEqual([...trustSignals]);
    expect(resolveTrustSignals("not valid", [...trustSignals])).toEqual([...trustSignals]);

    expect(resolveTestimonials(undefined, [...testimonials])).toEqual([...testimonials]);
    expect(resolveTestimonials([{ quote: "Great!", attribution: "A Client" }], [...testimonials])).toEqual([
      { quote: "Great!", attribution: "A Client" },
    ]);

    expect(resolveServiceLines(undefined, [...serviceLines])).toEqual([...serviceLines]);

    // productCategories' nested `brands` arrays are readonly tuples (from
    // `as const`) — deep-clone into mutable arrays so this matches
    // ProductCategoriesEditable's shape (string[] brands) without a cast.
    const mutableProductCategories = productCategories.map((c) => ({ ...c, brands: [...c.brands] }));
    expect(resolveProductCategories(undefined, mutableProductCategories)).toEqual(
      mutableProductCategories
    );

    expect(resolveFounders(undefined, [...founders])).toEqual([...founders]);
  });

  it("about_story: missing/invalid falls back verbatim", () => {
    const mutableAboutStory = { heading: aboutStory.heading, body: [...aboutStory.body] };
    expect(resolveAboutStory(undefined, mutableAboutStory)).toEqual(mutableAboutStory);
    expect(resolveAboutStory({ heading: "H" }, mutableAboutStory)).toEqual(mutableAboutStory);
  });
});

describe("install_gallery (Marketing frameworks build, Framework B) — seeded-empty, founder-populated array of {image_path, caption?}", () => {
  it("an empty array is valid (the seeded default)", () => {
    expect(isValidInstallGalleryEditable([])).toBe(true);
  });

  it("a photo with a caption, and a photo without one (caption is optional)", () => {
    expect(
      isValidInstallGalleryEditable([
        { image_path: "a/1-photo.jpg", caption: "Front door install, Kingston" },
        { image_path: "a/2-photo.jpg" },
      ])
    ).toBe(true);
  });

  it("rejects a non-array, a missing/blank image_path, or a non-string caption", () => {
    expect(isValidInstallGalleryEditable(undefined)).toBe(false);
    expect(isValidInstallGalleryEditable("a/1-photo.jpg")).toBe(false);
    expect(isValidInstallGalleryEditable([{ caption: "No photo" }])).toBe(false);
    expect(isValidInstallGalleryEditable([{ image_path: "  " }])).toBe(false);
    expect(isValidInstallGalleryEditable([{ image_path: "a/1-photo.jpg", caption: 5 }])).toBe(false);
  });

  it("resolveInstallGallery: missing/invalid falls back verbatim to the (empty) fallback; a valid DB value is honored", () => {
    expect(resolveInstallGallery(undefined, [])).toEqual([]);
    expect(resolveInstallGallery("nope", [])).toEqual([]);
    const items = [{ image_path: "a/1-photo.jpg", caption: "A finished install" }];
    expect(resolveInstallGallery(items, [])).toEqual(items);
  });
});

describe("consultation_booking (Marketing frameworks build, Framework C) — optional {url}, empty allowed", () => {
  it("an empty url is valid (the seeded default — no booking button renders)", () => {
    expect(isValidConsultationBookingEditable({ url: "" })).toBe(true);
    expect(isValidConsultationBookingEditable({ url: "   " })).toBe(true);
  });

  it("a well-formed http(s) URL is valid", () => {
    expect(isValidConsultationBookingEditable({ url: "https://outlook.office.com/book/Veridan" })).toBe(
      true
    );
    expect(isValidConsultationBookingEditable({ url: "http://example.com/book" })).toBe(true);
  });

  it("rejects a non-URL string, a non-http(s) scheme, and a malformed shape", () => {
    expect(isValidConsultationBookingEditable({ url: "not a url" })).toBe(false);
    expect(isValidConsultationBookingEditable({ url: "javascript:alert(1)" })).toBe(false);
    expect(isValidConsultationBookingEditable({ url: "ftp://example.com/book" })).toBe(false);
    expect(isValidConsultationBookingEditable(undefined)).toBe(false);
    expect(isValidConsultationBookingEditable({ url: 5 })).toBe(false);
    expect(isValidConsultationBookingEditable({})).toBe(false);
  });

  it("resolveConsultationBooking: missing/invalid falls back verbatim; a valid value is trimmed", () => {
    const fallback = { url: "" };
    expect(resolveConsultationBooking(undefined, fallback)).toEqual(fallback);
    expect(resolveConsultationBooking({ url: "not a url" }, fallback)).toEqual(fallback);
    expect(resolveConsultationBooking({ url: "  https://example.com/book  " }, fallback)).toEqual({
      url: "https://example.com/book",
    });
  });
});
