"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/roles/matrix";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

/**
 * Mobile-only navigation for the admin shell.
 *
 * Below the `md` breakpoint, app/admin/layout.tsx hides the desktop
 * `<aside>` entirely (`hidden ... md:flex`) and nothing replaces it — so on
 * a phone this component is the ONLY way to reach any admin section other
 * than the one already on screen.
 *
 * It deliberately does not know what the nav items are: it renders the same
 * <AdminSidebar role={role} /> used on desktop, unmodified, so the
 * founder/staff filtering in AdminSidebar (via canAccessAdminArea) stays the
 * single source of truth. A staff member never sees a founder-only link
 * appear here that desktop would have hidden from them.
 */
export function AdminMobileNav({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // Tracks whether the drawer has actually been opened at least once, so the
  // focus-return effect below never fires on initial mount (when `open`
  // starts `false`) and steals focus to the hamburger button as the page
  // loads — it should only return focus after a real open-then-close.
  const hasOpenedRef = useRef(false);

  // Close as soon as navigation actually happens. AdminSidebar's <Link>s are
  // not touched to do this directly — comparing against the pathname seen on
  // the previous render covers every link inside it without threading a
  // callback prop through a component that's also used, unmodified, on
  // desktop. This runs during render (React's documented pattern for
  // resetting state when a prop/value changes) rather than in an effect, so
  // it doesn't cost an extra cascading render on every navigation.
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname);
    if (open) setOpen(false);
  }

  // While open: Escape closes, Tab is trapped inside the panel, and focus
  // starts on the close button. On close, focus returns to the button that
  // opened the drawer so keyboard focus never silently falls back to <body>.
  useEffect(() => {
    if (!open) {
      if (hasOpenedRef.current) openButtonRef.current?.focus();
      return;
    }

    hasOpenedRef.current = true;
    closeButtonRef.current?.focus();

    function focusableElements(): HTMLElement[] {
      const panel = panelRef.current;
      if (!panel) return [];
      return Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const elements = focusableElements();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Open admin navigation"
        className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-veridan-ink md:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-veridan-ink/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
            className="absolute top-0 left-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-veridan-warm-gray-light bg-veridan-paper shadow-lg"
          >
            <div className="flex shrink-0 items-center justify-between px-4 pt-6 pb-2">
              <div className="px-3">
                <p className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">
                  Veridan
                </p>
                <p className="text-xs text-veridan-warm-gray">Admin</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close admin navigation"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-veridan-ink"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
              <AdminSidebar role={role} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
