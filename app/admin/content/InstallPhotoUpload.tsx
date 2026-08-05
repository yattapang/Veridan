"use client";

import { useState } from "react";
import { uploadInstallPhotoAction, type UploadImageResult } from "./actions";

const initialResult: UploadImageResult = { ok: true, path: "", url: "" };

const inputClass =
  "w-full max-w-[16rem] rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none file:mr-3 file:rounded-md file:border-0 file:bg-veridan-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:uppercase file:tracking-wide file:text-veridan-paper";

/**
 * Photo upload for a NEW "Our Work" gallery row (Framework B). Same
 * "call the Server Action directly, no nested <form>" reasoning as
 * BrandLogoUpload.tsx — InstallGalleryEditor renders one <form> around the
 * whole gallery list.
 */
export function InstallPhotoUpload({
  onUploaded,
}: {
  onUploaded: (path: string, url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.set("photo", file);
    const result = await uploadInstallPhotoAction(initialResult, formData);
    setUploading(false);

    if (result.ok) {
      onUploaded(result.path, result.url);
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="rounded-md border border-dashed border-veridan-warm-gray-light p-4">
      <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
        Add a photo
      </label>
      <input
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        disabled={uploading}
        onChange={handleFileChange}
        className={`${inputClass} mt-1`}
      />
      {uploading && <p className="mt-1 text-xs text-veridan-warm-gray">Uploading…</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
      <p className="mt-1 text-xs text-veridan-warm-gray">PNG, JPG, or WEBP, max 5MB.</p>
    </div>
  );
}
