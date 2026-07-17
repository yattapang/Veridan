"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS: { label: string; href: string }[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Pipeline", href: "/admin/pipeline" },
  { label: "Enquiries", href: "/admin/enquiries" },
  { label: "Projects", href: "/admin/projects" },
  { label: "Quotes", href: "/admin/quotes" },
  { label: "Companies", href: "/admin/companies" },
  { label: "Suppliers", href: "/admin/suppliers" },
  { label: "Products", href: "/admin/products" },
  { label: "Item Groups", href: "/admin/item-groups" },
  { label: "Parameters", href: "/admin/parameters" },
  { label: "Overrides", href: "/admin/overrides" },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
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
    </nav>
  );
}
