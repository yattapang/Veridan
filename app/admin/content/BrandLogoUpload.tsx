"use client";

import { useState } from "react";
import { uploadBrandLogoAction, type UploadImageResult } from "./actions";

const initialResult: UploadImageResult = { ok: true, path: "", url: "" };

const inputClass =
  "w-full max-w-[16rem] rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none file:mr-3 file:rounded-md file:border-0 file:bg-veridan-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:uppercase file:tracking-wide file:text-veridan-paper";

/**
 * Per-brand-row logo upload (Framework A), used from BrandsEditor.tsx —
 * which renders one <form> around the WHOLE brands list (so its single
 * "Save" button can submit every row's name + logo path together). Nested
 * <form> elements aren't valid HTML, so this deliberately does NOT render
 * its own <form> the way HeroImageUploader does (that component sits
 * outside the article's main <form> entirely — see
 * app/admin/articles/[id]/edit/page.tsx). Instead it calls the
 * "use server" action directly as a plain async function on file selection
 * — a Server Action is just a callable function; binding it to a <form
 * action> is one way to invoke it, not the only way.
 */
export function BrandLogoUpload({
  brandKey,
  currentLogoUrl,
  onUploaded,
  onRemove,
}: {
  brandKey: string;
  currentLogoUrl: string | null;
  onUploaded: (path: string, url: string) => void;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so choosing the same file again still fires onChange
    if (!file) return;

    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.set("logo", file);
    const result = await uploadBrandLogoAction(brandKey, initialResult, formData);
    setUploading(false);

    if (result.ok) {
      onUploaded(result.path, result.url);
    } else {
      setError(result.error);
    }
  }

  if (currentLogoUrl) {
    return (
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- admin-only preview of a public Storage-hosted image; see app/(marketing)/page.tsx's brand strip for the same choice on the public side. */}
        <img
          src={currentLogoUrl}
          alt="Current brand logo"
          className="h-12 w-auto max-w-[8rem] rounded border border-veridan-warm-gray-light bg-white object-contain p-1"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-xs font-medium text-red-600 hover:text-red-700"
        >
          Remove logo
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        disabled={uploading}
        onChange={handleFileChange}
        className={inputClass}
      />
      {uploading && <p className="mt-1 text-xs text-veridan-warm-gray">Uploading…</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
      <p className="mt-1 text-xs text-veridan-warm-gray">Optional — PNG, JPG, or WEBP, max 5MB.</p>
    </div>
  );
}
