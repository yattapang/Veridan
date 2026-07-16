import { Container } from "@/components/Container";

export function PageHero({
  kicker,
  title,
  lead,
  dark = true,
  children,
}: {
  kicker?: string;
  title: string;
  lead?: string;
  dark?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={
        dark
          ? "bg-veridan-ink text-veridan-paper"
          : "bg-veridan-warm-gray-pale text-veridan-ink"
      }
    >
      <Container className="py-20 sm:py-28">
        {kicker && (
          <p
            className={`mb-4 text-xs font-semibold uppercase tracking-[0.3em] ${
              dark ? "text-veridan-accent-soft" : "text-veridan-accent-text"
            }`}
          >
            {kicker}
          </p>
        )}
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          {title}
        </h1>
        {lead && (
          <p
            className={`mt-6 max-w-2xl text-lg leading-relaxed ${
              dark ? "text-veridan-paper/75" : "text-veridan-warm-gray"
            }`}
          >
            {lead}
          </p>
        )}
        {children && <div className="mt-8">{children}</div>}
      </Container>
    </section>
  );
}
