import Link from "next/link";
import { siteMeta } from "@/lib/site-content";

/**
 * Text wordmark placeholder logo. Real brand assets (logo files) are a
 * founder-provided input (PRD §13 item 1) — this component is intentionally
 * the single place the logo is rendered, so swapping in an <Image> once
 * assets arrive is a one-file change.
 */
export function Wordmark({
  className = "",
  dark = false,
}: {
  className?: string;
  dark?: boolean;
}) {
  return (
    <Link
      href="/"
      className={`inline-flex items-baseline gap-2 font-semibold tracking-[0.2em] uppercase ${
        dark ? "text-veridan-paper" : "text-veridan-ink"
      } ${className}`}
    >
      <span>{siteMeta.wordmark}</span>
    </Link>
  );
}
