export default function CompaniesLoading() {
  return (
    <div className="max-w-3xl animate-pulse">
      <div className="mb-6 h-7 w-44 rounded bg-veridan-warm-gray-pale" />
      <div className="h-40 rounded-md bg-veridan-warm-gray-pale" />
      <div className="mt-10 h-28 rounded-md bg-veridan-warm-gray-pale" />
      <div className="mt-10 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-md bg-veridan-warm-gray-pale" />
        ))}
      </div>
    </div>
  );
}
