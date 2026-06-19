// Instant skeleton shown while the server fetch resolves (App Router loading.tsx).
// Matches evidence/page.tsx: PipelineRail (3 tabs) + scrollable evidence list.
export default function Loading() {
  return (
    <div className="motion-safe:animate-pulse">
      {/* PipelineRail — 3 equal-width step cards */}
      <div className="mb-6 flex flex-wrap gap-2.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-16 flex-1 basis-40 rounded-[14px] border border-[var(--line)] bg-[var(--surface)]"
          />
        ))}
      </div>

      {/* Evidence record list */}
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
          >
            <div className="mb-2 h-4 w-3/4 rounded bg-[var(--surface-2)]" />
            <div className="h-3 w-1/2 rounded bg-[var(--surface-2)] opacity-60" />
          </div>
        ))}
      </div>
    </div>
  );
}
