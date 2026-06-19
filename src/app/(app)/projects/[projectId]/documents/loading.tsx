// Instant skeleton shown while the server fetch resolves (App Router loading.tsx).
// Matches documents/page.tsx: max-w-6xl header + grouped card grid (2-3 col).
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl motion-safe:animate-pulse">
      {/* Page header */}
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 h-3 w-16 rounded bg-[var(--surface-2)]" />
          <div className="mb-2 h-7 w-48 rounded bg-[var(--surface-2)]" />
          <div className="h-3.5 w-80 max-w-full rounded bg-[var(--surface-2)] opacity-60" />
        </div>
        <div className="h-9 w-24 shrink-0 rounded-lg bg-[var(--surface-2)]" />
      </div>

      {/* Artifact card grid — two groups of 3 */}
      {[0, 1].map((group) => (
        <div key={group} className="mb-10">
          <div className="mb-4 h-3 w-20 rounded bg-[var(--surface-2)]" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5"
              >
                <div className="mb-3 flex items-center gap-2">
                  <div className="h-4 w-16 rounded-full bg-[var(--surface-2)]" />
                  <div className="ml-auto h-3 w-12 rounded bg-[var(--surface-2)] opacity-60" />
                </div>
                <div className="mb-2 h-5 w-3/4 rounded bg-[var(--surface-2)]" />
                <div className="mb-1 h-3 w-full rounded bg-[var(--surface-2)] opacity-60" />
                <div className="h-3 w-2/3 rounded bg-[var(--surface-2)] opacity-60" />
                <div className="mt-4 border-t border-[var(--line)] pt-4">
                  <div className="h-3 w-16 rounded bg-[var(--surface-2)] opacity-50" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
