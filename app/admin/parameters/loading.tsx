export default function ParametersLoading() {
  return (
    <div className="max-w-3xl animate-pulse">
      <div className="mb-6 h-7 w-56 rounded bg-veridan-warm-gray-pale" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-md bg-veridan-warm-gray-pale" />
        ))}
      </div>
    </div>
  );
}
