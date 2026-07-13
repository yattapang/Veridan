export function SectionHeading({
  kicker,
  title,
  lead,
  align = "left",
}: {
  kicker?: string;
  title: string;
  lead?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      {kicker && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-veridan-accent">
          {kicker}
        </p>
      )}
      <h2 className="text-2xl font-semibold tracking-tight text-veridan-ink sm:text-3xl">
        {title}
      </h2>
      {lead && (
        <p className="mt-4 text-base leading-relaxed text-veridan-warm-gray">
          {lead}
        </p>
      )}
    </div>
  );
}
