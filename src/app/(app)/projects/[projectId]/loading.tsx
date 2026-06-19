// Instant skeleton shown while the server fetch resolves (App Router loading.tsx).
// Matches project workspace/page.tsx: max-w-6xl header + left main + right sidebar.
export default function Loading() {
  return (
    <div style={{ maxWidth: "72rem", margin: "0 auto" }} className="motion-safe:animate-pulse">
      {/* Header row: project name + action button */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 h-3 w-16 rounded bg-[var(--surface-2)]" />
          <div className="h-8 w-64 rounded bg-[var(--surface-2)]" />
        </div>
        <div className="h-9 w-32 shrink-0 rounded-lg bg-[var(--surface-2)]" />
      </div>

      {/* Body: left main column + right sidebar */}
      <div className="flex gap-5">
        {/* Main column — three section cards */}
        <div className="min-w-0 flex-1 space-y-5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
            >
              <div className="mb-4 h-5 w-32 rounded bg-[var(--surface-2)]" />
              <div className="space-y-3">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="h-12 w-full rounded-lg bg-[var(--surface-2)] opacity-60" />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar — two stacked blocks */}
        <div className="w-64 shrink-0 space-y-4">
          <div className="h-44 rounded-xl border border-[var(--line)] bg-[var(--surface)]" />
          <div className="h-32 rounded-xl border border-[var(--line)] bg-[var(--surface)]" />
        </div>
      </div>
    </div>
  );
}
