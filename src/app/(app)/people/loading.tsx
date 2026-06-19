// Instant skeleton shown while the server fetch resolves (App Router loading.tsx).
// Matches people/page.tsx: DirectoryList layout — header + list of person rows.
export default function Loading() {
  return (
    <div className="motion-safe:animate-pulse">
      {/* Page header */}
      <div className="mb-6">
        <div className="h-7 w-20 rounded bg-[var(--surface-2)]" />
      </div>

      {/* Person rows */}
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
          >
            {/* Avatar circle */}
            <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--surface-2)]" />
            {/* Name + subtitle */}
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 h-4 w-32 rounded bg-[var(--surface-2)]" />
              <div className="h-3 w-48 max-w-full rounded bg-[var(--surface-2)] opacity-60" />
            </div>
            {/* Badge */}
            <div className="h-4 w-16 shrink-0 rounded-full bg-[var(--surface-2)] opacity-50" />
          </div>
        ))}
      </div>
    </div>
  );
}
