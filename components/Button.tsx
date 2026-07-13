import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-veridan-accent text-veridan-ink hover:bg-veridan-accent-soft border border-veridan-accent",
  secondary:
    "bg-transparent text-veridan-ink border border-veridan-ink hover:bg-veridan-ink hover:text-veridan-paper",
  ghost:
    "bg-transparent text-veridan-paper border border-veridan-paper/40 hover:border-veridan-paper",
};

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
  ...rest
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium uppercase tracking-wide transition-colors duration-200 ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {children}
    </Link>
  );
}
