export default function PriceFilesLoading() {
  return (
    <div className="max-w-3xl animate-pulse">
      <div className="mb-6 h-7 w-40 rounded bg-veridan-warm-gray-pale" />
      <div className="h-48 rounded-md bg-veridan-warm-gray-pale" />
      <div className="mt-10 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 rounded-md bg-veridan-warm-gray-pale" />
        ))}
      </div>
    </div>
  );
}
