import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-veridan-paper text-veridan-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-veridan-ink focus:px-4 focus:py-3 focus:text-sm focus:font-medium focus:uppercase focus:tracking-wide focus:text-veridan-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-veridan-accent focus-visible:ring-offset-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
