// Instant skeleton shown while the server fetch resolves (App Router loading.tsx).
// Matches companies/page.tsx: DirectoryList layout — header + list of company rows.
export default function Loading() {
  return (
    <div className="motion-safe:animate-pulse">
      {/* Page header */}
      <div className="mb-6">
        <div className="h-7 w-28 rounded bg-[var(--surface-2)]" />
      </div>

      {/* Company rows */}
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
          >
            {/* Logo chip */}
            <div className="h-9 w-9 shrink-0 rounded-lg bg-[var(--surface-2)]" />
            {/* Name + domain */}
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 h-4 w-40 rounded bg-[var(--surface-2)]" />
              <div className="h-3 w-24 rounded bg-[var(--surface-2)] opacity-60" />
            </div>
            {/* Project count chip */}
            <div className="h-4 w-14 shrink-0 rounded-full bg-[var(--surface-2)] opacity-50" />
          </div>
        ))}
      </div>
    </div>
  );
}
