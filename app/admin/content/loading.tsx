export default function SiteContentLoading() {
  return (
    <div className="max-w-3xl animate-pulse">
      <div className="mb-6 h-7 w-40 rounded bg-veridan-warm-gray-pale" />
      <div className="space-y-8">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-40 rounded-md bg-veridan-warm-gray-pale" />
        ))}
      </div>
    </div>
  );
}
