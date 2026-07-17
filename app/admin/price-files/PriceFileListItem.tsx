import Link from "next/link";
import type { PriceFileUploadWithDetails } from "@/lib/supabase/types";
import { extractionStatusBadgeClass, extractionStatusLabel } from "@/lib/price-files";
import { fileNameFromPath } from "@/lib/storage";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PriceFileListItem({ upload }: { upload: PriceFileUploadWithDetails }) {
  return (
    <tr className="border-t border-veridan-warm-gray-light">
      <td className="px-4 py-3">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${extractionStatusBadgeClass(upload.extraction_status)}`}
        >
          {extractionStatusLabel(upload.extraction_status)}
        </span>
      </td>
      <td className="px-4 py-3 text-veridan-ink">
        {upload.suppliers?.name ?? <span className="text-veridan-warm-gray">Undetected</span>}
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/admin/price-files/${upload.id}`}
          className="font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
        >
          {upload.original_filename ?? fileNameFromPath(upload.file_storage_path)}
        </Link>
      </td>
      <td className="px-4 py-3 text-veridan-warm-gray">{formatDateTime(upload.uploaded_at)}</td>
      <td className="px-4 py-3 text-veridan-warm-gray">
        {upload.users?.display_name ?? upload.users?.email ?? "—"}
      </td>
    </tr>
  );
}
