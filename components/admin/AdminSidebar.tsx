"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { label: string; href: string };
type NavSection = { heading: string; items: NavItem[] };

// Grouped for scan-ability now that the flat list has grown to ~16 links
// (Phase 3 polish). Same hrefs as before — grouping/labels only.
const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Overview",
    items: [
      { label: "Dashboard", href: "/admin" },
      { label: "Pipeline", href: "/admin/pipeline" },
    ],
  },
  {
    heading: "Sales",
    items: [
      { label: "Enquiries", href: "/admin/enquiries" },
      { label: "Companies", href: "/admin/companies" },
      { label: "Projects", href: "/admin/projects" },
      { label: "Quotes", href: "/admin/quotes" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { label: "Orders", href: "/admin/orders" },
      { label: "Suppliers", href: "/admin/suppliers" },
      { label: "Products", href: "/admin/products" },
      { label: "Item Groups", href: "/admin/item-groups" },
      { label: "Price Files", href: "/admin/price-files" },
    ],
  },
  {
    heading: "Finance",
    items: [
      { label: "Invoices", href: "/admin/invoices" },
      { label: "Reports", href: "/admin/reports" },
      { label: "Overrides", href: "/admin/overrides" },
    ],
  },
  {
    heading: "Website",
    items: [
      { label: "Content", href: "/admin/content" },
      { label: "Articles", href: "/admin/articles" },
      { label: "Catalogue", href: "/admin/catalogue" },
    ],
  },
  {
    heading: "Settings",
    items: [{ label: "Parameters", href: "/admin/parameters" }],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-5">
      {NAV_SECTIONS.map((section) => (
        <div key={section.heading}>
          <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
            {section.heading}
          </p>
          <div className="flex flex-col gap-1">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    active
                      ? "bg-veridan-ink text-veridan-paper"
                      : "text-veridan-ink/70 hover:bg-veridan-warm-gray-pale hover:text-veridan-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
