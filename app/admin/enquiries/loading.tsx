export default function EnquiriesLoading() {
  return (
    <div className="max-w-4xl animate-pulse">
      <div className="mb-6 h-7 w-40 rounded bg-veridan-warm-gray-pale" />
      <div className="h-24 rounded-md bg-veridan-warm-gray-pale" />
      <div className="mt-10 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-md bg-veridan-warm-gray-pale" />
        ))}
      </div>
    </div>
  );
}
