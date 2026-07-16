export default function PipelineLoading() {
  return (
    <div className="max-w-6xl animate-pulse">
      <div className="mb-6 h-7 w-40 rounded bg-veridan-warm-gray-pale" />
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="h-24 rounded-md bg-veridan-warm-gray-pale" />
        <div className="h-24 rounded-md bg-veridan-warm-gray-pale" />
        <div className="h-24 rounded-md bg-veridan-warm-gray-pale" />
      </div>
      <div className="h-96 rounded-md bg-veridan-warm-gray-pale" />
    </div>
  );
}
