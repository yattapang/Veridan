import Image from "next/image";
import Link from "next/link";
import { siteMeta } from "@/lib/site-content";

/**
 * Real brand logo (founder-provided, PRD §13 item 1). The framed-V mark is
 * rendered beside the "VERIDAN" text — the mark image ships in both an
 * ink (near-black, for light backgrounds) and brass (for dark backgrounds)
 * variant, selected via the `dark` prop, matching the same principle
 * described in lib/quote-pdf/QuotePdf.tsx's Header component.
 */

// Intrinsic aspect ratio of public/brand/logo-mark-*.png (515x569).
const MARK_ASPECT = 515 / 569;

export function Wordmark({
  className = "",
  dark = false,
  size = 36,
  preload = false,
}: {
  className?: string;
  dark?: boolean;
  /** Rendered height of the mark, in px. Width follows the mark's aspect ratio. */
  size?: number;
  /** Preload the image (use on the header's above-the-fold instance only). */
  preload?: boolean;
}) {
  const height = size;
  const width = Math.round(size * MARK_ASPECT);

  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2.5 rounded-sm font-semibold tracking-[0.2em] uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-veridan-accent focus-visible:ring-offset-2 ${
        dark ? "text-veridan-paper" : "text-veridan-ink"
      } ${className}`}
    >
      <Image
        src={dark ? "/brand/logo-mark-brass.png" : "/brand/logo-mark-ink.png"}
        alt="Veridan Limited"
        width={width}
        height={height}
        preload={preload}
        className="shrink-0"
        style={{ height, width: "auto" }}
      />
      <span>{siteMeta.wordmark}</span>
    </Link>
  );
}
