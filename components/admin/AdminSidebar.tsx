"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canAccessAdminArea, type AdminArea, type UserRole } from "@/lib/roles/matrix";

type NavItem = { label: string; href: string; area: AdminArea };
type NavSection = { heading: string; items: NavItem[] };

// Grouped for scan-ability now that the flat list has grown to ~16 links
// (Phase 3 polish). Same hrefs as before — grouping/labels only.
//
// Every item carries its `area`, and the sidebar filters itself through
// canAccessAdminArea. This is enforcement layer (c): PRESENTATION ONLY. Hiding a
// link is not a control — the founder-only areas each have a layout guard, and
// every founder-only action and export route re-checks the role for itself. The
// value of doing it here is that a staff member never sees a door they cannot
// open, and that a new link cannot be added without declaring its area.
const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Overview",
    items: [
      { label: "Dashboard", href: "/admin", area: "dashboard" },
      { label: "Pipeline", href: "/admin/pipeline", area: "pipeline" },
    ],
  },
  {
    heading: "Sales",
    items: [
      { label: "Enquiries", href: "/admin/enquiries", area: "enquiries" },
      { label: "Companies", href: "/admin/companies", area: "companies" },
      { label: "Projects", href: "/admin/projects", area: "projects" },
      { label: "Quotes", href: "/admin/quotes", area: "quotes" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { label: "Orders", href: "/admin/orders", area: "orders" },
      { label: "Suppliers", href: "/admin/suppliers", area: "suppliers" },
      { label: "Products", href: "/admin/products", area: "products" },
      { label: "Item Groups", href: "/admin/item-groups", area: "item-groups" },
      { label: "Price Files", href: "/admin/price-files", area: "price-files" },
    ],
  },
  {
    heading: "Finance",
    items: [
      { label: "Invoices", href: "/admin/invoices", area: "invoices" },
      { label: "Expenses", href: "/admin/expenses", area: "expenses" },
      { label: "Reports", href: "/admin/reports", area: "reports" },
      { label: "Overrides", href: "/admin/overrides", area: "overrides" },
    ],
  },
  {
    heading: "Website",
    items: [
      { label: "Content", href: "/admin/content", area: "content" },
      { label: "Articles", href: "/admin/articles", area: "articles" },
      { label: "Catalogue", href: "/admin/catalogue", area: "catalogue" },
    ],
  },
  {
    heading: "Settings",
    items: [
      { label: "Parameters", href: "/admin/parameters", area: "parameters" },
      { label: "Team", href: "/admin/team", area: "team" },
      { label: "Your account", href: "/admin/account", area: "account" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccessAdminArea(role, item.area)),
  })).filter((section) => section.items.length > 0);

  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-5">
      {sections.map((section) => (
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
