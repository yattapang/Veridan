export default function CompanyDetailLoading() {
  return (
    <div className="max-w-3xl animate-pulse">
      <div className="mb-4 h-4 w-24 rounded bg-veridan-warm-gray-pale" />
      <div className="mb-6 h-7 w-56 rounded bg-veridan-warm-gray-pale" />
      <div className="h-40 rounded-md bg-veridan-warm-gray-pale" />
      <div className="mt-10 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-md bg-veridan-warm-gray-pale" />
        ))}
      </div>
    </div>
  );
}
