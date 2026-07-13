import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { Container } from "@/components/Container";
import { navLinks, siteMeta, contactInfo } from "@/lib/site-content";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-veridan-paper/10 bg-veridan-ink text-veridan-paper">
      <Container className="grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Wordmark dark />
          <p className="max-w-sm text-sm leading-relaxed text-veridan-paper/70">
            {siteMeta.positioning}. {siteMeta.tagline}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-veridan-paper/50">
            Navigate
          </h3>
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-veridan-paper/80 transition-colors hover:text-veridan-accent-soft"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-veridan-paper/50">
            Contact
          </h3>
          <a
            href={`mailto:${contactInfo.email}`}
            className="text-sm text-veridan-paper/80 transition-colors hover:text-veridan-accent-soft"
          >
            {contactInfo.email}
          </a>
          <p className="text-sm text-veridan-paper/80">
            {contactInfo.whatsappBusinessLabel}
          </p>
          <p className="text-sm text-veridan-paper/80">{contactInfo.location}</p>
        </div>
      </Container>

      <div className="border-t border-veridan-paper/10">
        <Container className="flex flex-col gap-2 py-6 text-xs text-veridan-paper/50 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {siteMeta.legalName}. All rights reserved.
          </p>
          <p>{siteMeta.tagline}</p>
        </Container>
      </div>
    </footer>
  );
}
