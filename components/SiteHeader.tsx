"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { ButtonLink } from "@/components/Button";
import { Container } from "@/components/Container";
import { navLinks, primaryCta } from "@/lib/site-content";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-veridan-line/10 bg-veridan-paper/95 backdrop-blur supports-backdrop-blur:bg-veridan-paper/80">
      <Container className="flex h-20 items-center justify-between">
        <Wordmark preload />

        <nav className="hidden items-center gap-5 xl:flex">
          {navLinks.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-sm text-sm font-medium uppercase tracking-wide whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-veridan-accent focus-visible:ring-offset-2 ${
                  active
                    ? "text-veridan-ink"
                    : "text-veridan-warm-gray hover:text-veridan-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden xl:block">
          <ButtonLink href={primaryCta.href} variant="primary">
            {primaryCta.label}
          </ButtonLink>
        </div>

        {/* The bare bars weren't obviously a menu to every visitor — pairing
            them with a visible "Menu"/"Close" label and a button outline makes
            the affordance unmistakable (the label also serves as the button's
            accessible name, so no aria-label is needed). */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav-menu"
          className="flex h-11 items-center gap-2 rounded-md border border-veridan-warm-gray-light px-3 text-sm font-medium uppercase tracking-wide text-veridan-ink transition-colors hover:border-veridan-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-veridan-accent focus-visible:ring-offset-2 xl:hidden"
        >
          <span
            className="flex h-5 w-5 flex-col items-center justify-center gap-1.5"
            aria-hidden="true"
          >
            <span
              className={`block h-px w-5 bg-veridan-ink transition-transform ${
                open ? "translate-y-2 rotate-45" : ""
              }`}
            />
            <span
              className={`block h-px w-5 bg-veridan-ink transition-opacity ${
                open ? "opacity-0" : "opacity-100"
              }`}
            />
            <span
              className={`block h-px w-5 bg-veridan-ink transition-transform ${
                open ? "-translate-y-2 -rotate-45" : ""
              }`}
            />
          </span>
          {open ? "Close" : "Menu"}
        </button>
      </Container>

      {open && (
        <div
          id="mobile-nav-menu"
          className="border-t border-veridan-line/10 bg-veridan-paper xl:hidden"
        >
          <Container className="flex flex-col gap-1 py-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="py-3 text-sm font-medium uppercase tracking-wide text-veridan-ink border-b border-veridan-line/5 last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-veridan-accent focus-visible:ring-offset-2"
              >
                {link.label}
              </Link>
            ))}
            <ButtonLink
              href={primaryCta.href}
              variant="primary"
              className="mt-4"
              onClick={() => setOpen(false)}
            >
              {primaryCta.label}
            </ButtonLink>
          </Container>
        </div>
      )}
    </header>
  );
}
