import Link from "next/link";
import type { PublicCatalogueDocument } from "@/lib/catalogue/publicLoader";
import { formatFileSize } from "@/lib/catalogue/validation";

function chipHref(base: Record<string, string | null>, override: Partial<Record<string, string | null>>): string {
  const merged = { ...base, ...override };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/catalogue?${qs}` : "/catalogue";
}

function ChipRow({
  label,
  options,
  active,
  paramKey,
  otherParam,
}: {
  label: string;
  options: string[];
  active: string | null;
  paramKey: "brand" | "category";
  otherParam: string | null;
}) {
  if (options.length === 0) return null;
  const otherKey = paramKey === "brand" ? "category" : "brand";
  const base: Record<string, string | null> = { [otherKey]: otherParam };

  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-veridan-warm-gray">{label}</p>
      <div className="flex flex-wrap gap-2">
        <Link
          href={chipHref(base, { [paramKey]: null })}
          className={`rounded-full border px-4 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors duration-150 ${
            !active
              ? "border-veridan-ink bg-veridan-ink text-veridan-paper"
              : "border-veridan-warm-gray-light text-veridan-warm-gray hover:border-veridan-ink hover:text-veridan-ink"
          }`}
        >
          All
        </Link>
        {options.map((option) => (
          <Link
            key={option}
            href={chipHref(base, { [paramKey]: option })}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors duration-150 ${
              active === option
                ? "border-veridan-ink bg-veridan-ink text-veridan-paper"
                : "border-veridan-warm-gray-light text-veridan-warm-gray hover:border-veridan-ink hover:text-veridan-ink"
            }`}
          >
            {option}
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Pure presentational grid + brand/category chip filters — no hooks, so it
 * doubles as the Suspense fallback shown during static prerendering (see
 * page.tsx / CatalogueListClient.tsx, mirroring app/(marketing)/articles/
 * ArticleGrid.tsx's identical convention).
 */
export function CatalogueGrid({
  items,
  allBrands,
  allCategories,
  activeBrand,
  activeCategory,
}: {
  items: PublicCatalogueDocument[];
  allBrands: string[];
  allCategories: string[];
  activeBrand: string | null;
  activeCategory: string | null;
}) {
  return (
    <>
      <ChipRow label="Brand" options={allBrands} active={activeBrand} paramKey="brand" otherParam={activeCategory} />
      <ChipRow
        label="Category"
        options={allCategories}
        active={activeCategory}
        paramKey="category"
        otherParam={activeBrand}
      />

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-veridan-warm-gray">
          {activeBrand || activeCategory
            ? "No documents match this filter yet."
            : "No catalogues published yet — check back soon."}
        </p>
      ) : (
        <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((doc) => {
            const size = formatFileSize(doc.file_size_bytes);
            return (
              <article
                key={doc.id}
                className="flex flex-col border border-veridan-warm-gray-light p-6"
              >
                {doc.thumbnail_storage_path ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served through the §3.3 gated route, not a static/known-domain image.
                  <img
                    src={`/api/catalogue/${doc.id}/thumbnail`}
                    alt=""
                    className="mb-4 h-36 w-full rounded-md border border-veridan-warm-gray-light object-cover"
                  />
                ) : (
                  <div className="mb-4 flex h-36 w-full items-center justify-center rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale text-xs uppercase tracking-wide text-veridan-warm-gray">
                    PDF
                  </div>
                )}
                <p className="text-[11px] font-semibold uppercase tracking-wide text-veridan-accent-text">
                  {doc.brand}
                  {doc.category ? ` · ${doc.category}` : ""}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-veridan-ink">{doc.title}</h2>
                {doc.description && (
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-veridan-warm-gray">{doc.description}</p>
                )}
                <a
                  href={`/api/catalogue/${doc.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-veridan-accent-text hover:text-veridan-ink"
                >
                  View / Download PDF{size ? ` (${size})` : ""} →
                </a>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
