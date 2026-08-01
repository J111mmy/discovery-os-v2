// Instant skeleton shown while the server fetch resolves (App Router loading.tsx).
// Matches ingest/page.tsx chrome: max-w-5xl header + IngestForm's two-column layout.
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl motion-safe:animate-pulse">
      <div className="mb-8">
        <div className="mb-2 h-3 w-24 rounded bg-[var(--surface-2)]" />
        <div className="mb-2 h-7 w-64 max-w-full rounded bg-[var(--surface-2)]" />
        <div className="h-3.5 w-96 max-w-full rounded bg-[var(--surface-2)] opacity-60" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="mb-2 h-3.5 w-10 rounded bg-[var(--surface-2)]" />
          <div className="h-9 w-full rounded-lg bg-[var(--surface-2)]" />
          <div className="mb-2 mt-5 h-3.5 w-24 rounded bg-[var(--surface-2)]" />
          <div className="h-9 w-full rounded-lg bg-[var(--surface-2)] opacity-70" />
          <div className="mb-2 mt-5 h-3.5 w-16 rounded bg-[var(--surface-2)]" />
          <div className="h-40 w-full rounded-lg bg-[var(--surface-2)]" />
        </div>
        <aside className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="mb-2 h-4 w-24 rounded bg-[var(--surface-2)]" />
          <div className="h-3 w-full rounded bg-[var(--surface-2)] opacity-60" />
          <div className="mt-2 h-3 w-3/4 rounded bg-[var(--surface-2)] opacity-60" />
          <div className="mt-5 h-9 w-full rounded-lg bg-[var(--surface-2)]" />
        </aside>
      </div>
    </div>
  );
}
