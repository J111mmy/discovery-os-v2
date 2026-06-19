// Instant skeleton shown while the server fetch resolves (App Router loading.tsx).
// Matches problems/page.tsx: PipelineRail + sidebar problem list + main detail pane.
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

      {/* Two-panel layout: sidebar list + main detail */}
      <div className="flex gap-4">
        {/* Sidebar — problem rows */}
        <div className="w-72 shrink-0 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
            >
              <div className="mb-2 h-4 w-3/4 rounded bg-[var(--surface-2)]" />
              <div className="h-3 w-1/3 rounded bg-[var(--surface-2)] opacity-60" />
            </div>
          ))}
        </div>

        {/* Main detail area */}
        <div className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <div className="mb-4 h-5 w-1/2 rounded bg-[var(--surface-2)]" />
          <div className="mb-2 h-4 w-full rounded bg-[var(--surface-2)] opacity-60" />
          <div className="h-4 w-4/5 rounded bg-[var(--surface-2)] opacity-60" />
        </div>
      </div>
    </div>
  );
}
