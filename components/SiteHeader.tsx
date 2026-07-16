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

        <nav className="hidden items-center gap-8 lg:flex">
          {navLinks.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-sm text-sm font-medium uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-veridan-accent focus-visible:ring-offset-2 ${
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

        <div className="hidden lg:block">
          <ButtonLink href={primaryCta.href} variant="primary">
            {primaryCta.label}
          </ButtonLink>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav-menu"
          aria-label="Toggle navigation menu"
          className="flex h-11 w-11 flex-col items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-veridan-accent focus-visible:ring-offset-2 lg:hidden"
        >
          <span
            className={`block h-px w-6 bg-veridan-ink transition-transform ${
              open ? "translate-y-2 rotate-45" : ""
            }`}
          />
          <span
            className={`block h-px w-6 bg-veridan-ink transition-opacity ${
              open ? "opacity-0" : "opacity-100"
            }`}
          />
          <span
            className={`block h-px w-6 bg-veridan-ink transition-transform ${
              open ? "-translate-y-2 -rotate-45" : ""
            }`}
          />
        </button>
      </Container>

      {open && (
        <div
          id="mobile-nav-menu"
          className="border-t border-veridan-line/10 bg-veridan-paper lg:hidden"
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
