export default function ProductsLoading() {
  return (
    <div className="max-w-4xl animate-pulse">
      <div className="mb-6 h-7 w-56 rounded bg-veridan-warm-gray-pale" />
      <div className="h-44 rounded-md bg-veridan-warm-gray-pale" />
      <div className="mt-10 h-32 rounded-md bg-veridan-warm-gray-pale" />
      <div className="mt-10 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-md bg-veridan-warm-gray-pale" />
        ))}
      </div>
    </div>
  );
}
